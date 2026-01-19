const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const { upload, uploadToCloudinary } = require('../middleware/cloudinaryUpload');
const {
  uploadToCloudinary: uploadRawToCloudinary,
  deleteFromCloudinary,
  getSignedDownloadUrl,
  getSignedUrl,
} = require('../services/cloudinary');
const { protect, authorize } = require('../middleware/auth');
const HiringCompany = require('../models/HiringCompany');
const HiringCompanyAdmin = require('../models/HiringCompanyAdmin');
const HiringEmployee = require('../models/HiringEmployee');
const HiringOfferLetter = require('../models/HiringOfferLetter');
const User = require('../models/User');
const { generateAIResponse, generateSalaryTemplate, generateExpenseTemplate, extractExpenseFieldsFromImage } = require('../services/openaiService');
const { mail } = require('../utils/sendEmail');
const HiringHoliday = require('../models/HiringHoliday');
const HiringTimesheet = require('../models/HiringTimesheet');
const HiringDocument = require('../models/HiringDocument');
const HiringEmployeeProfile = require('../models/HiringEmployeeProfile');
const HiringExpense = require('../models/HiringExpense');
const HiringExpenseTemplate = require('../models/HiringExpenseTemplate');

const HIRING_TOKEN_TYPE = 'hiring-pro';
const HIRING_SUPERADMIN_EMAIL = process.env.HIRING_SUPERADMIN_EMAIL || 'superadmin@tabalt.co.uk';
const HIRING_SUPERADMIN_PASSWORD = process.env.HIRING_SUPERADMIN_PASSWORD || 'ChangeMe123!';

const signHiringToken = (payload) => jwt.sign(
  { ...payload, type: HIRING_TOKEN_TYPE },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

const requireHiringAuth = (roles = []) => (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) {
    return res.status(401).json({ message: 'Not authorized' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== HIRING_TOKEN_TYPE) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (roles.length && !roles.includes(decoded.role)) {
      return res.status(403).json({ message: 'Access restricted' });
    }
    req.hiringUser = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized' });
  }
};

const sanitizeOfferContent = (content = '') => {
  return content
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/\[[^\]]+\]/.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();
};

const getDocumentDateFormat = (documentType = '') => {
  const normalized = documentType.toLowerCase();
  if (normalized.includes('offer') || normalized.includes('employment') || normalized.includes('visa')) {
    return 'UK';
  }
  return 'US';
};

const formatDocumentDate = (date = new Date(), format = 'UK') => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return format === 'US' ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
};

const parseJsonWithFallback = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
};

const normalizeSalaryBreakup = (payload = {}) => {
  const currency = payload.currency || 'USD';
  const components = Array.isArray(payload.components) ? payload.components : [];
  const sanitizedComponents = components.map((component) => ({
    key: component.key || '',
    label: component.label || '',
    amount: Number(component.amount) || 0,
    description: component.description || '',
    category: component.category === 'deduction' ? 'deduction' : 'earning'
  }));
  const totalCtc = sanitizedComponents
    .filter((item) => item.category === 'earning')
    .reduce((sum, item) => sum + item.amount, 0);
  const totalDeductions = sanitizedComponents
    .filter((item) => item.category === 'deduction')
    .reduce((sum, item) => sum + item.amount, 0);

  return {
    currency,
    components: sanitizedComponents,
    totalCtc,
    netPay: totalCtc - totalDeductions
  };
};

const normalizeExpenseTemplateFields = (fields = []) => {
  const fixedFields = [
    { key: 'particulars', label: 'Particulars', required: true, order: 1 },
    { key: 'invoice_number', label: 'Invoice Number', required: true, order: 2 },
    { key: 'name', label: 'Name', required: true, order: 3 },
    { key: 'expense_type', label: 'Type of Expense', required: true, order: 4 },
    { key: 'amount', label: 'Amount', required: true, order: 5 },
    { key: 'date', label: 'Date', required: true, order: 6 },
    { key: 'remarks', label: 'Remarks', required: true, order: 7 }
  ];

  const normalized = fields
    .filter((field) => field && (field.key || field.label))
    .map((field, index) => {
      const key = (field.key || field.label || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return {
        key,
        label: field.label || field.key || '',
        required: Boolean(field.required),
        order: Number.isFinite(Number(field.order)) ? Number(field.order) : index + 1
      };
    })
    .filter((field) => field.key)
    .filter((field) => field.key !== 'bill_number');

  const merged = fixedFields.map((fixed) => {
    const existing = normalized.find((field) => field.key === fixed.key);
    return existing ? { ...fixed, label: existing.label || fixed.label } : fixed;
  });

  const extras = normalized.filter((field) => !fixedFields.some((fixed) => fixed.key === field.key));
  const allFields = [...merged, ...extras.map((field, index) => ({
    ...field,
    required: field.required || false,
    order: fixedFields.length + index + 1
  }))];

  return allFields.sort((a, b) => a.order - b.order);
};

const buildExpenseValues = (templateFields = [], extracted = {}, extraFields = []) => {
  const values = templateFields.map((field) => {
    if (field.key === 'remarks') {
      const remarksFromExtras = extraFields
        .map((item) => `${item.label || 'Field'}: ${item.value || 'Data Missing'}`)
        .join(' | ');
      return {
        key: field.key,
        label: field.label,
        value: remarksFromExtras || 'Data Missing'
      };
    }
    const value = extracted[field.key];
    return {
      key: field.key,
      label: field.label,
      value: value ? String(value) : 'Data Missing'
    };
  });

  return values;
};

const buildExpensePdfBuffer = async (expense) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  doc.fontSize(18).text('Expense Sheet', { underline: true });
  doc.moveDown();
  doc.fontSize(12).text(`Employee: ${expense.employeeId?.name || 'Employee'}`);
  doc.text(`Status: ${expense.status}`);
  doc.text(`Submitted: ${expense.submittedAt ? new Date(expense.submittedAt).toLocaleString() : '—'}`);
  doc.moveDown();

  const entries = expense.values || [];
  entries.forEach((entry) => {
    doc.fontSize(11).text(`${entry.label}: ${entry.value}`);
  });

  doc.moveDown();
  doc.fontSize(12).text(`Amount: ${expense.amount || 0}`);
  doc.moveDown();
  if (expense.adminComment) {
    doc.fontSize(11).text(`Admin Comment: ${expense.adminComment}`);
  }

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
};

