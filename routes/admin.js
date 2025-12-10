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

    const { name, description, price, tokens, hoursPerMonth, bonusFeatures, isActive } = req.body;

    const plan = await Plan.create({
      name,
      description,
      price,
      tokens,
      hoursPerMonth: hoursPerMonth || null,
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
    const { name, description, price, tokens, hoursPerMonth, bonusFeatures, isActive } = req.body;
    
    const plan = await Plan.findByIdAndUpdate(
      req.params.id,
      { name, description, price, tokens, hoursPerMonth, bonusFeatures, isActive },
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
    await sendCredentialsEmail(email, password, 'agent', name);

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
router.put('/agents/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const agent = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('serviceCategory', 'name');

    if (!agent || agent.role !== 'agent') {
      return res.status(404).json({ message: 'Agent not found' });
    }

    res.json({ success: true, agent });
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

// @route   PUT /api/admin/customers/:id/tokens
// @desc    Adjust customer tokens
// @access  Private (Admin)
router.put('/customers/:id/tokens', protect, authorize('admin'), [
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('reason').trim().notEmpty().withMessage('Reason is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { amount, reason } = req.body;

    const result = await addTokens(
      req.params.id,
      amount,
      reason,
      req.user._id
    );

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    res.json({ success: true, balance: result.balance });
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

module.exports = router;

