const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Service = require('../models/Service');
const Plan = require('../models/Plan');
const Transaction = require('../models/Transaction');
const ChatSession = require('../models/ChatSession');
const Message = require('../models/Message');
const Timesheet = require('../models/Timesheet');
const Lead = require('../models/Lead');
const AgentHoliday = require('../models/AgentHoliday');
const AgentHours = require('../models/AgentHours');
const ResumeBuilderUsage = require('../models/ResumeBuilderUsage');
const Activity = require('../models/Activity');
const { addTokens } = require('../services/tokenService');
const generatePassword = require('../utils/generatePassword');
const { sendCredentialsEmail } = require('../utils/sendEmail');
const { upload, uploadToCloudinary } = require('../middleware/cloudinaryUpload');
const { videoUpload } = require('../middleware/upload');
const path = require('path');
const fs = require('fs');

// ========== SERVICE MANAGEMENT ==========

// @route   POST /api/admin/services
// @desc    Create a new service
// @access  Private (Admin)
router.post('/services', protect, authorize('admin'), [
  body('name').trim().notEmpty().withMessage('Service name is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, subServices } = req.body;

    const service = await Service.create({
      name,
      description,
      subServices: subServices || []
    });

    res.status(201).json({ success: true, service });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/admin/services
// @desc    Get all services
// @access  Private (Admin)
router.get('/services', protect, authorize('admin'), async (req, res) => {
  try {
    const services = await Service.find().sort({ createdAt: -1 });
    res.json({ success: true, services });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/admin/services/:id
// @desc    Update a service
// @access  Private (Admin)
router.put('/services/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { name, description, subServices, isActive } = req.body;

    const service = await Service.findByIdAndUpdate(
      req.params.id,
      { name, description, subServices, isActive },
      { new: true, runValidators: true }
    );

    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.json({ success: true, service });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   DELETE /api/admin/services/:id
// @desc    Delete a service
// @access  Private (Admin)
router.delete('/services/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const service = await Service.findByIdAndDelete(req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }
    res.json({ success: true, message: 'Service deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== PLAN MANAGEMENT ==========

// @route   POST /api/admin/plans
// @desc    Create a new plan
// @access  Private (Admin)
router.post('/plans', protect, authorize('admin'), [
  body('name').trim().notEmpty().withMessage('Plan name is required'),
  body('price').isNumeric().withMessage('Price must be a number'),
  body('tokens').isNumeric().withMessage('Tokens must be a number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, price, tokens, minutesPerMonth, hoursPerMonth, bonusFeatures, isActive } = req.body;

    const plan = await Plan.create({
      name,
      description,
      price,
      tokens,
      minutesPerMonth: minutesPerMonth || null,
      hoursPerMonth: hoursPerMonth || null, // Keep for backward compatibility
      bonusFeatures: bonusFeatures || [],
      isActive: isActive !== undefined ? isActive : true
    });

    res.status(201).json({ success: true, plan });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/admin/plans
// @desc    Get all plans
// @access  Private (Admin)
router.get('/plans', protect, authorize('admin'), async (req, res) => {
  try {
    const plans = await Plan.find().sort({ createdAt: -1 });
    res.json({ success: true, plans });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/admin/plans/:id
// @desc    Update a plan
// @access  Private (Admin)
router.put('/plans/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { name, description, price, tokens, minutesPerMonth, hoursPerMonth, bonusFeatures, isActive } = req.body;
    
    const plan = await Plan.findByIdAndUpdate(
      req.params.id,
      { name, description, price, tokens, minutesPerMonth, hoursPerMonth, bonusFeatures, isActive },
      { new: true, runValidators: true }
    );

    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    res.json({ success: true, plan });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   DELETE /api/admin/plans/:id
// @desc    Delete a plan
// @access  Private (Admin)
router.delete('/plans/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const plan = await Plan.findByIdAndDelete(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }
    res.json({ success: true, message: 'Plan deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== AGENT MANAGEMENT ==========

// @route   POST /api/admin/agents
// @desc    Create a new agent
// @access  Private (Admin)
router.post('/agents', protect, authorize('admin'), upload.fields([{ name: 'avatar', maxCount: 1 }]), uploadToCloudinary, [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').normalizeEmail().isEmail().withMessage('Please provide a valid email'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('country').trim().notEmpty().withMessage('Country is required'),
  body('serviceCategories').custom((value) => {
    // Accept either single serviceCategory (for backward compatibility) or array of serviceCategories
    if (!value || (Array.isArray(value) && value.length === 0)) {
      throw new Error('At least one service category is required');
    }
    return true;
  })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Normalize and extract data from request body
    const name = req.body.name ? req.body.name.trim() : '';
    const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
    const phone = req.body.phone ? req.body.phone.trim() : '';
    const country = req.body.country ? req.body.country.trim() : '';
    
    // Handle both single serviceCategory (backward compatibility) and array of serviceCategories
    // FormData sends arrays as multiple fields with the same name, which Express parses as array or string
    let serviceCategories = [];
    if (req.body.serviceCategories) {
      // If it's already an array, use it directly
      if (Array.isArray(req.body.serviceCategories)) {
        serviceCategories = req.body.serviceCategories.map(id => String(id).trim()).filter(id => id !== '');
      } else {
        // If it's a single value (string), convert to array
        const singleId = String(req.body.serviceCategories).trim();
        if (singleId) {
          serviceCategories = [singleId];
        }
      }
    } else if (req.body.serviceCategory) {
      // Backward compatibility: support old single serviceCategory field
      const singleId = String(req.body.serviceCategory).trim();
      if (singleId) {
        serviceCategories = [singleId];
      }
    }
    
    console.log('📋 Service categories received:', serviceCategories);

    // Validate normalized fields
    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Please provide a valid email' });
    }
    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required' });
    }
    if (!country) {
      return res.status(400).json({ message: 'Country is required' });
    }
    if (!serviceCategories || serviceCategories.length === 0) {
      return res.status(400).json({ message: 'At least one service category is required' });
    }

    // Check if user already exists (using normalized lowercase email)
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      console.log(`❌ Email already exists: ${email} (found user: ${existingUser._id}, role: ${existingUser.role})`);
      return res.status(400).json({ 
        message: 'User already exists with this email',
        email: email
      });
    }

    // Validate and verify all service categories exist
    const validServiceIds = [];
    for (const serviceId of serviceCategories) {
      const trimmedId = serviceId.trim();
      if (!require('mongoose').Types.ObjectId.isValid(trimmedId)) {
        return res.status(400).json({ message: `Invalid service category ID format: ${trimmedId}` });
      }
      
      const service = await Service.findById(trimmedId);
      if (!service) {
        return res.status(400).json({ message: `Service category not found: ${trimmedId}` });
      }
      validServiceIds.push(trimmedId);
    }
    
    // Remove duplicates
    const uniqueServiceIds = [...new Set(validServiceIds)];

    // Get avatar URL if uploaded
    let avatarUrl = null;
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const avatarFile = req.uploadedFiles.find(f => f.type === 'avatar');
      if (avatarFile) {
        avatarUrl = avatarFile.url;
      }
    }

    // Get password from request or generate one
    let password = req.body.password;
    if (!password || password.trim() === '') {
      // If no password provided, generate one
      password = generatePassword();
    }

    // Store plain password for admin viewing
    const plainPassword = password;

    // Create agent (password will be hashed by pre-save hook, email will be lowercased by schema)
    // Explicitly set customerId to null for agents to prevent any issues
    console.log(`📝 Creating agent with email: ${email}, name: ${name}, serviceCategories: ${uniqueServiceIds.join(', ')}`);
    console.log(`📝 Agent data:`, {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      country: country.trim(),
      role: 'agent',
      serviceCategories: uniqueServiceIds,
      hasPassword: !!password,
      hasAvatar: !!avatarUrl
    });
    
    // Create agent - DO NOT include customerId field at all for agents
    // The pre-save hook will handle ensuring it's not set
    const agentData = {
      name: name.trim(),
      email: email.toLowerCase().trim(), // Ensure lowercase and trimmed
      phone: phone.trim(),
      country: country.trim(),
      password,
      plainPassword, // Store plain text for admin viewing
      role: 'agent',
      serviceCategory: uniqueServiceIds[0] || null, // Keep for backward compatibility
      serviceCategories: uniqueServiceIds, // New array field
      avatar: avatarUrl
      // Explicitly DO NOT include customerId - let the pre-save hook handle it
    };
    
    console.log('📝 Creating agent with data (customerId excluded):', {
      ...agentData,
      password: '[HIDDEN]',
      plainPassword: '[HIDDEN]'
    });
    
    // Check for any existing agents with customerId (shouldn't happen, but helps debug)
    const agentsWithCustomerId = await User.find({ 
      role: 'agent', 
      customerId: { $exists: true, $ne: null } 
    }).select('_id name email customerId');
    
    if (agentsWithCustomerId.length > 0) {
      console.warn(`⚠️ Found ${agentsWithCustomerId.length} existing agents with customerId:`, 
        agentsWithCustomerId.map(a => ({ id: a._id, name: a.name, customerId: a.customerId }))
      );
    }
    
    // Create agent using new User() and save() for better control
    const agent = new User(agentData);
    // Explicitly ensure customerId is not set
    agent.customerId = undefined;
    await agent.save();
    console.log(`✅ Agent created successfully: ${agent._id}`);

    // Track activity
    Activity.create({
      type: 'agent_registered',
      description: `New agent registered: ${name} (${email})`,
      user: agent._id,
      metadata: { name, email, phone, country, serviceCategories: uniqueServiceIds }
    }).catch(err => console.error('Error creating activity:', err));

    // Send credentials email (only if password was auto-generated)
    if (!req.body.password || req.body.password.trim() === '') {
      try {
        console.log(`📧 Sending agent credentials email to ${email}...`);
        await sendCredentialsEmail(email, plainPassword, 'agent', name);
        console.log(`✅ Agent credentials email sent successfully to ${email}`);
      } catch (emailError) {
        console.error(`❌ Failed to send agent credentials email to ${email}:`, emailError.message);
        // Don't fail agent creation if email fails, just log it
      }
    }

    // Fetch agent with plainPassword for response
    const agentWithPassword = await User.findById(agent._id)
      .select('+plainPassword')
      .populate('serviceCategory', 'name')
      .populate('serviceCategories', 'name');

    res.status(201).json({
      success: true,
      agent: agentWithPassword
    });
  } catch (error) {
    // Comprehensive error logging
    console.error('❌ ========== ERROR CREATING AGENT ==========');
    console.error('Error Name:', error.name);
    console.error('Error Code:', error.code);
    console.error('Error Message:', error.message);
    
    if (error.keyPattern) {
      console.error('Duplicate Key Pattern:', JSON.stringify(error.keyPattern, null, 2));
    }
    if (error.keyValue) {
      console.error('Duplicate Key Value:', JSON.stringify(error.keyValue, null, 2));
    }
    if (error.errors) {
      console.error('Validation Errors:', JSON.stringify(error.errors, null, 2));
    }
    if (error.stack) {
      console.error('Stack Trace:', error.stack);
    }
    console.error('Request Body:', {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      country: req.body.country,
      serviceCategory: req.body.serviceCategory,
      hasPassword: !!req.body.password
    });
    console.error('Normalized Data:', {
      name: req.body.name ? req.body.name.trim() : '',
      email: req.body.email ? req.body.email.toLowerCase().trim() : '',
      phone: req.body.phone ? req.body.phone.trim() : '',
      country: req.body.country ? req.body.country.trim() : '',
      serviceCategory: req.body.serviceCategory || 'N/A',
      serviceCategories: req.body.serviceCategories || 'N/A'
    });
    console.error('❌ ===========================================');
    
    // Handle MongoDB duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      const duplicateField = error.keyPattern ? Object.keys(error.keyPattern)[0] : 'unknown';
      const duplicateValue = error.keyValue ? error.keyValue[duplicateField] : 'unknown';
      
      // Provide user-friendly messages based on the duplicate field
      let userMessage = `User already exists with this ${duplicateField}`;
      if (duplicateField === 'email') {
        userMessage = 'User already exists with this email address';
      } else if (duplicateField === 'customerId') {
        userMessage = 'A user with this customer ID already exists. This is unusual - please contact support.';
      }
      
      console.error(`❌ Duplicate key error on field: ${duplicateField}, value: ${duplicateValue}`);
      return res.status(400).json({ 
        message: userMessage,
        field: duplicateField,
        value: duplicateValue,
        error: 'Duplicate entry',
        details: process.env.NODE_ENV === 'development' ? {
          keyPattern: error.keyPattern,
          keyValue: error.keyValue
        } : undefined
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      return res.status(400).json({ 
        message: 'Validation error',
        errors: validationErrors
      });
    }
    
    // Handle cast errors (invalid ObjectId, etc.)
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        message: `Invalid ${error.path}: ${error.value}`,
        error: 'Invalid data format'
      });
    }
    
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message,
      ...(process.env.NODE_ENV === 'development' && { 
        stack: error.stack,
        name: error.name,
        code: error.code
      })
    });
  }
});

// @route   GET /api/admin/agents
// @desc    Get all agents
// @access  Private (Admin)
router.get('/agents', protect, authorize('admin'), async (req, res) => {
  try {
    const agents = await User.find({ role: 'agent' })
      .select('+plainPassword') // Include plainPassword field
      .populate('serviceCategory', 'name') // Backward compatibility
      .populate('serviceCategories', 'name') // New multiple categories
      .sort({ createdAt: -1 });

    res.json({ success: true, agents });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/admin/agents/:id
// @desc    Update an agent
// @access  Private (Admin)
router.put('/agents/:id', protect, authorize('admin'), upload.fields([{ name: 'avatar', maxCount: 1 }]), uploadToCloudinary, async (req, res) => {
  try {
    // Normalize input data
    const name = req.body.name ? req.body.name.trim() : undefined;
    const email = req.body.email ? req.body.email.toLowerCase().trim() : undefined;
    const phone = req.body.phone ? req.body.phone.trim() : undefined;
    const country = req.body.country ? req.body.country.trim() : undefined;
    const isActive = req.body.isActive !== undefined ? req.body.isActive : undefined;
    const password = req.body.password ? req.body.password.trim() : undefined;

    // Handle both single serviceCategory (backward compatibility) and array of serviceCategories
    let serviceCategories = undefined;
    if (req.body.serviceCategories) {
      // If it's an array, use it directly
      if (Array.isArray(req.body.serviceCategories)) {
        serviceCategories = req.body.serviceCategories.filter(id => id && id.trim() !== '');
      } else {
        // If it's a single value, convert to array
        serviceCategories = [req.body.serviceCategories].filter(id => id && id.trim() !== '');
      }
    } else if (req.body.serviceCategory) {
      // Backward compatibility: support old single serviceCategory field
      serviceCategories = [req.body.serviceCategory].filter(id => id && id.trim() !== '');
    }

    const agent = await User.findById(req.params.id).select('+plainPassword');
    if (!agent || agent.role !== 'agent') {
      return res.status(404).json({ message: 'Agent not found' });
    }

    // Check if email is being changed and if it's already taken (normalize for comparison)
    if (email && email.toLowerCase() !== agent.email.toLowerCase()) {
      const normalizedEmail = email.toLowerCase().trim();
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser && existingUser._id.toString() !== agent._id.toString()) {
        return res.status(400).json({ message: 'Email already exists' });
      }
    }

    // Get avatar URL if uploaded
    let avatarUrl = agent.avatar; // Keep existing avatar if no new one uploaded
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const avatarFile = req.uploadedFiles.find(f => f.type === 'avatar');
      if (avatarFile) {
        avatarUrl = avatarFile.url;
      }
    }

    // Validate and verify all service categories if provided
    let validServiceIds = undefined;
    if (serviceCategories && serviceCategories.length > 0) {
      validServiceIds = [];
      for (const serviceId of serviceCategories) {
        const trimmedId = serviceId.trim();
        if (!require('mongoose').Types.ObjectId.isValid(trimmedId)) {
          return res.status(400).json({ message: `Invalid service category ID format: ${trimmedId}` });
        }
        
        const service = await Service.findById(trimmedId);
        if (!service) {
          return res.status(400).json({ message: `Service category not found: ${trimmedId}` });
        }
        validServiceIds.push(trimmedId);
      }
      // Remove duplicates
      validServiceIds = [...new Set(validServiceIds)];
    }

    // Update agent
    const updateData = {
      ...(name && { name: name.trim() }),
      ...(email && { email: email.toLowerCase().trim() }),
      ...(phone && { phone: phone.trim() }),
      ...(country && { country: country.trim() }),
      ...(isActive !== undefined && { isActive }),
      ...(avatarUrl && { avatar: avatarUrl })
    };

    // Update service categories if provided
    if (validServiceIds && validServiceIds.length > 0) {
      updateData.serviceCategory = validServiceIds[0]; // Keep first for backward compatibility
      updateData.serviceCategories = validServiceIds; // New array field
    }

    // Handle password update if provided
    if (password) {
      updateData.password = password; // Will be hashed by pre-save hook
      updateData.plainPassword = password; // Store plain text for admin viewing
    }

    const updatedAgent = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
    .select('+plainPassword')
    .populate('serviceCategory', 'name')
    .populate('serviceCategories', 'name');

    res.json({ success: true, agent: updatedAgent });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   DELETE /api/admin/agents/:id
// @desc    Delete an agent
// @access  Private (Admin)
router.delete('/agents/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const agent = await User.findById(req.params.id);
    
    if (!agent || agent.role !== 'agent') {
      return res.status(404).json({ message: 'Agent not found' });
    }

    // Check if agent has active chats
    const activeChats = await ChatSession.countDocuments({ 
      agent: agent._id, 
      status: 'active' 
    });

    if (activeChats > 0) {
      return res.status(400).json({ 
        message: `Cannot delete agent with ${activeChats} active chat(s). Please reassign or close chats first.` 
      });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Agent deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/admin/agents/:id/minutes
// @desc    Adjust agent minutes (can increase or decrease - use positive value to add, negative to subtract)
// @access  Private (Admin)
router.put('/agents/:id/minutes', protect, authorize('admin'), [
  body('amount').isNumeric().withMessage('Amount must be a number (positive to add, negative to subtract)'),
  body('reason').trim().notEmpty().withMessage('Reason is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { amount, reason } = req.body;
    const amountNum = parseFloat(amount);

    // Validate amount is not zero
    if (amountNum === 0) {
      return res.status(400).json({ message: 'Amount cannot be zero' });
    }

    const { addAgentMinutes } = require('../services/agentMinutesService');
    const result = await addAgentMinutes(
      req.params.id,
      amountNum,
      reason,
      req.user._id
    );

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    res.json({ 
      success: true, 
      minutes: result.minutes,
      totalEarned: result.totalEarned,
      message: amountNum > 0 
        ? `Successfully added ${amountNum} minutes. New balance: ${result.minutes}`
        : `Successfully deducted ${Math.abs(amountNum)} minutes. New balance: ${result.minutes}`
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== TRANSACTION MANAGEMENT ==========

// @route   GET /api/admin/transactions
// @desc    Get all transactions
// @access  Private (Admin)
router.get('/transactions', protect, authorize('admin'), async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate('customer', 'name email')
      .populate('plan', 'name price tokens')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, transactions });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/admin/transactions/:id/approve
// @desc    Approve a transaction
// @access  Private (Admin)
router.post('/transactions/:id/approve', protect, authorize('admin'), async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('plan')
      .populate('customer');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (transaction.status !== 'pending') {
      return res.status(400).json({ message: 'Transaction is not pending' });
    }

    // Update transaction
    transaction.status = 'approved';
    transaction.approvedBy = req.user._id;
    transaction.approvedAt = new Date();
    await transaction.save();

    // Add tokens to customer
    await addTokens(
      transaction.customer._id,
      transaction.tokens,
      'Plan purchase approved',
      req.user._id,
      transaction._id
    );

    // Update customer plan status
    await User.findByIdAndUpdate(transaction.customer._id, {
      planStatus: 'approved',
      currentPlan: transaction.plan._id
    });

    res.json({ success: true, transaction });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/admin/transactions/:id/reject
// @desc    Reject a transaction
// @access  Private (Admin)
router.post('/transactions/:id/reject', protect, authorize('admin'), async (req, res) => {
  try {
    const transaction = await Transaction.findByIdAndUpdate(
      req.params.id,
      {
        status: 'rejected',
        approvedBy: req.user._id,
        approvedAt: new Date()
      },
      { new: true }
    );

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    res.json({ success: true, transaction });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== CUSTOMER MANAGEMENT ==========

// @route   GET /api/admin/customers
// @desc    Get all customers
// @access  Private (Admin)
router.get('/customers', protect, authorize('admin'), async (req, res) => {
  try {
    const customers = await User.find({ role: 'customer' })
      .populate('currentPlan', 'name price tokens')
      .sort({ createdAt: -1 });

    res.json({ success: true, customers });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/admin/customers/:id
// @desc    Update a customer
// @access  Private (Admin)
router.put('/customers/:id', protect, authorize('admin'), upload.fields([{ name: 'avatar', maxCount: 1 }]), uploadToCloudinary, async (req, res) => {
  try {
    const { name, email, phone, country, isActive } = req.body;

    const customer = await User.findById(req.params.id);
    if (!customer || customer.role !== 'customer') {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Check if email is being changed and if it's already taken
    if (email && email !== customer.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already exists' });
      }
    }

    // Get avatar URL if uploaded
    let avatarUrl = customer.avatar; // Keep existing avatar if no new one uploaded
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const avatarFile = req.uploadedFiles.find(f => f.type === 'avatar');
      if (avatarFile) {
        avatarUrl = avatarFile.url;
      }
    }

    // Update customer
    const updateData = {
      ...(name && { name }),
      ...(email && { email }),
      ...(phone && { phone }),
      ...(country && { country }),
      ...(isActive !== undefined && { isActive }),
      ...(avatarUrl && { avatar: avatarUrl })
    };

    const updatedCustomer = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('currentPlan', 'name price tokens');

    res.json({ success: true, customer: updatedCustomer });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/admin/customers/:id/tokens
// @desc    Adjust customer tokens (can increase or decrease - use positive value to add, negative to subtract)
// @access  Private (Admin)
router.put('/customers/:id/tokens', protect, authorize('admin'), [
  body('amount').isNumeric().withMessage('Amount must be a number (positive to add, negative to subtract)'),
  body('reason').trim().notEmpty().withMessage('Reason is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { amount, reason } = req.body;
    const amountNum = parseFloat(amount);

    // Validate amount is not zero
    if (amountNum === 0) {
      return res.status(400).json({ message: 'Amount cannot be zero' });
    }

    const result = await addTokens(
      req.params.id,
      amountNum,
      reason,
      req.user._id
    );

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    res.json({ 
      success: true, 
      balance: result.balance,
      message: amountNum > 0 
        ? `Successfully added ${amountNum} tokens. New balance: ${result.balance}`
        : `Successfully deducted ${Math.abs(amountNum)} tokens. New balance: ${result.balance}`
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   DELETE /api/admin/customers/:id
// @desc    Delete a customer
// @access  Private (Admin)
router.delete('/customers/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const customer = await User.findById(req.params.id);
    
    if (!customer || customer.role !== 'customer') {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Check if customer has active chats
    const activeChats = await ChatSession.countDocuments({ 
      customer: customer._id, 
      status: 'active' 
    });

    if (activeChats > 0) {
      return res.status(400).json({ 
        message: `Cannot delete customer with ${activeChats} active chat(s). Please close chats first.` 
      });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== CHAT MANAGEMENT ==========

// @route   GET /api/admin/chats
// @desc    Get all chat sessions
// @access  Private (Admin)
router.get('/chats', protect, authorize('admin'), async (req, res) => {
  try {
    const chats = await ChatSession.find()
      .populate('customer', 'name email')
      .populate('agent', 'name email')
      .populate('service', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, chats });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/admin/chats/:id/transfer
// @desc    Transfer chat to another agent
// @access  Private (Admin)
router.post('/chats/:id/transfer', protect, authorize('admin'), [
  body('agentId').notEmpty().withMessage('Agent ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { agentId } = req.body;

    const chatSession = await ChatSession.findById(req.params.id);
    if (!chatSession) {
      return res.status(404).json({ message: 'Chat session not found' });
    }

    // Remove from old agent's active chats
    if (chatSession.agent) {
      await User.findByIdAndUpdate(chatSession.agent, {
        $pull: { activeChats: chatSession._id }
      });
    }

    // Assign to new agent
    chatSession.agent = agentId;
    chatSession.status = 'transferred';
    await chatSession.save();

    // Add to new agent's active chats
    await User.findByIdAndUpdate(agentId, {
      $addToSet: { activeChats: chatSession._id }
    });

    res.json({ success: true, chatSession });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard data
// @access  Private (Admin)
router.get('/dashboard', protect, authorize('admin'), async (req, res) => {
  try {
    const totalCustomers = await User.countDocuments({ role: 'customer' });
    const totalAgents = await User.countDocuments({ role: 'agent' });
    const totalServices = await Service.countDocuments();
    const pendingTransactions = await Transaction.countDocuments({ status: 'pending' });
    const activeChats = await ChatSession.countDocuments({ status: 'active' });
    const totalTransactions = await Transaction.countDocuments();

    const recentTransactions = await Transaction.find()
      .populate('customer', 'name email')
      .populate('plan', 'name')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      dashboard: {
        stats: {
          totalCustomers,
          totalAgents,
          totalServices,
          pendingTransactions,
          activeChats,
          totalTransactions
        },
        recentTransactions
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== TIMESHEET MANAGEMENT ==========

// @route   GET /api/admin/timesheets
// @desc    Get all timesheets
// @access  Private (Admin)
router.get('/timesheets', protect, authorize('admin'), async (req, res) => {
  try {
    const timesheets = await Timesheet.find()
      .populate('agentId', 'name email')
      .sort({ weekStart: -1, createdAt: -1 });

    res.json({ success: true, timesheets });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/admin/timesheets
// @desc    Create a new timesheet entry
// @access  Private (Admin)
router.post('/timesheets', protect, authorize('admin'), [
  body('agentId').notEmpty().withMessage('Agent ID is required'),
  body('weekStart').notEmpty().withMessage('Week start date is required'),
  body('hoursWorked').isFloat({ min: 0 }).withMessage('Hours worked must be a positive number'),
  body('hourlyRate').isFloat({ min: 0 }).withMessage('Hourly rate must be a positive number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      agentId,
      weekStart,
      weekEnd,
      weekNumber,
      dateRange,
      hoursWorked,
      hourlyRate,
      approvalStatus,
      conditionalComment,
      paidToBank
    } = req.body;

    // Check if agent exists
    const agent = await User.findById(agentId);
    if (!agent || agent.role !== 'agent') {
      return res.status(404).json({ message: 'Agent not found' });
    }

    // Calculate total amount
    const totalAmount = (parseFloat(hoursWorked) || 0) * (parseFloat(hourlyRate) || 0);

    // Check for duplicate entry
    const existing = await Timesheet.findOne({
      agentId,
      weekStart: new Date(weekStart)
    });

    if (existing) {
      return res.status(400).json({ message: 'Timesheet entry already exists for this agent and week' });
    }

    const timesheet = await Timesheet.create({
      agentId,
      weekStart: new Date(weekStart),
      weekEnd: new Date(weekEnd),
      weekNumber,
      dateRange,
      hoursWorked: parseFloat(hoursWorked) || 0,
      hourlyRate: parseFloat(hourlyRate) || 0,
      totalAmount,
      approvalStatus: approvalStatus || 'Not Approved',
      conditionalComment: conditionalComment || '',
      paidToBank: paidToBank || 'No'
    });

    const populatedTimesheet = await Timesheet.findById(timesheet._id)
      .populate('agentId', 'name email');

    res.status(201).json({ success: true, timesheet: populatedTimesheet });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Timesheet entry already exists for this agent and week' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/admin/timesheets/:id
// @desc    Update a timesheet entry
// @access  Private (Admin)
router.put('/timesheets/:id', protect, authorize('admin'), [
  body('hoursWorked').optional().isFloat({ min: 0 }).withMessage('Hours worked must be a positive number'),
  body('hourlyRate').optional().isFloat({ min: 0 }).withMessage('Hourly rate must be a positive number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      agentId,
      weekStart,
      weekEnd,
      weekNumber,
      dateRange,
      hoursWorked,
      hourlyRate,
      approvalStatus,
      conditionalComment,
      paidToBank
    } = req.body;

    const timesheet = await Timesheet.findById(req.params.id);
    if (!timesheet) {
      return res.status(404).json({ message: 'Timesheet entry not found' });
    }

    // Calculate total amount if hours or rate changed
    let totalAmount = timesheet.totalAmount;
    const finalHours = hoursWorked !== undefined ? parseFloat(hoursWorked) : timesheet.hoursWorked;
    const finalRate = hourlyRate !== undefined ? parseFloat(hourlyRate) : timesheet.hourlyRate;
    totalAmount = finalHours * finalRate;

    // Update fields
    if (agentId) timesheet.agentId = agentId;
    if (weekStart) timesheet.weekStart = new Date(weekStart);
    if (weekEnd) timesheet.weekEnd = new Date(weekEnd);
    if (weekNumber) timesheet.weekNumber = weekNumber;
    if (dateRange) timesheet.dateRange = dateRange;
    if (hoursWorked !== undefined) timesheet.hoursWorked = parseFloat(hoursWorked) || 0;
    if (hourlyRate !== undefined) timesheet.hourlyRate = parseFloat(hourlyRate) || 0;
    timesheet.totalAmount = totalAmount;
    if (approvalStatus) timesheet.approvalStatus = approvalStatus;
    if (conditionalComment !== undefined) timesheet.conditionalComment = conditionalComment || '';
    if (paidToBank) timesheet.paidToBank = paidToBank;

    await timesheet.save();

    const populatedTimesheet = await Timesheet.findById(timesheet._id)
      .populate('agentId', 'name email');

    res.json({ success: true, timesheet: populatedTimesheet });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   DELETE /api/admin/timesheets/:id
// @desc    Delete a timesheet entry
// @access  Private (Admin)
router.delete('/timesheets/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const timesheet = await Timesheet.findById(req.params.id);
    if (!timesheet) {
      return res.status(404).json({ message: 'Timesheet entry not found' });
    }

    await Timesheet.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Timesheet entry deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== HOMEPAGE VIDEO MANAGEMENT ==========

// @route   POST /api/admin/homepage-video
// @desc    Upload homepage background video
// @access  Private (Admin)
router.post('/homepage-video', protect, authorize('admin'), (req, res, next) => {
  videoUpload.single('video')(req, res, (err) => {
    // Handle multer errors before processing
    if (err) {
      console.error('Multer upload error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          message: 'Video file is too large. Maximum size is 200MB.',
          error: err.message 
        });
      }
      if (err.code && err.code.startsWith('LIMIT_')) {
        return res.status(400).json({ 
          message: 'Upload error: ' + err.message,
          error: err.code 
        });
      }
      return res.status(400).json({ 
        message: 'File upload error: ' + err.message,
        error: err.code || 'UPLOAD_ERROR'
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No video file uploaded' });
    }

    // File is already saved as homepage-video.mp4 by the middleware
    // Multer diskStorage streams files to disk, not loading entirely into memory
    const videoPath = `/uploads/videos/homepage-video.mp4`;
    
    res.json({ 
      success: true, 
      message: 'Homepage video uploaded successfully',
      videoPath: videoPath,
      fileName: req.file.filename,
      size: req.file.size
    });
  } catch (error) {
    console.error('Video upload processing error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/admin/homepage-video
// @desc    Get homepage video info
// @access  Private (Admin)
router.get('/homepage-video', protect, authorize('admin'), async (req, res) => {
  try {
    const videoPath = path.join(process.cwd(), 'uploads', 'videos', 'homepage-video.mp4');
    const videoExists = fs.existsSync(videoPath);
    
    if (!videoExists) {
      return res.json({ 
        success: true, 
        videoPath: null,
        exists: false 
      });
    }

    const stats = fs.statSync(videoPath);
    const videoPathUrl = `/uploads/videos/homepage-video.mp4`;
    
    res.json({ 
      success: true, 
      videoPath: videoPathUrl,
      exists: true,
      size: stats.size,
      lastModified: stats.mtime
    });
  } catch (error) {
    console.error('Error getting video info:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== CRM - LEADS ==========

// @route   GET /api/admin/crm/leads
// @desc    Get all leads with filters
// @access  Private (Admin)
router.get('/crm/leads', protect, authorize('admin'), async (req, res) => {
  try {
    const { status, search, startDate, endDate, sortBy = 'dateCaptured', sortOrder = 'desc' } = req.query;
    
    let query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { visitorName: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (startDate || endDate) {
      query.dateCaptured = {};
      if (startDate) query.dateCaptured.$gte = new Date(startDate);
      if (endDate) query.dateCaptured.$lte = new Date(endDate);
    }
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
    
    const leads = await Lead.find(query).sort(sortOptions);
    
    res.json({ success: true, leads });
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/admin/crm/leads
// @desc    Create a new lead
// @access  Private (Admin)
router.post('/crm/leads', protect, authorize('admin'), [
  body('email').isEmail().withMessage('Valid email is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { visitorName, email, phoneNumber, companyName, source, status, notes } = req.body;

    const lead = await Lead.create({
      visitorName,
      email,
      phoneNumber,
      companyName,
      source: source || 'Chatbot',
      status: status || 'Lead',
      notes
    });

    res.status(201).json({ success: true, lead });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/admin/crm/leads/:id
// @desc    Update a lead
// @access  Private (Admin)
router.put('/crm/leads/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { visitorName, email, phoneNumber, companyName, status, notes } = req.body;
    
    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      {
        visitorName,
        email,
        phoneNumber,
        companyName,
        status,
        notes,
        updatedAt: Date.now()
      },
      { new: true, runValidators: true }
    );

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    res.json({ success: true, lead });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   DELETE /api/admin/crm/leads/:id
// @desc    Delete a lead
// @access  Private (Admin)
router.delete('/crm/leads/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== CRM - CUSTOMERS & AGENTS ==========

// @route   GET /api/admin/crm/customers
// @desc    Get all customers for CRM
// @access  Private (Admin)
router.get('/crm/customers', protect, authorize('admin'), async (req, res) => {
  try {
    const customers = await User.find({ role: 'customer' })
      .select('name email phone country createdAt')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, customers });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/admin/crm/agents
// @desc    Get all agents for CRM
// @access  Private (Admin)
router.get('/crm/agents', protect, authorize('admin'), async (req, res) => {
  try {
    const agents = await User.find({ role: 'agent' })
      .select('name email phone serviceCategory serviceCategories isActive isOnline createdAt')
      .populate('serviceCategory', 'name')
      .populate('serviceCategories', 'name')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== AGENT MANAGEMENT - HOLIDAYS ==========

// @route   GET /api/admin/agent-management/holidays
// @desc    Get all agent holidays
// @access  Private (Admin)
router.get('/agent-management/holidays', protect, authorize('admin'), async (req, res) => {
  try {
    const { agentId, startDate, endDate } = req.query;
    
    let query = {};
    if (agentId) query.agent = agentId;
    if (startDate || endDate) {
      query.$or = [
        { startDate: { $lte: new Date(endDate || '2099-12-31') }, endDate: { $gte: new Date(startDate || '1970-01-01') } }
      ];
    }
    
    const holidays = await AgentHoliday.find(query)
      .populate('agent', 'name email')
      .sort({ startDate: 1 });
    
    res.json({ success: true, holidays });
  } catch (error) {
    console.error('Error fetching holidays:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/admin/agent-management/holidays
// @desc    Create a new agent holiday
// @access  Private (Admin)
router.post('/agent-management/holidays', protect, authorize('admin'), [
  body('agent').notEmpty().withMessage('Agent is required'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { agent, startDate, endDate, notes } = req.body;

    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ message: 'End date must be after start date' });
    }

    const holiday = await AgentHoliday.create({
      agent,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      notes
    });

    await holiday.populate('agent', 'name email');

    res.status(201).json({ success: true, holiday });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/admin/agent-management/holidays/:id
// @desc    Update an agent holiday
// @access  Private (Admin)
router.put('/agent-management/holidays/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate, notes } = req.body;

    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ message: 'End date must be after start date' });
    }

    const updateData = { updatedAt: Date.now() };
    if (startDate) updateData.startDate = new Date(startDate);
    if (endDate) updateData.endDate = new Date(endDate);
    if (notes !== undefined) updateData.notes = notes;

    const holiday = await AgentHoliday.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('agent', 'name email');

    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    res.json({ success: true, holiday });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   DELETE /api/admin/agent-management/holidays/:id
// @desc    Delete an agent holiday
// @access  Private (Admin)
router.delete('/agent-management/holidays/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const holiday = await AgentHoliday.findByIdAndDelete(req.params.id);

    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    res.json({ success: true, message: 'Holiday deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== AGENT MANAGEMENT - HOURS & REMUNERATION ==========

// @route   GET /api/admin/agent-management/hours
// @desc    Get all agent hours
// @access  Private (Admin)
router.get('/agent-management/hours', protect, authorize('admin'), async (req, res) => {
  try {
    const { agentId, startDate, endDate } = req.query;
    
    let query = {};
    if (agentId) query.agent = agentId;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    const hours = await AgentHours.find(query)
      .populate('agent', 'name email')
      .sort({ date: -1 });
    
    res.json({ success: true, hours });
  } catch (error) {
    console.error('Error fetching agent hours:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/admin/agent-management/hours
// @desc    Create a new agent hours entry
// @access  Private (Admin)
router.post('/agent-management/hours', protect, authorize('admin'), [
  body('agent').notEmpty().withMessage('Agent is required'),
  body('payRate').isNumeric().withMessage('Pay rate must be a number'),
  body('hoursWorked').isNumeric().withMessage('Hours worked must be a number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { agent, payRate, hoursWorked, date, notes } = req.body;
    const totalPay = parseFloat(payRate) * parseFloat(hoursWorked);

    const agentHours = await AgentHours.create({
      agent,
      payRate: parseFloat(payRate),
      hoursWorked: parseFloat(hoursWorked),
      totalPay,
      date: date ? new Date(date) : new Date(),
      notes
    });

    await agentHours.populate('agent', 'name email');

    res.status(201).json({ success: true, agentHours });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/admin/agent-management/hours/:id
// @desc    Update agent hours entry
// @access  Private (Admin)
router.put('/agent-management/hours/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { payRate, hoursWorked, date, notes } = req.body;

    const updateData = { updatedAt: Date.now() };
    
    if (payRate !== undefined) updateData.payRate = parseFloat(payRate);
    if (hoursWorked !== undefined) updateData.hoursWorked = parseFloat(hoursWorked);
    if (date !== undefined) updateData.date = new Date(date);
    if (notes !== undefined) updateData.notes = notes;
    
    // Recalculate total pay if payRate or hoursWorked changed
    if (payRate !== undefined || hoursWorked !== undefined) {
      const existing = await AgentHours.findById(req.params.id);
      const finalPayRate = payRate !== undefined ? parseFloat(payRate) : existing.payRate;
      const finalHoursWorked = hoursWorked !== undefined ? parseFloat(hoursWorked) : existing.hoursWorked;
      updateData.totalPay = finalPayRate * finalHoursWorked;
    }

    const agentHours = await AgentHours.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('agent', 'name email');

    if (!agentHours) {
      return res.status(404).json({ message: 'Agent hours entry not found' });
    }

    res.json({ success: true, agentHours });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   DELETE /api/admin/agent-management/hours/:id
// @desc    Delete agent hours entry
// @access  Private (Admin)
router.delete('/agent-management/hours/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const agentHours = await AgentHours.findByIdAndDelete(req.params.id);

    if (!agentHours) {
      return res.status(404).json({ message: 'Agent hours entry not found' });
    }

    res.json({ success: true, message: 'Agent hours entry deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== AGENT MANAGEMENT - CALENDAR DATA ==========

// @route   GET /api/admin/agent-management/calendar
// @desc    Get calendar data (holidays, hours, leads)
// @access  Private (Admin)
router.get('/agent-management/calendar', protect, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const end = endDate ? new Date(endDate) : new Date(new Date().setMonth(new Date().getMonth() + 1));
    
    // Get holidays
    const holidays = await AgentHoliday.find({
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } }
      ]
    }).populate('agent', 'name email');
    
    // Get hours entries
    const hours = await AgentHours.find({
      date: { $gte: start, $lte: end }
    }).populate('agent', 'name email');
    
    // Get leads (optional)
    const leads = await Lead.find({
      dateCaptured: { $gte: start, $lte: end }
    });
    
    res.json({ 
      success: true, 
      calendar: {
        holidays,
        hours,
        leads
      }
    });
  } catch (error) {
    console.error('Error fetching calendar data:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== RECENT ACTIVITY ==========

// @route   GET /api/admin/activities
// @desc    Get all activities
// @access  Private (Admin)
router.get('/activities', protect, authorize('admin'), async (req, res) => {
  try {
    const { type, date } = req.query;
    
    let query = {};
    if (type && type !== 'all') {
      query.type = type;
    }
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: startDate, $lte: endDate };
    }
    
    const activities = await Activity.find(query)
      .populate('user', 'name email role')
      .sort({ createdAt: -1 })
      .limit(100); // Limit to last 100 activities
    
    res.json({ success: true, activities });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ========== RESUME BUILDER USAGE TRACKING ==========

// @route   GET /api/admin/resume-builder/usage
// @desc    Get all resume builder usage records
// @access  Private (Admin)
router.get('/resume-builder/usage', protect, authorize('admin'), async (req, res) => {
  try {
    const usageRecords = await ResumeBuilderUsage.find()
      .populate('customer', 'name email')
      .sort({ usedAt: -1 });
    
    // Group by customer
    const customerUsage = {};
    usageRecords.forEach(record => {
      const customerId = record.customer._id.toString();
      if (!customerUsage[customerId]) {
        customerUsage[customerId] = {
          customer: record.customer,
          totalUses: 0,
          usageHistory: []
        };
      }
      customerUsage[customerId].totalUses++;
      customerUsage[customerId].usageHistory.push({
        usedAt: record.usedAt,
        _id: record._id
      });
    });

    const result = Object.values(customerUsage).map(item => ({
      customer: item.customer,
      totalUses: item.totalUses,
      lastUsed: item.usageHistory[0]?.usedAt || null,
      usageHistory: item.usageHistory
    }));

    res.json({ success: true, usage: result });
  } catch (error) {
    console.error('Error fetching resume builder usage:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

