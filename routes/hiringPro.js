const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { upload, uploadToCloudinary } = require('../middleware/cloudinaryUpload');
const HiringCompany = require('../models/HiringCompany');
const HiringCompanyAdmin = require('../models/HiringCompanyAdmin');
const HiringEmployee = require('../models/HiringEmployee');
const HiringOfferLetter = require('../models/HiringOfferLetter');
const { generateAIResponse } = require('../services/openaiService');

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

const ensureSeedCompanies = async () => {
  const existing = await HiringCompany.find({});
  if (existing.length >= 2) return;

  const companyA = await HiringCompany.create({
    name: 'Company A',
    logoUrl: null,
    signingAuthority: { name: 'Alice Morgan', title: 'Chief People Officer' }
  });
  const companyB = await HiringCompany.create({
    name: 'Company B',
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

// Company onboarding (public)
router.post('/companies', upload.fields([{ name: 'logo', maxCount: 1 }]), uploadToCloudinary, async (req, res) => {
  try {
    const { companyName, authorityName, authorityTitle } = req.body;
    if (!companyName || !authorityName || !authorityTitle) {
      return res.status(400).json({ message: 'Company name and signing authority are required' });
    }

    const logoFile = req.uploadedFiles?.find(file => file.type === 'logo');
    const logoUrl = logoFile ? logoFile.url : null;

    const company = await HiringCompany.create({
      name: companyName.trim(),
      logoUrl,
      signingAuthority: {
        name: authorityName.trim(),
        title: authorityTitle.trim()
      }
    });

    const generatedEmail = `admin@${companyName.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'company'}.demo`;
    const generatedPassword = crypto.randomBytes(6).toString('hex');

    const companyAdmin = await HiringCompanyAdmin.create({
      companyId: company._id,
      name: authorityName.trim(),
      email: generatedEmail,
      password: generatedPassword
    });

    res.json({
      success: true,
      company,
      adminCredentials: {
        email: companyAdmin.email,
        password: generatedPassword
      }
    });
  } catch (error) {
    console.error('Hiring Pro company onboarding error:', error);
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

    const content = await generateAIResponse(prompt, [], 'hiring_pro');
    res.json({ success: true, content });
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
    const offerLetter = await HiringOfferLetter.create({
      companyId: req.hiringUser.companyId,
      candidateName,
      roleTitle,
      startDate,
      salaryPackage,
      ctcBreakdown: ctcBreakdown || '',
      content,
      createdBy: req.hiringUser.adminId
    });
    res.json({ success: true, offerLetter });
  } catch (error) {
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

module.exports = router;
