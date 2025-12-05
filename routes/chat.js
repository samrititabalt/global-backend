const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const Message = require('../models/Message');
const ChatSession = require('../models/ChatSession');
const { deductToken, checkTokenBalance } = require('../services/tokenService');

// @route   POST /api/chat/message
// @desc    Send a text message
// @access  Private
router.post('/message', protect, upload.none(), async (req, res) => {
  try {
    const { chatSessionId, content } = req.body;
    const sender = req.user;

    // Verify chat session
    const chatSession = await ChatSession.findById(chatSessionId);
    if (!chatSession) {
      return res.status(404).json({ message: 'Chat session not found' });
    }

    // Check if user is part of this chat
    if (sender.role === 'customer' && chatSession.customer.toString() !== sender._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (sender.role === 'agent' && chatSession.agent && chatSession.agent.toString() !== sender._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // For customers, check token balance
    if (sender.role === 'customer') {
      const balance = await checkTokenBalance(sender._id);
      if (balance <= 0) {
        return res.status(400).json({ 
          message: 'Insufficient balance. Please recharge your plan.' 
        });
      }
    }

    // Create message
    const message = await Message.create({
      chatSession: chatSessionId,
      sender: sender._id,
      senderRole: sender.role,
      content,
      messageType: 'text'
    });

    // Deduct token for customer messages
    if (sender.role === 'customer') {
      await deductToken(sender._id, message._id);
    }

    // Mark chat as active if it was pending
    if (chatSession.status === 'pending') {
      chatSession.status = 'active';
      await chatSession.save();
    }

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name email');

    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/chat/upload
// @desc    Upload file/image/audio
// @access  Private
router.post('/upload', protect, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]), async (req, res) => {
  try {
    const { chatSessionId } = req.body;
    const sender = req.user;

    // Verify chat session
    const chatSession = await ChatSession.findById(chatSessionId);
    if (!chatSession) {
      return res.status(404).json({ message: 'Chat session not found' });
    }

    // Check if user is part of this chat
    if (sender.role === 'customer' && chatSession.customer.toString() !== sender._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (sender.role === 'agent' && chatSession.agent && chatSession.agent.toString() !== sender._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // For customers, check token balance
    if (sender.role === 'customer') {
      const balance = await checkTokenBalance(sender._id);
      if (balance <= 0) {
        return res.status(400).json({ 
          message: 'Insufficient balance. Please recharge your plan.' 
        });
      }
    }

    let messageType = 'text';
    let fileUrl = '';
    let fileName = '';

    if (req.files.image) {
      messageType = 'image';
      fileUrl = `/uploads/images/${req.files.image[0].filename}`;
      fileName = req.files.image[0].originalname;
    } else if (req.files.file) {
      messageType = 'file';
      fileUrl = `/uploads/files/${req.files.file[0].filename}`;
      fileName = req.files.file[0].originalname;
    } else if (req.files.audio) {
      messageType = 'audio';
      fileUrl = `/uploads/audio/${req.files.audio[0].filename}`;
      fileName = req.files.audio[0].originalname;
    }

    // Create message
    const message = await Message.create({
      chatSession: chatSessionId,
      sender: sender._id,
      senderRole: sender.role,
      messageType,
      fileUrl,
      fileName
    });

    // Deduct token for customer messages
    if (sender.role === 'customer') {
      await deductToken(sender._id, message._id);
    }

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name email');

    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/chat/sessions/:id/messages
// @desc    Get all messages for a chat session
// @access  Private
router.get('/sessions/:id/messages', protect, async (req, res) => {
  try {
    const chatSession = await ChatSession.findById(req.params.id);
    
    if (!chatSession) {
      return res.status(404).json({ message: 'Chat session not found' });
    }

    // Check authorization
    if (req.user.role === 'customer' && chatSession.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (req.user.role === 'agent' && chatSession.agent && chatSession.agent.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const messages = await Message.find({ chatSession: req.params.id })
      .populate('sender', 'name email')
      .sort({ createdAt: 1 });

    res.json({ success: true, messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/chat/message/:id/read
// @desc    Mark message as read
// @access  Private
router.put('/message/:id/read', protect, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id)
      .populate('chatSession');

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Only mark as read if user is the recipient
    const chatSession = message.chatSession;
    if (req.user.role === 'customer' && chatSession.agent && chatSession.agent.toString() === req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (req.user.role === 'agent' && chatSession.customer.toString() === req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    message.isRead = true;
    message.readAt = new Date();
    await message.save();

    res.json({ success: true, message });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