const generateEmployeeCode = async (companyId) => {
  let code = '';
  let exists = true;
  while (exists) {
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    code = `EMP-${companyId.toString().slice(-4)}-${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    exists = await HiringEmployee.exists({ companyId, employeeCode: code });
  }
  return code;
};

const ensureEmployeeCode = async (employee) => {
  if (!employee.employeeCode) {
    employee.employeeCode = await generateEmployeeCode(employee.companyId);
    await employee.save();
  }
  return employee;
};

const deleteExpenseAssets = async (expense) => {
  const publicIds = [expense.invoicePublicId, expense.pdfPublicId].filter(Boolean);
  for (const publicId of publicIds) {
    try {
      await deleteFromCloudinary(publicId, 'raw');
    } catch (error) {
      console.error('Expense asset delete error (raw):', error?.message);
    }
    try {
      await deleteFromCloudinary(publicId, 'image');
    } catch (error) {
      console.error('Expense asset delete error (image):', error?.message);
    }
  }
};

const buildDocumentPdfBuffer = async (company, document, content) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const logoUrl = document.documentLogoUrl || company?.logoUrl;
  const isNda = (document.documentTypeLabel || document.documentType || '').toLowerCase().includes('nda');
  const sanitizedContent = sanitizeOfferContent(content || '');
  const pageChunks = isNda
    ? sanitizedContent.split(/=== Page \d+ ===/i).map((page) => page.trim()).filter(Boolean)
    : [sanitizedContent];

  pageChunks.forEach((pageContent, pageIndex) => {
    if (pageIndex > 0) {
      doc.addPage();
    }

    if (pageIndex === 0 && logoUrl) {
      try {
        const logoResponse = await axios.get(logoUrl, { responseType: 'arraybuffer' });
        const logoWidth = 110;
        doc.image(logoResponse.data, doc.page.width - logoWidth - 50, 40, { width: logoWidth });
      } catch (error) {
        console.warn('Unable to load document logo:', error.message);
      }
    }

    if (pageIndex === 0) {
      if (company?.name) {
        doc.fontSize(16).text(company.name);
      }
      doc.moveDown(0.5);

      doc.fontSize(14).text(document.documentTypeLabel || document.documentType || 'Document', { underline: true });
      doc.moveDown();
      if (document.documentDate) {
        doc.fontSize(12).text(`Date: ${document.documentDate}`);
      }
      doc.fontSize(12).text(`Candidate: ${document.candidateName}`);
      if (document.title) {
        doc.text(`Title: ${document.title}`);
      }
      if (document.employeeCode) {
        doc.text(`Employee ID: ${document.employeeCode}`);
      }
      if (document.documentTitle) {
        doc.text(`Document Title: ${document.documentTitle}`);
      }
      doc.moveDown();
    }

    const lines = pageContent.split(/\r?\n/);
    lines.forEach((line) => {
      if (!line.trim()) {
        doc.moveDown();
        return;
      }
      doc.text(line);
    });

    if (pageIndex === pageChunks.length - 1) {
      doc.moveDown();
      doc.text('Signatures', { underline: true });

      if (document.adminSignatureUrl) {
        try {
          const adminSignatureResponse = await axios.get(document.adminSignatureUrl, { responseType: 'arraybuffer' });
          doc.moveDown(0.5);
          doc.text(company?.signingAuthority?.name || 'Authorized Signatory');
          doc.image(adminSignatureResponse.data, { width: 120 });
        } catch (error) {
          console.warn('Unable to load admin signature:', error.message);
        }
      } else {
        doc.moveDown(0.5);
        doc.text(company?.signingAuthority?.name || 'Authorized Signatory');
      }

      if (document.employeeSignatureUrl) {
        try {
          const employeeSignatureResponse = await axios.get(document.employeeSignatureUrl, { responseType: 'arraybuffer' });
          doc.moveDown(0.5);
          doc.text(`${document.candidateName} (Employee)`);
          doc.image(employeeSignatureResponse.data, { width: 120 });
        } catch (error) {
          console.warn('Unable to load employee signature:', error.message);
        }
      }
    }

    if (isNda && document.documentDate) {
      doc.fontSize(9);
      doc.text(`Date: ${document.documentDate}`, 50, doc.page.height - 40, {
        align: 'right'
      });
    }
  });

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
};

const streamDocumentFile = async (res, document, disposition = 'inline') => {
  const signedUrl = document.filePublicId
    ? getSignedUrl(document.filePublicId, { resource_type: 'raw', type: 'upload' })
    : document.fileUrl;
  if (!signedUrl) {
    return res.status(404).json({ message: 'Document file not available' });
  }

  const fileResponse = await axios.get(signedUrl, { responseType: 'arraybuffer' });
  const contentType = fileResponse.headers['content-type'] || 'application/octet-stream';
  let fileName = document.fileName || document.title || 'document';
  if (!/\.[a-z0-9]+$/i.test(fileName) && contentType.includes('pdf')) {
    fileName = `${fileName}.pdf`;
  }
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${fileName.replace(/\s+/g, '-')}"` 
  );
  return res.send(fileResponse.data);
};

const ensureSeedCompanies = async () => {
  const existing = await HiringCompany.find({});
  if (existing.length >= 2) return;

  const dummyCustomerId = new mongoose.Types.ObjectId();
  const companyA = await HiringCompany.create({
    name: 'Company A',
    customerId: dummyCustomerId,
    customerEmail: 'customerA@demo.company',
    logoUrl: null,
    signingAuthority: { name: 'Alice Morgan', title: 'Chief People Officer' }
  });
  const companyB = await HiringCompany.create({
    name: 'Company B',
    customerId: dummyCustomerId,
    customerEmail: 'customerB@demo.company',
    logoUrl: null,
    signingAuthority: { name: 'James Patel', title: 'Head of HR' }
  });

  const seedPassword = 'Welcome123!';
  await HiringCompanyAdmin.create({
    companyId: companyA._id,
    name: 'Admin A',
    email: 'admin@companya.demo',
    password: seedPassword
  });
  await HiringCompanyAdmin.create({
    companyId: companyB._id,
    name: 'Admin B',
    email: 'admin@companyb.demo',
    password: seedPassword
  });

  await HiringEmployee.create({
    companyId: companyA._id,
    name: 'Employee A',
    email: 'employee@companya.demo',
    password: seedPassword,
    designation: 'Analyst'
  });
  await HiringEmployee.create({
    companyId: companyB._id,
    name: 'Employee B',
    email: 'employee@companyb.demo',
    password: seedPassword,
    designation: 'Coordinator'
  });
};

const sendHiringAdminCredentialsEmail = async (toEmail, companyName, adminEmail, adminPassword) => {
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111;">
      <h2>${companyName} Hiring Platform Access</h2>
      <p>Your Hiring Platform admin credentials are ready.</p>
      <p><strong>Admin Email:</strong> ${adminEmail}</p>
      <p><strong>Temporary Password:</strong> ${adminPassword}</p>
      <p>Use these credentials to log into the Hiring Platform Admin Dashboard.</p>
    </div>
  `;
  await mail(toEmail, `${companyName} Hiring Platform Credentials`, html, 'tabaltllp@gmail.com', 'Tabalt Hiring Pro');
};

const sendEmployeeCredentialsEmail = async (emails, companyName, employeeName, employeeEmail, employeePassword) => {
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111;">
      <h2>${companyName} Employee Access</h2>
      <p>The employee profile for <strong>${employeeName}</strong> has been created.</p>
      <p><strong>Employee Email:</strong> ${employeeEmail}</p>
      <p><strong>Temporary Password / OTP:</strong> ${employeePassword}</p>
      <p>Use these credentials to log into the Employee Dashboard.</p>
    </div>
  `;
  await Promise.all(
    emails.map((toEmail) =>
      mail(toEmail, `${companyName} Employee Credentials`, html, 'tabaltllp@gmail.com', 'Tabalt Hiring Pro')
    )
  );
};

