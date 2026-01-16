const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const { upload, uploadToCloudinary } = require('../middleware/cloudinaryUpload');
const { uploadToCloudinary: uploadRawToCloudinary, deleteFromCloudinary } = require('../services/cloudinary');
const { protect, authorize } = require('../middleware/auth');
const HiringCompany = require('../models/HiringCompany');
const HiringCompanyAdmin = require('../models/HiringCompanyAdmin');
const HiringEmployee = require('../models/HiringEmployee');
const HiringOfferLetter = require('../models/HiringOfferLetter');
const User = require('../models/User');
const { generateAIResponse } = require('../services/openaiService');
const { mail } = require('../utils/sendEmail');
const HiringHoliday = require('../models/HiringHoliday');
const HiringTimesheet = require('../models/HiringTimesheet');
const HiringDocument = require('../models/HiringDocument');
const HiringEmployeeProfile = require('../models/HiringEmployeeProfile');
const HiringExpense = require('../models/HiringExpense');

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

const buildOfferLetterPdfBuffer = async (company, offer, content) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  if (company?.logoUrl) {
    try {
      const logoResponse = await axios.get(company.logoUrl, { responseType: 'arraybuffer' });
      doc.image(logoResponse.data, { width: 120 });
      doc.moveDown();
    } catch (error) {
      console.warn('Unable to load company logo for offer letter:', error.message);
    }
  }

  if (company?.name) {
    doc.fontSize(18).text(company.name);
    doc.moveDown(0.5);
  }

  doc.fontSize(14).text('Offer Letter', { underline: true });
  doc.moveDown();
  if (offer.startDate) {
    doc.fontSize(12).text(`Date: ${offer.startDate}`);
  }
  doc.fontSize(12).text(`Candidate: ${offer.candidateName}`);
  doc.text(`Role: ${offer.roleTitle}`);
  doc.text(`Salary Package: ${offer.salaryPackage}`);
  if (offer.ctcBreakdown) {
    doc.moveDown(0.5);
    doc.text(`CTC Breakdown: ${offer.ctcBreakdown}`);
  }
  doc.moveDown();

  const lines = sanitizeOfferContent(content || '').split(/\r?\n/);
  lines.forEach((line) => {
    if (!line.trim()) {
      doc.moveDown();
      return;
    }
    doc.text(line);
  });

  doc.moveDown();
  doc.text('Signing Authority', { underline: true });
  doc.font('Helvetica-Oblique').text(company?.signingAuthority?.name || '');
  doc.font('Helvetica').text(company?.signingAuthority?.title || '');
  doc.moveDown(0.5);
  doc.font('Helvetica-Oblique').text(`Digitally signed by ${company?.signingAuthority?.name || ''}`);

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
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
    const { name, email, password, companyId } = req.body;
    if (!name || !email || !password || !companyId) {
      return res.status(400).json({ message: 'Name, email, password, and company are required' });
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

    const employee = await HiringEmployee.create({
      companyId: company._id,
      name: name.trim(),
      email: email.toLowerCase(),
      password
    });

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
    res.json({ success: true, employees });
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
    res.json({ success: true, employee });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Offer letter generation
router.post('/company/offer-letter/generate', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const company = await HiringCompany.findById(req.hiringUser.companyId);
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const { candidateName, roleTitle, startDate, salaryPackage, ctcBreakdown, notes } = req.body;
    if (!candidateName || !roleTitle || !startDate || !salaryPackage) {
      return res.status(400).json({ message: 'Candidate name, role, start date, and salary are required' });
    }

    const prompt = `Generate a professional HR offer letter.
Company: ${company.name}
Signing Authority: ${company.signingAuthority.name}, ${company.signingAuthority.title}
Candidate: ${candidateName}
Role: ${roleTitle}
Start Date: ${startDate}
Salary Package: ${salaryPackage}
CTC Breakdown: ${ctcBreakdown || 'Not provided'}
Additional Notes: ${notes || 'None'}
Requirements:
- Formal HR tone
- Include sections: Offer Overview, Compensation, Joining Details, Sign-off
- Use placeholders already provided (do not invent new names)
Return plain text with clear headings.`;

    const content = await generateAIResponse(prompt, [], 'hiring');
    const sanitized = sanitizeOfferContent(content || '');
    res.json({ success: true, content: sanitized });
  } catch (error) {
    console.error('Offer letter generation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/company/offer-letter', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const { candidateName, roleTitle, startDate, salaryPackage, ctcBreakdown, content } = req.body;
    if (!candidateName || !roleTitle || !startDate || !salaryPackage || !content) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const company = await HiringCompany.findById(req.hiringUser.companyId);
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const sanitizedContent = sanitizeOfferContent(content || '');

    const pdfBuffer = await buildOfferLetterPdfBuffer(company, {
      candidateName,
      roleTitle,
      startDate,
      salaryPackage,
      ctcBreakdown: ctcBreakdown || ''
    }, sanitizedContent);

    const uploadResult = await uploadRawToCloudinary(pdfBuffer, {
      folder: `hiring-pro/offer-letters/${company._id}`,
      resource_type: 'raw',
      format: 'pdf',
      public_id: `offer-letter-${Date.now()}`
    });

    const offerLetter = await HiringOfferLetter.create({
      companyId: req.hiringUser.companyId,
      candidateName,
      roleTitle,
      startDate,
      salaryPackage,
      ctcBreakdown: ctcBreakdown || '',
      content: sanitizedContent,
      fileUrl: uploadResult?.secure_url || null,
      filePublicId: uploadResult?.public_id || null,
      companyName: company.name || '',
      companyLogoUrl: company.logoUrl || null,
      signingAuthorityName: company.signingAuthority?.name || '',
      signingAuthorityTitle: company.signingAuthority?.title || '',
      createdBy: req.hiringUser.adminId
    });
    res.json({ success: true, offerLetter });
  } catch (error) {
    console.error('Offer letter save error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

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

    const fileResponse = await axios.get(offerLetter.fileUrl, { responseType: 'arraybuffer' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="offer-letter-${offerLetter.candidateName || 'document'}.pdf"`
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
        console.error('Offer letter Cloudinary delete error:', error);
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

// Employee submit expense (future-ready)
router.post('/employee/expenses', requireHiringAuth(['employee']), async (req, res) => {
  try {
    const { amount, description } = req.body;
    if (!amount || !description) {
      return res.status(400).json({ message: 'Amount and description are required' });
    }
    const expense = await HiringExpense.create({
      companyId: req.hiringUser.companyId,
      employeeId: req.hiringUser.employeeId,
      amount: Number(amount),
      description,
      status: 'pending'
    });
    const admins = await HiringCompanyAdmin.find({ companyId: req.hiringUser.companyId });
    await Promise.all(admins.map(admin => mail(
      admin.email,
      'Expense Submitted',
      `<p>An employee submitted an expense: ${description} (£${amount}).</p>`,
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
      employeeId: req.hiringUser.employeeId
    }).sort({ createdAt: -1 });
    res.json({ success: true, expenses });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/company/expenses', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const expenses = await HiringExpense.find({ companyId: req.hiringUser.companyId })
      .populate('employeeId', 'name email');
    res.json({ success: true, expenses });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/company/expenses/:id', requireHiringAuth(['company_admin']), async (req, res) => {
  try {
    const { status } = req.body;
    const expense = await HiringExpense.findOne({ _id: req.params.id, companyId: req.hiringUser.companyId });
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    if (status) expense.status = status;
    await expense.save();
    const employee = await HiringEmployee.findById(expense.employeeId);
    if (employee) {
      await mail(
        employee.email,
        'Expense Update',
        `<p>Your expense request has been ${expense.status}.</p>`,
        'tabaltllp@gmail.com',
        'Tabalt Hiring Pro'
      );
    }
    res.json({ success: true, expense });
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
      title: title || docFile.name,
      type: type || 'document',
      fileUrl: docFile.url,
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

router.get('/employee/salary-breakdown', requireHiringAuth(['employee']), async (req, res) => {
  try {
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

module.exports = router;
