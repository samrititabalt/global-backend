const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Service = require('../models/Service');
const ChatSession = require('../models/ChatSession');
const Message = require('../models/Message');
const CustomServiceRequest = require('../models/CustomServiceRequest');
const CustomerRequest = require('../models/CustomerRequest');
const { checkTokenBalance, deductTokens } = require('../services/tokenService');
const { ensureDefaultPlans, formatPlanForResponse } = require('../utils/planDefaults');
const { notifyAgentsForNewChat, notifyAllAgentsOfNewRequest } = require('../services/agentNotificationService');
const { sendInitialAIGreeting } = require('../services/aiMessages');
const { formatMessageForSamAI, mapMessagesForSamAI } = require('../utils/samAi');
const { SAM_STUDIOS_SERVICES } = require('../constants/samStudiosServices');
const { upload, uploadToCloudinary } = require('../middleware/cloudinaryUpload');
const { mail } = require('../utils/sendEmail');
const { generateRequestFlowResponse } = require('../services/openaiService');

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

// @route   GET /api/customer/sam-studios-access
// @desc    Get Sam Studios access map for customer
// @access  Private (Customer)
router.get('/sam-studios-access', protect, authorize('customer'), async (req, res) => {
  try {
    const accessMap = Array.isArray(req.user?.samStudiosAccess) ? req.user.samStudiosAccess : [];
    res.json({
      success: true,
      services: SAM_STUDIOS_SERVICES,
      access: accessMap
    });
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

    // Emit real-time event to agents with matching serviceCategory
    // Get io instance from app
    const io = req.app.get('io');
    if (io) {
      // Populate chat session for the event
      const populatedChat = await ChatSession.findById(chatSession._id)
        .populate('customer', 'name email')
        .populate('service', 'name');
      
      // Emit to all agents with matching serviceCategory
      // Agents will be listening for 'newPendingRequest' event
      io.emit('newPendingRequest', {
        chatSession: {
          _id: populatedChat._id,
          customer: {
            _id: populatedChat.customer._id,
            name: populatedChat.customer.name
          },
          service: {
            _id: populatedChat.service._id,
            name: populatedChat.service.name
          },
          subService: populatedChat.subService,
          status: populatedChat.status,
          createdAt: populatedChat.createdAt
        },
        serviceId: serviceId.toString() // So agents can filter by their serviceCategory
      });

      // Kick off SamAI greeting for this chat
      sendInitialAIGreeting(chatSession._id, io).catch(err => {
        console.error('Error triggering SamAI greeting:', err);
      });
    }

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
        const lastMessageDoc = await Message.findOne({ chatSession: chat._id })
          .sort({ createdAt: -1 })
          .populate('sender', 'name email')
          .lean();
        
        const chatObj = chat.toObject();
        chatObj.lastMessage = formatMessageForSamAI(lastMessageDoc);
        
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

    const rawMessages = await Message.find({ chatSession: chatSession._id })
      .populate('sender', 'name email avatar role')
      .populate('replyTo', 'content messageType attachments fileUrl fileName sender')
      .populate('replyTo.sender', 'name avatar')
      .sort({ createdAt: 1 });
    const messages = mapMessagesForSamAI(rawMessages);

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

// @route   POST /api/customer/ai-request-chat
// @desc    Get next AI message for Request a Service flow (GPT-4o-mini)
// @access  Private (Customer)
router.post('/ai-request-chat', protect, authorize('customer'), async (req, res) => {
  try {
    const { messages = [] } = req.body;
    const normalized = messages.map((m) => ({
      role: m.role === 'assistant' ? 'bot' : m.role,
      content: m.content || m.text || '',
      text: m.text || m.content || ''
    }));
    const result = await generateRequestFlowResponse(normalized);
    res.json({
      success: true,
      aiMessage: result.aiMessage,
      readyForSow: result.readyForSow,
      collectedFields: result.collectedFields || {}
    });
  } catch (error) {
    console.error('AI request chat error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   POST /api/customer/ai-request
// @desc    Submit AI-driven request (SOW), deduct minutes, notify agents
// @access  Private (Customer)
router.post('/ai-request', protect, authorize('customer'), upload.fields([{ name: 'files', maxCount: 10 }]), uploadToCloudinary, async (req, res) => {
  try {
    let data = {};
    try {
      data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : (req.body.data || {});
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid request data' });
    }

    const customer = req.user;
    const sow = data.sow || {};
    const budgetMinutes = Math.round(Number(sow.budgetMinutes || data.expectedBudget) || 0);

    if (budgetMinutes <= 0) {
      return res.status(400).json({ success: false, message: 'Expected budget (minutes) is required and must be a positive number.' });
    }

    const result = await deductTokens(customer._id, budgetMinutes, 'Request budget');
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message || 'Failed to deduct minutes' });
    }

    const fileUrls = (req.uploadedFiles || [])
      .filter((f) => f.type === 'request-file')
      .map((f) => f.url);

    const title = (sow.title || data.shortDescription || 'Service Request').slice(0, 200);
    const doc = await CustomerRequest.create({
      customer: customer._id,
      title,
      shortDescription: data.shortDescription || '',
      expectedBudget: budgetMinutes,
      expectedDeadline: data.expectedDeadline || '',
      deliverableFormat: data.deliverableFormat || '',
      relatedToSuspenseTool: data.relatedToSuspenseTool || 'No',
      additionalNotes: data.additionalNotes || '',
      sow: {
        title: sow.title,
        summary: sow.summary,
        scopeOfWork: sow.scopeOfWork,
        deliverables: sow.deliverables,
        timeline: sow.timeline,
        budgetMinutes: sow.budgetMinutes,
        minutesDeducted: sow.minutesDeducted,
        requiredInputs: sow.requiredInputs,
        outputFormat: sow.outputFormat,
        notes: sow.notes
      },
      minutesDeducted: budgetMinutes,
      status: 'Open',
      fileUrls
    });

    await notifyAllAgentsOfNewRequest(doc._id, customer.name, doc.sow).catch((err) => console.error('Notify agents error:', err));

    if (result.balance < 0) {
      const admins = await User.find({ role: 'admin' }).select('email');
      const html = `
        <p><strong>Customer negative balance alert</strong></p>
        <p>Customer: ${customer.name} (${customer.email})</p>
        <p>Balance after deduction: ${result.balance} minutes.</p>
        <p>Request: ${title}</p>
        <p>Budget deducted: ${budgetMinutes} minutes.</p>
      `;
      for (const admin of admins) {
        if (admin.email) {
          mail(admin.email, 'Customer has negative minutes balance', html).catch((e) => console.error('Admin alert email failed:', e));
        }
      }
    }

    res.json({
      success: true,
      request: { _id: doc._id, title: doc.title, status: doc.status },
      balance: result.balance
    });
  } catch (error) {
    console.error('AI request error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route   GET /api/customer/request-history
// @desc    Get customer request history (AI-driven requests)
// @access  Private (Customer)
router.get('/request-history', protect, authorize('customer'), async (req, res) => {
  try {
    const list = await CustomerRequest.find({ customer: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, requests: list });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/customer/custom-service-request
// @desc    Submit a custom service request
// @access  Private (Customer)
router.post('/custom-service-request', protect, authorize('customer'), async (req, res) => {
  try {
    const { requestDetails, customerName, customerEmail, plan, tokenBalance, timestamp } = req.body;
    const customer = req.user;

    if (!requestDetails || !requestDetails.trim()) {
      return res.status(400).json({ 
        success: false,
        message: 'Request details are required' 
      });
    }

    const customRequest = await CustomServiceRequest.create({
      customer: customer._id,
      customerName: customerName || customer.name,
      customerEmail: customerEmail || customer.email,
      requestDetails: requestDetails.trim(),
      plan: plan || (customer.currentPlan ? customer.currentPlan.toString() : 'No plan'),
      tokenBalance: tokenBalance || customer.tokenBalance || 0,
      status: 'New – Custom Request'
    });

    res.json({ 
      success: true, 
      message: 'Custom service request submitted successfully',
      request: customRequest 
    });
  } catch (error) {
    console.error('Custom service request error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
});

module.exports = router;