// Company onboarding (customer only)
router.post('/onboard', protect, authorize('customer'), upload.fields([{ name: 'logo', maxCount: 1 }]), uploadToCloudinary, async (req, res) => {
  try {
    const { customerEmail, companyName, authorityName, authorityTitle } = req.body;
    if (!customerEmail || !companyName || !authorityName || !authorityTitle) {
      return res.status(400).json({ message: 'Customer email, company name, and signing authority are required' });
    }
    if (customerEmail.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(400).json({ message: 'Customer email must match your account email.' });
    }

    const logoFile = req.uploadedFiles?.find(file => file.type === 'logo');
    const updatePayload = {
      name: companyName.trim(),
      customerId: req.user._id,
      customerEmail: customerEmail.toLowerCase(),
      signingAuthority: {
        name: authorityName.trim(),
        title: authorityTitle.trim()
      },
      onboardingComplete: true
    };
    if (logoFile?.url) {
      updatePayload.logoUrl = logoFile.url;
    }

    const company = await HiringCompany.findOneAndUpdate(
      { customerId: req.user._id },
      updatePayload,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const generatedEmail = `admin@${companyName.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'company'}.demo`;
    let generatedPassword = null;

    let companyAdmin = await HiringCompanyAdmin.findOne({ companyId: company._id });
    if (!companyAdmin) {
      generatedPassword = crypto.randomBytes(6).toString('hex');
      companyAdmin = await HiringCompanyAdmin.create({
        companyId: company._id,
        name: authorityName.trim(),
        email: generatedEmail,
        password: generatedPassword
      });
      await sendHiringAdminCredentialsEmail(customerEmail, company.name, companyAdmin.email, generatedPassword);
    }

    res.json({
      success: true,
      company,
      adminCredentials: generatedPassword
        ? { email: companyAdmin.email, password: generatedPassword }
        : null
    });
  } catch (error) {
    console.error('Hiring Pro company onboarding error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/customer/company', protect, authorize('customer'), async (req, res) => {
  try {
    const company = await HiringCompany.findOne({ customerId: req.user._id });
    res.json({ success: true, company });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Public list of onboarded companies (for employee signup)
router.get('/companies', async (req, res) => {
  try {
    const companies = await HiringCompany.find({ onboardingComplete: true })
      .select('name');
    res.json({ success: true, companies });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Employee signup (profile creation)
router.post('/employee/signup', async (req, res) => {
  try {
    const { name, email, companyId } = req.body;
    if (!name || !email || !companyId) {
      return res.status(400).json({ message: 'Name, email, and company are required' });
    }

    const company = await HiringCompany.findOne({ _id: companyId, onboardingComplete: true });
    if (!company) {
      return res.status(400).json({
        message: 'Your company has not been onboarded yet. Please ask your employer to set up Hiring Pro before you continue.'
      });
    }

    const existing = await HiringEmployee.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'Employee already exists. Please log in.' });
    }

    const generatedPassword = crypto.randomBytes(4).toString('hex');
    const employee = await HiringEmployee.create({
      companyId: company._id,
      name: name.trim(),
      email: email.toLowerCase(),
      password: generatedPassword
    });

    const notificationEmails = [employee.email];
    if (company.customerEmail) {
      notificationEmails.push(company.customerEmail);
    }
    await sendEmployeeCredentialsEmail(
      notificationEmails,
      company.name,
      employee.name,
      employee.email,
      generatedPassword
    );

    const token = signHiringToken({ role: 'employee', companyId: employee.companyId, employeeId: employee._id });
    return res.json({
      success: true,
      token,
      user: { email: employee.email, role: employee.role, companyId: employee.companyId, name: employee.name }
    });
  } catch (error) {
    console.error('Hiring Pro employee signup error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Customer login for hiring admin access
router.post('/auth/customer-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const customer = await User.findOne({ email: email.toLowerCase(), role: 'customer' }).select('+password');
    if (!customer || !customer.password || !(await customer.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const company = await HiringCompany.findOne({ customerId: customer._id, onboardingComplete: true });
    if (!company) {
      return res.status(400).json({ message: 'Hiring Pro onboarding is not completed for this customer.' });
    }

    let admin = await HiringCompanyAdmin.findOne({ companyId: company._id });
    if (!admin) {
      const tempPassword = crypto.randomBytes(6).toString('hex');
      admin = await HiringCompanyAdmin.create({
        companyId: company._id,
        name: customer.name || 'Company Admin',
        email: customer.email.toLowerCase(),
        password: tempPassword
      });
    }

    const token = signHiringToken({ role: 'company_admin', companyId: company._id, adminId: admin._id });
    return res.json({
      success: true,
      token,
      user: { email: customer.email, role: 'company_admin', companyId: company._id, name: customer.name }
    });
  } catch (error) {
    console.error('Hiring Pro customer login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Customer session exchange for hiring admin access (no password re-entry)
router.post('/auth/customer-session', protect, authorize('customer'), async (req, res) => {
  try {
    const customer = req.user;
    const company = await HiringCompany.findOne({ customerId: customer._id, onboardingComplete: true });
    if (!company) {
      return res.status(400).json({ message: 'Hiring Pro onboarding is not completed for this customer.' });
    }

    let admin = await HiringCompanyAdmin.findOne({ companyId: company._id });
    if (!admin) {
      const tempPassword = crypto.randomBytes(6).toString('hex');
      admin = await HiringCompanyAdmin.create({
        companyId: company._id,
        name: customer.name || 'Company Admin',
        email: customer.email.toLowerCase(),
        password: tempPassword
      });
    }

    const token = signHiringToken({ role: 'company_admin', companyId: company._id, adminId: admin._id });
    return res.json({
      success: true,
      token,
      user: { email: customer.email, role: 'company_admin', companyId: company._id, name: customer.name }
    });
  } catch (error) {
    console.error('Hiring Pro customer session error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Auth login for company admin/employee/super admin
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ message: 'Email, password, and role are required' });
    }

    if (role === 'super_admin') {
      if (email.toLowerCase() !== HIRING_SUPERADMIN_EMAIL.toLowerCase() || password !== HIRING_SUPERADMIN_PASSWORD) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      const token = signHiringToken({ role: 'super_admin' });
      return res.json({ success: true, token, user: { email, role: 'super_admin' } });
    }

    if (role === 'company_admin') {
      const admin = await HiringCompanyAdmin.findOne({ email: email.toLowerCase() });
      if (!admin || !(await admin.comparePassword(password))) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      const token = signHiringToken({ role: 'company_admin', companyId: admin.companyId, adminId: admin._id });
      return res.json({
        success: true,
        token,
        user: { email: admin.email, role: admin.role, companyId: admin.companyId, name: admin.name }
      });
    }

    if (role === 'employee') {
      const employee = await HiringEmployee.findOne({ email: email.toLowerCase() });
      if (!employee || !(await employee.comparePassword(password))) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      const token = signHiringToken({ role: 'employee', companyId: employee.companyId, employeeId: employee._id });
      return res.json({
        success: true,
        token,
        user: { email: employee.email, role: employee.role, companyId: employee.companyId, name: employee.name }
      });
    }

    return res.status(400).json({ message: 'Invalid role' });
  } catch (error) {
    console.error('Hiring Pro login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Super admin - list companies
router.get('/super/companies', requireHiringAuth(['super_admin']), async (req, res) => {
  try {
    await ensureSeedCompanies();
    const companies = await HiringCompany.find({}).sort({ createdAt: -1 });
    res.json({ success: true, companies });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Company admin profile
router.get('/company/profile', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const company = await HiringCompany.findById(req.hiringUser.companyId);
    if (!company) return res.status(404).json({ message: 'Company not found' });
    res.json({ success: true, company });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Company admin employees
router.get('/company/employees', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const employees = await HiringEmployee.find({ companyId: req.hiringUser.companyId });
    const updatedEmployees = await Promise.all(employees.map(ensureEmployeeCode));
    res.json({ success: true, employees: updatedEmployees });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/company/employees', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const { name, email, password, designation } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }
    const existing = await HiringEmployee.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ message: 'Employee already exists' });
    const employee = await HiringEmployee.create({
      companyId: req.hiringUser.companyId,
      name: name.trim(),
      email: email.toLowerCase(),
      password,
      designation: designation || ''
    });
    await ensureEmployeeCode(employee);
    res.json({ success: true, employee });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Documents generator (Offer Letter, Employment Contract, NDA, Vendor Contract, Others)
router.post('/company/offer-letter/generate', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const company = await HiringCompany.findById(req.hiringUser.companyId);
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const { candidateName, title, employeeId, employeeCode, documentType, customDocumentType } = req.body;
    if (!candidateName || !title || !documentType) {
      return res.status(400).json({ message: 'Candidate name, title, and document type are required' });
    }

    const docTypeLabel = documentType === 'Others' && customDocumentType ? customDocumentType : documentType;
    const dateFormat = getDocumentDateFormat(docTypeLabel);
    const isNda = docTypeLabel.toLowerCase() === 'nda' || docTypeLabel.toLowerCase().includes('non-disclosure');
    const prompt = isNda
      ? `Generate a professional Non-Disclosure Agreement (NDA) with clear formatting (max 5 pages).
Company: ${company.name}
Candidate Name: ${candidateName}
Title: ${title}
Employee ID: ${employeeCode || 'EMP-XXXXXX'}
Date: Use today's date in ${dateFormat} format

Formatting requirements:
- Use clear section headers (e.g., PURPOSE, CONFIDENTIAL INFORMATION, TERM, GOVERNING LAW).
- Use numbered clauses and bulleted sub-points.
- Insert explicit page markers: "=== Page 1 ===", "=== Page 2 ===", etc.
- Add a short footer line per page with the date.
- No placeholders, brackets, or asterisks. If missing details, fill with realistic dummy data and list in "dummyFields".

Return JSON ONLY:
{
  "content": "full NDA text with page markers",
  "date": "formatted date",
  "dummyFields": ["Field Name"]
}`
      : `Generate a professional HR/legal document draft (max 5 pages).
Company: ${company.name}
Signing Authority: ${company.signingAuthority.name}, ${company.signingAuthority.title}
Candidate Name: ${candidateName}
Title: ${title}
Employee ID: ${employeeCode || 'EMP-XXXXXX'}
Document Type: ${docTypeLabel}
Date: Use today's date in ${dateFormat} format

Requirements:
- Use UK or US legal/HR terminology appropriate to the document type.
- Ensure the document is ready for sharing (no placeholders, no asterisks, no brackets).
- If a required field is missing, fill with realistic dummy data and list it in "dummyFields".
- Return JSON ONLY:
{
  "content": "document body text",
  "date": "formatted date",
  "dummyFields": ["Field Name"]
}`;

    const aiResponse = await generateAIResponse(prompt, [], 'hiring');
    const parsed = parseJsonWithFallback(aiResponse);
    const fallbackDate = formatDocumentDate(new Date(), dateFormat);
    const content = parsed?.content || aiResponse || '';
    const sanitized = sanitizeOfferContent(content || '');
    res.json({
      success: true,
      content: sanitized,
      date: parsed?.date || fallbackDate,
      dummyFields: parsed?.dummyFields || []
    });
  } catch (error) {
    console.error('Document generation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post(
  '/company/offer-letter',
  requireHiringAuth(['company_admin']),
  upload.fields([{ name: 'documentLogo', maxCount: 1 }, { name: 'signature', maxCount: 1 }]),
  uploadToCloudinary,
  async (req, res) => {
    try {
      const {
        candidateName,
        title,
        employeeId,
        employeeCode,
        documentType,
        customDocumentType,
        documentDate,
        content
      } = req.body;
      if (!candidateName || !title || !documentType || !content) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const company = await HiringCompany.findById(req.hiringUser.companyId);
      if (!company) return res.status(404).json({ message: 'Company not found' });

      const documentLogo = req.uploadedFiles?.find(file => file.type === 'documentLogo');
      const signatureFile = req.uploadedFiles?.find(file => file.type === 'signature');

      const docTypeLabel = documentType === 'Others' && customDocumentType ? customDocumentType : documentType;
      const sanitizedContent = sanitizeOfferContent(content || '');
      const docDate = documentDate || formatDocumentDate(new Date(), getDocumentDateFormat(docTypeLabel));
      let resolvedEmployeeCode = employeeCode || '';
      if (employeeId && !resolvedEmployeeCode) {
        const employeeRecord = await HiringEmployee.findById(employeeId);
        if (employeeRecord) {
          await ensureEmployeeCode(employeeRecord);
          resolvedEmployeeCode = employeeRecord.employeeCode || '';
        }
      }

      const pdfBuffer = await buildDocumentPdfBuffer(company, {
        candidateName,
        title,
        employeeCode: resolvedEmployeeCode,
        documentType,
        documentTypeLabel: docTypeLabel,
        documentTitle: title,
        documentDate: docDate,
        documentLogoUrl: documentLogo?.url || company.logoUrl || null,
        adminSignatureUrl: signatureFile?.url || ''
      }, sanitizedContent);

      const uploadResult = await uploadRawToCloudinary(pdfBuffer, {
        folder: `hiring-pro/documents/${company._id}`,
        resource_type: 'image',
        format: 'pdf',
        public_id: `document-${Date.now()}`,
        content_type: 'application/pdf',
        type: 'upload'
      });

      const offerLetter = await HiringOfferLetter.create({
        companyId: req.hiringUser.companyId,
        employeeId: employeeId || null,
        candidateName,
        documentTitle: title,
        documentType,
        customDocumentType: customDocumentType || '',
        employeeCode: resolvedEmployeeCode || '',
        documentDate: docDate,
        content: sanitizedContent,
        fileUrl: uploadResult?.secure_url || null,
        filePublicId: uploadResult?.public_id || null,
        companyName: company.name || '',
        companyLogoUrl: company.logoUrl || null,
        documentLogoUrl: documentLogo?.url || company.logoUrl || null,
        adminSignatureUrl: signatureFile?.url || '',
        adminSignaturePublicId: signatureFile?.publicId || '',
        adminSignedAt: signatureFile?.url ? new Date() : null,
        signingAuthorityName: company.signingAuthority?.name || '',
        signingAuthorityTitle: company.signingAuthority?.title || '',
        createdBy: req.hiringUser.adminId
      });
      if (employeeId) {
        const employee = await HiringEmployee.findById(employeeId);
        if (employee) {
          await mail(
            employee.email,
            'Document Ready',
            `<p>A new ${docTypeLabel} is ready for you to review and sign.</p>`,
            'tabaltllp@gmail.com',
            'Tabalt Hiring Pro'
          );
        }
      }
      res.json({ success: true, offerLetter });
    } catch (error) {
      console.error('Document save error:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

router.get('/company/offer-letters', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const offerLetters = await HiringOfferLetter.find({ companyId: req.hiringUser.companyId }).sort({ createdAt: -1 });
    res.json({ success: true, offerLetters });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/company/offer-letters/:id/download', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const offerLetter = await HiringOfferLetter.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!offerLetter || !offerLetter.fileUrl) {
      return res.status(404).json({ message: 'Offer letter file not found' });
    }

    const signedUrl = offerLetter.filePublicId
      ? getSignedDownloadUrl(offerLetter.filePublicId, 'pdf', { resource_type: 'image', type: 'upload' })
      : offerLetter.fileUrl;

    const fileResponse = await axios.get(signedUrl, { responseType: 'arraybuffer' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="document-${offerLetter.candidateName || 'document'}.pdf"`
    );
    return res.send(fileResponse.data);
  } catch (error) {
    console.error('Offer letter download error:', error);
    return res.status(500).json({ message: 'Unable to load offer letter PDF' });
  }
});

router.delete('/company/offer-letters/:id', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const offerLetter = await HiringOfferLetter.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!offerLetter) return res.status(404).json({ message: 'Offer letter not found' });

    if (offerLetter.filePublicId) {
      try {
        await deleteFromCloudinary(offerLetter.filePublicId, 'raw');
      } catch (error) {
        console.error('Offer letter Cloudinary delete error (raw):', error);
      }
      try {
        await deleteFromCloudinary(offerLetter.filePublicId, 'image');
      } catch (error) {
        console.error('Offer letter Cloudinary delete error (image):', error);
      }
    }

    await offerLetter.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Employee access
router.get('/employee/offer-letters', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const offerLetters = await HiringOfferLetter.find({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    }).sort({ createdAt: -1 });
    res.json({ success: true, offerLetters });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Employee submit timesheet
router.post('/employee/timesheets', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const { weekStart, weekEnd, hoursWorked } = req.body;
    if (!weekStart || !weekEnd) {
      return res.status(400).json({ message: 'Week start and end dates are required' });
    }
    const timesheet = await HiringTimesheet.create({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId,
      weekStart: new Date(weekStart),
      weekEnd: new Date(weekEnd),
      hoursWorked: Number(hoursWorked || 0),
      status: 'pending'
    });

    const admins = await HiringCompanyAdmin.find({ companyId: req.hiringUser.companyId });
    await Promise.all(admins.map(admin => mail(
      admin.email,
      'Timesheet Submitted',
      `<p>An employee submitted a timesheet for ${weekStart} - ${weekEnd}.</p>`,
      'tabaltllp@gmail.com',
      'Tabalt Hiring Pro'
    )));

    res.json({ success: true, timesheet });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/employee/timesheets', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const timesheets = await HiringTimesheet.find({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    }).sort({ createdAt: -1 });
    res.json({ success: true, timesheets });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Admin view timesheets
router.get('/company/timesheets', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const timesheets = await HiringTimesheet.find({ companyId: req.hiringUser.companyId })
      .populate('employeeId', 'name email');
    res.json({ success: true, timesheets });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Admin update timesheet
router.put('/company/timesheets/:id', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const { status, hoursWorked } = req.body;
    const timesheet = await HiringTimesheet.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!timesheet) return res.status(404).json({ message: 'Timesheet not found' });
    if (hoursWorked !== undefined) timesheet.hoursWorked = Number(hoursWorked);
    if (status) timesheet.status = status;
    await timesheet.save();

    const employee = await HiringEmployee.findById(timesheet.employeeId);
    if (employee) {
      await mail(
        employee.email,
        'Timesheet Update',
        `<p>Your timesheet has been ${timesheet.status}.</p>`,
        'tabaltllp@gmail.com',
        'Tabalt Hiring Pro'
      );
    }
    res.json({ success: true, timesheet });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Employee submit holiday request
router.post('/employee/holidays', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const { startDate, endDate, reason } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start and end dates are required' });
    }
    const holiday = await HiringHoliday.create({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      notes: reason || '',
      status: 'pending'
    });

    const admins = await HiringCompanyAdmin.find({ companyId: req.hiringUser.companyId });
    await Promise.all(admins.map(admin => mail(
      admin.email,
      'Holiday Request Submitted',
      `<p>An employee requested holiday from ${startDate} to ${endDate}.</p>`,
      'tabaltllp@gmail.com',
      'Tabalt Hiring Pro'
    )));

    res.json({ success: true, holiday });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/employee/holidays', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const holidays = await HiringHoliday.find({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    }).sort({ createdAt: -1 });
    res.json({ success: true, holidays });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/company/holidays', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const holidays = await HiringHoliday.find({ companyId: req.hiringUser.companyId })
      .populate('employeeId', 'name email');
    res.json({ success: true, holidays });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/company/holidays/:id', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const { status } = req.body;
    const holiday = await HiringHoliday.findOne({ _id: req.params.id, companyId: req.hiringUser.companyId });
    if (!holiday) return res.status(404).json({ message: 'Holiday not found' });
    if (status) holiday.status = status;
    await holiday.save();
    const employee = await HiringEmployee.findById(holiday.employeeId);
    if (employee) {
      await mail(
        employee.email,
        'Holiday Request Update',
        `<p>Your holiday request has been ${holiday.status}.</p>`,
        'tabaltllp@gmail.com',
        'Tabalt Hiring Pro'
      );
    }
    res.json({ success: true, holiday });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/company/expense-template', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    let template = await HiringExpenseTemplate.findOne({ companyId: req.hiringUser.companyId });
    if (!template) {
      const generated = await generateExpenseTemplate();
      const fields = normalizeExpenseTemplateFields(generated.fields || []);
      template = await HiringExpenseTemplate.create({
        companyId: req.hiringUser.companyId,
        fields,
        createdBy: {
          id: req.hiringUser.adminId || req.hiringUser.userId || req.hiringUser.companyId,
          name: req.hiringUser.name || 'Company Admin',
          email: req.hiringUser.email || ''
        }
      });
    }
    res.json({ success: true, template });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/company/expense-template/generate', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const generated = await generateExpenseTemplate();
    const fields = normalizeExpenseTemplateFields(generated.fields || []);
    const template = await HiringExpenseTemplate.findOneAndUpdate(
      { companyId: req.hiringUser.companyId },
      {
        companyId: req.hiringUser.companyId,
        fields,
        createdBy: {
          id: req.hiringUser.adminId || req.hiringUser.userId || req.hiringUser.companyId,
          name: req.hiringUser.name || 'Company Admin',
          email: req.hiringUser.email || ''
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, template });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/company/expense-template', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const fields = normalizeExpenseTemplateFields(req.body?.fields || []);
    const template = await HiringExpenseTemplate.findOneAndUpdate(
      { companyId: req.hiringUser.companyId },
      {
        companyId: req.hiringUser.companyId,
        fields,
        createdBy: {
          id: req.hiringUser.adminId || req.hiringUser.userId || req.hiringUser.companyId,
          name: req.hiringUser.name || 'Company Admin',
          email: req.hiringUser.email || ''
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, template });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/employee/expense-template', requireHiringAuth(['employee']), async (req, res) => {
  try {
    let template = await HiringExpenseTemplate.findOne({ companyId: req.hiringUser.companyId });
    if (!template) {
      const generated = await generateExpenseTemplate();
      const fields = normalizeExpenseTemplateFields(generated.fields || []);
      template = await HiringExpenseTemplate.create({
        companyId: req.hiringUser.companyId,
        fields,
        createdBy: { name: 'System' }
      });
    }
    res.json({ success: true, template });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/employee/expenses/extract', requireHiringAuth(['employee']), upload.fields([{ name: 'invoice', maxCount: 1 }]), async (req, res) => {
  try {
    const invoiceFile = req.files?.invoice?.[0];
    if (!invoiceFile) {
      return res.status(400).json({ message: 'Invoice file is required' });
    }

    let template = await HiringExpenseTemplate.findOne({ companyId: req.hiringUser.companyId });
    if (!template) {
      const generated = await generateExpenseTemplate();
      const fields = normalizeExpenseTemplateFields(generated.fields || []);
      template = await HiringExpenseTemplate.create({
        companyId: req.hiringUser.companyId,
        fields,
        createdBy: { name: 'System' }
      });
    }

    const isImage = invoiceFile.mimetype.startsWith('image/');
    const uploadResult = await uploadRawToCloudinary(invoiceFile.buffer, {
      folder: `hiring-pro/expenses/${req.hiringUser.companyId}/invoices`,
      resource_type: 'image',
      format: isImage ? undefined : 'pdf',
      public_id: `invoice-${Date.now()}`,
      content_type: invoiceFile.mimetype,
      type: 'upload'
    });

    let imageBase64 = '';
    if (isImage) {
      imageBase64 = `data:${invoiceFile.mimetype};base64,${invoiceFile.buffer.toString('base64')}`;
    } else {
      const previewUrl = getSignedUrl(uploadResult.public_id, {
        resource_type: 'image',
        format: 'png',
        page: 1,
        type: 'upload'
      });
      const previewResponse = await axios.get(previewUrl, { responseType: 'arraybuffer' });
      imageBase64 = `data:image/png;base64,${Buffer.from(previewResponse.data).toString('base64')}`;
    }

    const extraction = await extractExpenseFieldsFromImage(imageBase64, template.fields || []);
    const extractedFields = extraction.fields || {};
    const extraFields = extraction.extraFields || [];
    const values = buildExpenseValues(template.fields || [], extractedFields, extraFields);

    res.json({
      success: true,
      template,
      values,
      invoice: {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        fileName: invoiceFile.originalname,
        mimeType: invoiceFile.mimetype
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to extract expense data', error: error.message });
  }
});

router.post('/employee/expenses', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const { values = [], invoice = {} } = req.body || {};
    let template = await HiringExpenseTemplate.findOne({ companyId: req.hiringUser.companyId });
    if (!template) {
      const generated = await generateExpenseTemplate();
      const fields = normalizeExpenseTemplateFields(generated.fields || []);
      template = await HiringExpenseTemplate.create({
        companyId: req.hiringUser.companyId,
        fields,
        createdBy: { name: 'System' }
      });
    }

    const templateFields = normalizeExpenseTemplateFields(template.fields || []);
    const valueMap = new Map(values.map((item) => [item.key, item.value]));
    const normalizedValues = templateFields.map((field) => ({
      key: field.key,
      label: field.label,
      value: valueMap.get(field.key) || 'Data Missing'
    }));

    const amountValue = valueMap.get('amount') || '';
    const numericAmount = Number(String(amountValue).replace(/[^0-9.-]/g, '')) || 0;
    const expenseType = valueMap.get('expense_type') || '';
    const remarks = valueMap.get('remarks') || '';

    const expense = await HiringExpense.create({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId,
      templateId: template._id,
      templateFields,
      values: normalizedValues,
      remarks,
      amount: numericAmount,
      expenseType,
      invoiceUrl: invoice.url || '',
      invoicePublicId: invoice.publicId || '',
      invoiceFileName: invoice.fileName || '',
      invoiceMimeType: invoice.mimeType || '',
      status: 'pending',
      submittedAt: new Date()
    });

    const admins = await HiringCompanyAdmin.find({ companyId: req.hiringUser.companyId });
    await Promise.all(admins.map(admin => mail(
      admin.email,
      'Expense Submitted',
      `<p>An employee submitted an expense for approval.</p><p>Amount: ${numericAmount}</p>`,
      'tabaltllp@gmail.com',
      'Tabalt Hiring Pro'
    )));

    res.json({ success: true, expense });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/employee/expenses', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const expenses = await HiringExpense.find({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId,
      employeeDeleted: { $ne: true }
    }).sort({ createdAt: -1 });
    res.json({ success: true, expenses });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/employee/expenses/:id', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const expense = await HiringExpense.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId,
      employeeDeleted: { $ne: true }
    });
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json({ success: true, expense });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/employee/expenses/:id', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const expense = await HiringExpense.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    });
    if (!expense) return res.status(404).json({ message: 'Expense not found' });

    if (expense.status === 'approved') {
      expense.employeeDeleted = true;
      await expense.save();
      return res.json({ success: true, deleted: 'employee_only' });
    }

    await deleteExpenseAssets(expense);
    await expense.deleteOne();
    return res.json({ success: true, deleted: 'all' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/company/expenses', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const filters = { companyId: req.hiringUser.companyId, adminDeleted: { $ne: true } };
    if (req.query.status) filters.status = req.query.status;
    if (req.query.employeeId) filters.employeeId = req.query.employeeId;
    if (req.query.expenseType) filters.expenseType = req.query.expenseType;
    if (req.query.from || req.query.to) {
      filters.createdAt = {};
      if (req.query.from) filters.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filters.createdAt.$lte = new Date(req.query.to);
    }
    const expenses = await HiringExpense.find(filters)
      .populate('employeeId', 'name email')
      .sort({ createdAt: -1 });
    res.json({ success: true, expenses });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/company/expenses/:id', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const expense = await HiringExpense.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId,
      adminDeleted: { $ne: true }
    }).populate('employeeId', 'name email');
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json({ success: true, expense });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

const streamExpensePdf = async (res, expense, disposition = 'attachment') => {
  if (!expense.pdfPublicId) {
    const pdfBuffer = await buildExpensePdfBuffer(expense);
    const uploadResult = await uploadRawToCloudinary(pdfBuffer, {
      folder: `hiring-pro/expenses/${expense.companyId}/pdfs`,
      resource_type: 'image',
      format: 'pdf',
      public_id: `expense-${expense._id}`,
      content_type: 'application/pdf',
      type: 'upload'
    });
    expense.pdfUrl = uploadResult.secure_url;
    expense.pdfPublicId = uploadResult.public_id;
    await expense.save();
  }

  const signedUrl = expense.pdfPublicId
    ? getSignedUrl(expense.pdfPublicId, { resource_type: 'image', format: 'pdf', type: 'upload' })
    : expense.pdfUrl;
  if (!signedUrl) {
    return res.status(404).json({ message: 'Expense PDF not available' });
  }

  const fileResponse = await axios.get(signedUrl, { responseType: 'arraybuffer' });
  res.setHeader('Content-Type', fileResponse.headers['content-type'] || 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="expense-${expense._id}.pdf"`);
  return res.send(fileResponse.data);
};

router.get('/employee/expenses/:id/pdf', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const expense = await HiringExpense.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId,
      employeeDeleted: { $ne: true }
    }).populate('employeeId', 'name email');
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    return await streamExpensePdf(res, expense, 'attachment');
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/company/expenses/:id/pdf', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const expense = await HiringExpense.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId,
      adminDeleted: { $ne: true }
    }).populate('employeeId', 'name email');
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    return await streamExpensePdf(res, expense, 'attachment');
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/company/expenses/:id', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const { status, adminComment } = req.body;
    const expense = await HiringExpense.findOne({ _id: req.params.id, companyId: req.hiringUser.companyId });
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    if (status) expense.status = status;
    if (adminComment !== undefined) expense.adminComment = adminComment;
    expense.reviewedAt = new Date();
    expense.reviewedBy = {
      id: req.hiringUser.adminId || req.hiringUser.userId || req.hiringUser.companyId,
      name: req.hiringUser.name || 'Company Admin',
      email: req.hiringUser.email || ''
    };
    await expense.save();
    const employee = await HiringEmployee.findById(expense.employeeId);
    if (employee) {
      await mail(
        employee.email,
        'Expense Update',
        `<p>Your expense request has been ${expense.status}.</p><p>${adminComment || ''}</p>`,
        'tabaltllp@gmail.com',
        'Tabalt Hiring Pro'
      );
    }
    res.json({ success: true, expense });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/company/expenses/:id', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const expense = await HiringExpense.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!expense) return res.status(404).json({ message: 'Expense not found' });

    await deleteExpenseAssets(expense);
    expense.adminDeleted = true;
    await expense.save();
    await expense.deleteOne();

    const employee = await HiringEmployee.findById(expense.employeeId);
    if (employee) {
      await mail(
        employee.email,
        'Expense Removed',
        '<p>Your expense report has been removed by the administrator.</p>',
        'tabaltllp@gmail.com',
        'Tabalt Hiring Pro'
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Employee profile update
router.put('/employee/profile', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const updates = req.body || {};
    const profile = await HiringEmployeeProfile.findOneAndUpdate(
      { employeeId: req.hiringUser.employeeId, companyId: req.hiringUser.companyId },
      { ...updates, employeeId: req.hiringUser.employeeId, companyId: req.hiringUser.companyId },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, profile });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/employee/profile/image', requireHiringAuth(['employee']), upload.fields([{ name: 'avatar', maxCount: 1 }]), uploadToCloudinary, async (req, res) => {
  try {
    const avatarFile = req.uploadedFiles?.find(file => file.type === 'avatar');
    if (!avatarFile?.url) {
      return res.status(400).json({ message: 'Profile image upload is required' });
    }

    const existing = await HiringEmployeeProfile.findOne({
      employeeId: req.hiringUser.employeeId,
      companyId: req.hiringUser.companyId
    });
    if (existing?.profileImagePublicId) {
      try {
        await deleteFromCloudinary(existing.profileImagePublicId, 'image');
      } catch (error) {
        console.error('Profile image delete error:', error);
      }
    }

    const profile = await HiringEmployeeProfile.findOneAndUpdate(
      { employeeId: req.hiringUser.employeeId, companyId: req.hiringUser.companyId },
      {
        employeeId: req.hiringUser.employeeId,
        companyId: req.hiringUser.companyId,
        profileImageUrl: avatarFile.url,
        profileImagePublicId: avatarFile.publicId
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, profile });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/employee/profile', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const employee = await HiringEmployee.findOne({
      _id: req.hiringUser.employeeId,
      companyId: req.hiringUser.companyId
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    const profile = await HiringEmployeeProfile.findOne({
      employeeId: employee._id,
      companyId: req.hiringUser.companyId
    });
    res.json({ success: true, employee, profile });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/employee/documents', requireHiringAuth(['employee']), upload.fields([{ name: 'document', maxCount: 1 }]), uploadToCloudinary, async (req, res) => {
  try {
    const { title, type } = req.body;
    const docFile = req.uploadedFiles?.find(file => file.type === 'document');
    if (!docFile) return res.status(400).json({ message: 'Document upload is required' });
    const doc = await HiringDocument.create({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId,
      title: title || docFile.fileName,
      type: type || 'document',
      fileUrl: docFile.url,
      filePublicId: docFile.publicId,
      fileName: docFile.fileName || '',
      fileMimeType: docFile.mimeType || '',
      content: docFile.url,
      createdBy: req.hiringUser.employeeId,
      createdByRole: 'employee'
    });
    res.json({ success: true, document: doc });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/employee/documents', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const documents = await HiringDocument.find({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    });
    res.json({ success: true, documents });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/employee/documents/:id/view', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const document = await HiringDocument.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    });
    if (!document) return res.status(404).json({ message: 'Document not found' });
    return await streamDocumentFile(res, document, 'inline');
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load document' });
  }
});

router.get('/employee/documents/:id/download', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const document = await HiringDocument.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    });
    if (!document) return res.status(404).json({ message: 'Document not found' });
    return await streamDocumentFile(res, document, 'attachment');
  } catch (error) {
    return res.status(500).json({ message: 'Unable to download document' });
  }
});

router.delete('/employee/documents/:id', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const document = await HiringDocument.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    });
    if (!document) return res.status(404).json({ message: 'Document not found' });
    if (document.filePublicId) {
      try {
        await deleteFromCloudinary(document.filePublicId, 'raw');
      } catch (error) {
        console.error('Document delete error (raw):', error);
      }
      try {
        await deleteFromCloudinary(document.filePublicId, 'image');
      } catch (error) {
        console.error('Document delete error (image):', error);
      }
    }
    await document.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Unable to delete document' });
  }
});

router.get('/employee/salary-breakdown', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const profile = await HiringEmployeeProfile.findOne({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    });
    if (profile?.salaryBreakup?.components?.length) {
      return res.json({
        success: true,
        salaryBreakup: profile.salaryBreakup,
        salaryUpdatedBy: profile.salaryUpdatedBy,
        salaryUpdatedAt: profile.salaryUpdatedAt
      });
    }

    const offerLetter = await HiringOfferLetter.findOne({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    }).sort({ createdAt: -1 });
    res.json({ success: true, ctcBreakdown: offerLetter?.ctcBreakdown || '' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Admin employee detail view
router.get('/company/employees/:id', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const employee = await HiringEmployee.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    await ensureEmployeeCode(employee);
    const [timesheets, holidays, documents, offerLetters, profile, expenses] = await Promise.all([
      HiringTimesheet.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringHoliday.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringDocument.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringOfferLetter.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringEmployeeProfile.findOne({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringExpense.find({ companyId: req.hiringUser.companyId, employeeId: employee._id })
    ]);
    res.json({ success: true, employee, profile, timesheets, holidays, documents, offerLetters, expenses });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/company/employees/:id/salary-breakup/generate', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const employee = await HiringEmployee.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const currency = req.body?.currency || 'USD';
    const template = await generateSalaryTemplate(currency);
    const normalized = normalizeSalaryBreakup(template);
    res.json({ success: true, salaryBreakup: normalized });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/company/employees/:id/salary-breakup', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const employee = await HiringEmployee.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const normalized = normalizeSalaryBreakup(req.body?.salaryBreakup || {});
    const profile = await HiringEmployeeProfile.findOneAndUpdate(
      { employeeId: employee._id, companyId: req.hiringUser.companyId },
      {
        employeeId: employee._id,
        companyId: req.hiringUser.companyId,
        salaryBreakup: normalized,
        salaryUpdatedBy: {
          id: req.hiringUser.adminId || req.hiringUser.userId || req.hiringUser.companyId,
          name: req.hiringUser.name || 'Company Admin',
          role: 'company_admin'
        },
        salaryUpdatedAt: new Date()
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const [timesheets, holidays, documents, offerLetters, expenses] = await Promise.all([
      HiringTimesheet.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringHoliday.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringDocument.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringOfferLetter.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringExpense.find({ companyId: req.hiringUser.companyId, employeeId: employee._id })
    ]);

    res.json({
      success: true,
      employee,
      profile,
      timesheets,
      holidays,
      documents,
      offerLetters,
      expenses
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Admin update employee details + profile
router.put('/company/employees/:id/profile', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const { employee: employeeUpdates = {}, profile: profileUpdates = {} } = req.body || {};
    const employee = await HiringEmployee.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    if (employeeUpdates.name !== undefined) employee.name = employeeUpdates.name;
    if (employeeUpdates.email !== undefined) employee.email = employeeUpdates.email;
    if (employeeUpdates.designation !== undefined) employee.designation = employeeUpdates.designation;
    await employee.save();

    const profile = await HiringEmployeeProfile.findOneAndUpdate(
      { employeeId: employee._id, companyId: req.hiringUser.companyId },
      { ...profileUpdates, employeeId: employee._id, companyId: req.hiringUser.companyId },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const [timesheets, holidays, documents, offerLetters, expenses] = await Promise.all([
      HiringTimesheet.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringHoliday.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringDocument.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringOfferLetter.find({ companyId: req.hiringUser.companyId, employeeId: employee._id }),
      HiringExpense.find({ companyId: req.hiringUser.companyId, employeeId: employee._id })
    ]);

    res.json({ success: true, employee, profile, timesheets, holidays, documents, offerLetters, expenses });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/company/documents/:id/view', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const document = await HiringDocument.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!document) return res.status(404).json({ message: 'Document not found' });
    return await streamDocumentFile(res, document, 'inline');
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load document' });
  }
});

router.get('/company/documents/:id/download', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const document = await HiringDocument.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!document) return res.status(404).json({ message: 'Document not found' });
    return await streamDocumentFile(res, document, 'attachment');
  } catch (error) {
    return res.status(500).json({ message: 'Unable to download document' });
  }
});

router.delete('/company/documents/:id', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const document = await HiringDocument.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId
    });
    if (!document) return res.status(404).json({ message: 'Document not found' });
    if (document.filePublicId) {
      try {
        await deleteFromCloudinary(document.filePublicId, 'raw');
      } catch (error) {
        console.error('Document delete error (raw):', error);
      }
      try {
        await deleteFromCloudinary(document.filePublicId, 'image');
      } catch (error) {
        console.error('Document delete error (image):', error);
      }
    }
    await document.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Unable to delete document' });
  }
});

router.post('/employee/offer-letters/upload', requireHiringAuth(['employee']), upload.fields([{ name: 'offerLetter', maxCount: 1 }]), async (req, res) => {
  try {
    const offerFile = req.files?.offerLetter?.[0];
    if (!offerFile) {
      return res.status(400).json({ message: 'Offer letter PDF is required' });
    }
    if (!offerFile.mimetype.includes('pdf')) {
      return res.status(400).json({ message: 'Offer letter must be a PDF file' });
    }

    const employee = await HiringEmployee.findById(req.hiringUser.employeeId);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    const company = await HiringCompany.findById(req.hiringUser.companyId);
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const uploadResult = await uploadRawToCloudinary(offerFile.buffer, {
      folder: `hiring-pro/offer-letters/${company._id}`,
      resource_type: 'image',
      format: 'pdf',
      public_id: `employee-offer-letter-${Date.now()}`,
      content_type: 'application/pdf',
      type: 'upload'
    });

    const offerLetter = await HiringOfferLetter.create({
      companyId: company._id,
      employeeId: employee._id,
      candidateName: employee.name,
      roleTitle: employee.designation || 'Employee',
      startDate: new Date().toISOString().split('T')[0],
      salaryPackage: 'N/A',
      ctcBreakdown: '',
      content: 'Uploaded offer letter',
      fileUrl: uploadResult?.secure_url || null,
      filePublicId: uploadResult?.public_id || null,
      companyName: company.name || '',
      companyLogoUrl: company.logoUrl || null,
      signingAuthorityName: company.signingAuthority?.name || '',
      signingAuthorityTitle: company.signingAuthority?.title || '',
      status: 'uploaded',
      createdBy: null
    });

    res.json({ success: true, offerLetter });
  } catch (error) {
    console.error('Employee offer letter upload error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/employee/offer-letters/:id/view', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const offerLetter = await HiringOfferLetter.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    });
    if (!offerLetter || !offerLetter.fileUrl) {
      return res.status(404).json({ message: 'Offer letter not found' });
    }

    const signedUrl = offerLetter.filePublicId
      ? getSignedDownloadUrl(offerLetter.filePublicId, 'pdf', { resource_type: 'image', type: 'upload' })
      : offerLetter.fileUrl;

    const fileResponse = await axios.get(signedUrl, { responseType: 'arraybuffer' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="document-${offerLetter.candidateName || 'document'}.pdf"`
    );
    return res.send(fileResponse.data);
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load offer letter' });
  }
});

router.get('/employee/offer-letters/:id/download', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const offerLetter = await HiringOfferLetter.findOne({
      _id: req.params.id,
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId
    });
    if (!offerLetter || !offerLetter.fileUrl) {
      return res.status(404).json({ message: 'Offer letter not found' });
    }

    const signedUrl = offerLetter.filePublicId
      ? getSignedDownloadUrl(offerLetter.filePublicId, 'pdf', { resource_type: 'image', type: 'upload' })
      : offerLetter.fileUrl;

    const fileResponse = await axios.get(signedUrl, { responseType: 'arraybuffer' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="document-${offerLetter.candidateName || 'document'}.pdf"`
    );
    return res.send(fileResponse.data);
  } catch (error) {
    return res.status(500).json({ message: 'Unable to download offer letter' });
  }
});

router.post(
  '/employee/offer-letters/:id/sign',
  requireHiringAuth(['employee']),
  upload.fields([{ name: 'signature', maxCount: 1 }]),
  uploadToCloudinary,
  async (req, res) => {
    try {
      const offerLetter = await HiringOfferLetter.findOne({
        _id: req.params.id,
        companyId: req.hiringUser.companyId,
        employeeId: req.hiringUser.employeeId
      });
      if (!offerLetter) return res.status(404).json({ message: 'Document not found' });

      const signatureFile = req.uploadedFiles?.find(file => file.type === 'signature');
      if (!signatureFile?.url) {
        return res.status(400).json({ message: 'Signature upload is required' });
      }

      offerLetter.employeeSignatureUrl = signatureFile.url;
      offerLetter.employeeSignaturePublicId = signatureFile.publicId;
      offerLetter.employeeSignedAt = new Date();

      const company = await HiringCompany.findById(req.hiringUser.companyId);
      if (!company) return res.status(404).json({ message: 'Company not found' });

      const pdfBuffer = await buildDocumentPdfBuffer(company, {
        candidateName: offerLetter.candidateName,
        title: offerLetter.documentTitle || '',
        employeeCode: offerLetter.employeeCode || '',
        documentType: offerLetter.documentType,
        documentTypeLabel: offerLetter.customDocumentType || offerLetter.documentType,
        documentTitle: offerLetter.documentTitle || '',
        documentDate: offerLetter.documentDate || '',
        documentLogoUrl: offerLetter.documentLogoUrl || company.logoUrl || null,
        adminSignatureUrl: offerLetter.adminSignatureUrl || '',
        employeeSignatureUrl: offerLetter.employeeSignatureUrl
      }, offerLetter.content || '');

      const uploadResult = await uploadRawToCloudinary(pdfBuffer, {
        folder: `hiring-pro/documents/${company._id}`,
        resource_type: 'image',
        format: 'pdf',
        public_id: offerLetter.filePublicId || `document-${Date.now()}`,
        content_type: 'application/pdf',
        type: 'upload'
      });

      offerLetter.fileUrl = uploadResult?.secure_url || offerLetter.fileUrl;
      offerLetter.filePublicId = uploadResult?.public_id || offerLetter.filePublicId;
      await offerLetter.save();

      res.json({ success: true, offerLetter });
    } catch (error) {
      console.error('Employee signature upload error:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

module.exports = router;
