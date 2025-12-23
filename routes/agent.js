const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ChatSession = require('../models/ChatSession');
const Message = require('../models/Message');
const User = require('../models/User');

// @route   GET /api/agent/dashboard
// @desc    Get agent dashboard data
// @access  Private (Agent)
router.get('/dashboard', protect, authorize('agent'), async (req, res) => {
  try {
    // Populate agent with serviceCategory
    const agent = await User.findById(req.user._id)
      .populate('serviceCategory', 'name')
      .select('name email role serviceCategory isOnline isAvailable isActive');

    // Helper function to add lastMessage and unreadCount to chat sessions
    const addLastMessageToChats = async (chats) => {
      return Promise.all(
        chats.map(async (chat) => {
          const lastMessage = await Message.findOne({ chatSession: chat._id })
            .sort({ createdAt: -1 })
            .populate('sender', 'name email')
            .lean();
          
          const chatObj = chat.toObject ? chat.toObject() : chat;
          chatObj.lastMessage = lastMessage;
          
          // Calculate unread count (messages not from agent and not read)
          const unreadCount = await Message.countDocuments({
            chatSession: chat._id,
            sender: { $ne: agent._id },
            isRead: false
          });
          chatObj.unreadCount = unreadCount;
          
          return chatObj;
        })
      );
    };

    // Get pending requests for agent's service category
    const pendingRequests = await ChatSession.find({
      service: agent.serviceCategory,
      status: 'pending',
      agent: null
    })
      .populate({
        path: 'customer',
        select: 'name email isOnline avatar role phone country serviceCategory',
        populate: { path: 'serviceCategory', select: 'name' }
      })
      .populate('service', 'name')
      .sort({ createdAt: -1 });

    // Get active chats
    const activeChats = await ChatSession.find({
      agent: agent._id,
      status: 'active'
    })
      .populate({
        path: 'customer',
        select: 'name email isOnline avatar role phone country serviceCategory',
        populate: { path: 'serviceCategory', select: 'name' }
      })
      .populate('service', 'name')
      .sort({ createdAt: -1 });

    // Get completed cases
    const completedCases = await ChatSession.find({
      agent: agent._id,
      status: 'completed'
    })
      .populate({
        path: 'customer',
        select: 'name email isOnline avatar role phone country serviceCategory',
        populate: { path: 'serviceCategory', select: 'name' }
      })
      .populate('service', 'name')
      .sort({ completedAt: -1 })
      .limit(10);

    // Add lastMessage to all chat arrays
    const pendingWithLastMessage = await addLastMessageToChats(pendingRequests);
    const activeWithLastMessage = await addLastMessageToChats(activeChats);
    const completedWithLastMessage = await addLastMessageToChats(completedCases);

    res.json({
      success: true,
      agent: {
        _id: agent._id,
        name: agent.name,
        email: agent.email,
        serviceCategory: agent.serviceCategory
      },
      dashboard: {
        pendingRequests: pendingWithLastMessage,
        activeChats: activeWithLastMessage,
        completedCases: completedWithLastMessage
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/agent/accept-request/:chatId
// @desc    Accept a pending chat request
// @access  Private (Agent)
router.post('/accept-request/:chatId', protect, authorize('agent'), async (req, res) => {
  try {
    const chatSession = await ChatSession.findById(req.params.chatId);

    if (!chatSession) {
      return res.status(404).json({ message: 'Chat session not found' });
    }

    if (chatSession.agent && chatSession.agent.toString() !== req.user._id.toString()) {
      return res.status(400).json({ message: 'This request has already been accepted by another agent' });
    }

    if (chatSession.status !== 'pending') {
      return res.status(400).json({ message: 'This request is no longer pending' });
    }

    // Assign agent
    chatSession.agent = req.user._id;
    chatSession.status = 'active';
    chatSession.assignedAt = new Date();
    await chatSession.save();

    // Add to agent's active chats
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { activeChats: chatSession._id }
    });

    res.json({
      success: true,
      chatSession
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/agent/chat-session/:id
// @desc    Get specific chat session with messages
// @access  Private (Agent)
router.get('/chat-session/:id', protect, authorize('agent'), async (req, res) => {
  try {
    // First, try to find chat session assigned to this agent
    let chatSession = await ChatSession.findOne({
      _id: req.params.id,
      agent: req.user._id
    })
      .populate('service', 'name')
      .populate({
        path: 'customer',
        select: 'name email isOnline avatar role phone country serviceCategory',
        populate: { path: 'serviceCategory', select: 'name' }
      })
      .populate({
        path: 'agent',
        select: 'name email isOnline avatar role phone country serviceCategory',
        populate: { path: 'serviceCategory', select: 'name' }
      });

    // If not found, check if it's a pending request that the agent can accept
    if (!chatSession) {
      chatSession = await ChatSession.findOne({
        _id: req.params.id,
        status: 'pending',
        service: req.user.serviceCategory
      })
        .populate('service', 'name')
        .populate({
          path: 'customer',
          select: 'name email isOnline avatar role phone country serviceCategory',
          populate: { path: 'serviceCategory', select: 'name' }
        })
        .populate({
          path: 'agent',
          select: 'name email isOnline avatar role phone country serviceCategory',
          populate: { path: 'serviceCategory', select: 'name' }
        });
    }

    if (!chatSession) {
      return res.status(404).json({ 
        success: false,
        message: 'Chat session not found or you do not have access to it' 
      });
    }

    const messages = await Message.find({ chatSession: chatSession._id })
      .populate('sender', 'name email avatar role')
      .populate('replyTo', 'content messageType attachments fileUrl fileName sender')
      .populate('replyTo.sender', 'name avatar')
      .sort({ createdAt: 1 });

    res.json({
      success: true,
      chatSession,
      messages: messages || []
    });
  } catch (error) {
    console.error('Error loading agent chat session:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
});

// @route   POST /api/agent/complete-chat/:chatId
// @desc    Mark chat as completed
// @access  Private (Agent)
router.post('/complete-chat/:chatId', protect, authorize('agent'), async (req, res) => {
  try {
    const chatSession = await ChatSession.findOne({
      _id: req.params.chatId,
      agent: req.user._id
    });

    if (!chatSession) {
      return res.status(404).json({ message: 'Chat session not found' });
    }

    chatSession.status = 'completed';
    chatSession.completedAt = new Date();
    await chatSession.save();

    // Remove from agent's active chats
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { activeChats: chatSession._id }
    });

    res.json({
      success: true,
      message: 'Chat marked as completed'
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/agent/status
// @desc    Update agent online/offline status
// @access  Private (Agent)
router.put('/status', protect, authorize('agent'), async (req, res) => {
  try {
    const { isOnline, isAvailable } = req.body;

    const agent = await User.findById(req.user._id);
    if (isOnline !== undefined) agent.isOnline = isOnline;
    if (isAvailable !== undefined) agent.isAvailable = isAvailable;
    await agent.save();

    res.json({
      success: true,
      agent: {
        isOnline: agent.isOnline,
        isAvailable: agent.isAvailable
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

