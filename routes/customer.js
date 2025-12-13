const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Service = require('../models/Service');
const ChatSession = require('../models/ChatSession');
const Message = require('../models/Message');
const { checkTokenBalance } = require('../services/tokenService');
const { assignAgent } = require('../services/agentAssignment');
const { sendAIMessages } = require('../services/aiMessages');
const { ensureDefaultPlans, formatPlanForResponse } = require('../utils/planDefaults');

// @route   GET /api/customer/plans
// @desc    Get all available plans
// @access  Private (Customer)
router.get('/plans', protect, authorize('customer'), async (req, res) => {
  try {
    await ensureDefaultPlans();
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    res.json({ success: true, plans: plans.map(formatPlanForResponse) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/customer/services
// @desc    Get all services with sub-services
// @access  Private (Customer)
router.get('/services', protect, authorize('customer'), async (req, res) => {
  try {
    const services = await Service.find({ isActive: true });
    res.json({ success: true, services });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/customer/request-service
// @desc    Request a service and create chat session
// @access  Private (Customer)
router.post('/request-service', protect, authorize('customer'), async (req, res) => {
  try {
    const { serviceId, subService } = req.body;
    const customer = req.user;

    // Check token balance
    const balance = await checkTokenBalance(customer._id);
    if (balance <= 0) {
      return res.status(400).json({ 
        message: 'Insufficient balance. Please recharge your plan.' 
      });
    }

    // Check if service exists
    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Create chat session
    const chatSession = await ChatSession.create({
      customer: customer._id,
      service: serviceId,
      subService: subService,
      status: 'pending'
    });

    // Try to assign agent
    const agent = await assignAgent(serviceId, chatSession._id);

    // Send AI messages (will be handled by socket)
    // This will be triggered via socket when customer joins the chat

    res.json({
      success: true,
      chatSession: {
        _id: chatSession._id,
        service: service.name,
        subService: subService,
        status: chatSession.status,
        agent: agent ? {
          _id: agent._id,
          name: agent.name
        } : null
      }
    });
  } catch (error) {
    console.error('Request service error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/customer/chat-sessions
// @desc    Get all chat sessions for customer
// @access  Private (Customer)
router.get('/chat-sessions', protect, authorize('customer'), async (req, res) => {
  try {
    const chatSessions = await ChatSession.find({ customer: req.user._id })
      .populate('service', 'name')
      .populate({
        path: 'agent',
        select: 'name email isOnline avatar role phone country serviceCategory',
        populate: { path: 'serviceCategory', select: 'name' }
      })
      .populate({
        path: 'customer',
        select: 'name email isOnline avatar role phone country serviceCategory',
        populate: { path: 'serviceCategory', select: 'name' }
      })
      .sort({ createdAt: -1 });

    // Add lastMessage to each chat session
    const chatSessionsWithLastMessage = await Promise.all(
      chatSessions.map(async (chat) => {
        const lastMessage = await Message.findOne({ chatSession: chat._id })
          .sort({ createdAt: -1 })
          .populate('sender', 'name email')
          .lean();
        
        const chatObj = chat.toObject();
        chatObj.lastMessage = lastMessage;
        
        // Calculate unread count
        const unreadCount = await Message.countDocuments({
          chatSession: chat._id,
          sender: { $ne: req.user._id },
          isRead: false
        });
        chatObj.unreadCount = unreadCount;
        
        return chatObj;
      })
    );

    res.json({ success: true, chatSessions: chatSessionsWithLastMessage });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/customer/chat-session/:id
// @desc    Get specific chat session with messages
// @access  Private (Customer)
router.get('/chat-session/:id', protect, authorize('customer'), async (req, res) => {
  try {
    const chatSession = await ChatSession.findOne({
      _id: req.params.id,
      customer: req.user._id
    })
      .populate('service', 'name')
      .populate({
        path: 'agent',
        select: 'name email isOnline avatar role phone country serviceCategory',
        populate: { path: 'serviceCategory', select: 'name' }
      })
      .populate({
        path: 'customer',
        select: 'name email isOnline avatar role phone country serviceCategory',
        populate: { path: 'serviceCategory', select: 'name' }
      });

    if (!chatSession) {
      return res.status(404).json({ message: 'Chat session not found' });
    }

    const messages = await Message.find({ chatSession: chatSession._id })
      .populate('sender', 'name email')
      .populate('replyTo', 'content messageType attachments fileUrl fileName sender')
      .populate('replyTo.sender', 'name')
      .sort({ createdAt: 1 });

    res.json({
      success: true,
      chatSession,
      messages
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/customer/token-balance
// @desc    Get customer token balance
// @access  Private (Customer)
router.get('/token-balance', protect, authorize('customer'), async (req, res) => {
  try {
    const customer = await User.findById(req.user._id);
    res.json({ 
      success: true, 
      balance: customer.tokenBalance 
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

