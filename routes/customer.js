const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Service = require('../models/Service');
const ChatSession = require('../models/ChatSession');
const Message = require('../models/Message');
const { checkTokenBalance } = require('../services/tokenService');
const { ensureDefaultPlans, formatPlanForResponse } = require('../utils/planDefaults');
const { notifyAgentsForNewChat } = require('../services/agentNotificationService');

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

    // Note: We no longer block chat creation if agents are offline
    // The chat will be created as 'pending' and agents will be notified via email
    // Agents can accept the request when they come online

    // Create chat session with 'pending' status (no agent assigned yet)
    const chatSession = await ChatSession.create({
      customer: customer._id,
      service: serviceId,
      subService: subService,
      status: 'pending',
      agent: null // Explicitly set to null - no auto-assignment
    });

    // Always notify all agents of this service category about the new chat
    // This happens regardless of whether agents are online or not
    notifyAgentsForNewChat(chatSession._id, serviceId, customer.name).catch(err => {
      console.error('Error sending agent notifications:', err);
      // Don't block the response if notifications fail
    });

    res.json({
      success: true,
      chatSession: {
        _id: chatSession._id,
        service: service.name,
        subService: subService,
        status: chatSession.status,
        agent: null // No agent assigned until one accepts
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
      .populate('sender', 'name email avatar role')
      .populate('replyTo', 'content messageType attachments fileUrl fileName sender')
      .populate('replyTo.sender', 'name avatar')
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

