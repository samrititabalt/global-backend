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
const { addTokens } = require('../services/tokenService');
const generatePassword = require('../utils/generatePassword');
const { sendCredentialsEmail } = require('../utils/sendEmail');
const { upload, uploadToCloudinary } = require('../middleware/cloudinaryUpload');

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
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('country').trim().notEmpty().withMessage('Country is required'),
  body('serviceCategory').notEmpty().withMessage('Service category is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, phone, country, serviceCategory } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Get avatar URL if uploaded
    let avatarUrl = null;
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const avatarFile = req.uploadedFiles.find(f => f.type === 'avatar');
      if (avatarFile) {
        avatarUrl = avatarFile.url;
      }
    }

    // Generate password
    const password = generatePassword();

    // Create agent
    const agent = await User.create({
      name,
      email,
      phone,
      country,
      password,
      role: 'agent',
      serviceCategory,
      avatar: avatarUrl
    });

    // Send credentials email
    try {
      console.log(`📧 Sending agent credentials email to ${email}...`);
      await sendCredentialsEmail(email, password, 'agent', name);
      console.log(`✅ Agent credentials email sent successfully to ${email}`);
    } catch (emailError) {
      console.error(`❌ Failed to send agent credentials email to ${email}:`, emailError.message);
      // Don't fail agent creation if email fails, just log it
    }

    res.status(201).json({
      success: true,
      agent: {
        _id: agent._id,
        name: agent.name,
        email: agent.email,
        serviceCategory: agent.serviceCategory,
        avatar: agent.avatar
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/admin/agents
// @desc    Get all agents
// @access  Private (Admin)
router.get('/agents', protect, authorize('admin'), async (req, res) => {
  try {
    const agents = await User.find({ role: 'agent' })
      .populate('serviceCategory', 'name')
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
    const { name, email, phone, country, serviceCategory, isActive } = req.body;

    const agent = await User.findById(req.params.id);
    if (!agent || agent.role !== 'agent') {
      return res.status(404).json({ message: 'Agent not found' });
    }

    // Check if email is being changed and if it's already taken
    if (email && email !== agent.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
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

    // Update agent
    const updateData = {
      ...(name && { name }),
      ...(email && { email }),
      ...(phone && { phone }),
      ...(country && { country }),
      ...(serviceCategory && { serviceCategory }),
      ...(isActive !== undefined && { isActive }),
      ...(avatarUrl && { avatar: avatarUrl })
    };

    const updatedAgent = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('serviceCategory', 'name');

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

module.exports = router;

