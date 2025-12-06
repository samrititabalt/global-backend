const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../middleware/cloudinaryUpload');
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
// @desc    Upload file/image/audio to Cloudinary
// @access  Private
router.post('/upload', protect, upload.fields([
  { name: 'image', maxCount: 5 },
  { name: 'file', maxCount: 5 },
  { name: 'audio', maxCount: 1 }
]), uploadToCloudinary, async (req, res) => {
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

    // Check if files were uploaded
    if (!req.uploadedFiles || req.uploadedFiles.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    // Determine message type based on first file
    const firstFile = req.uploadedFiles[0];
    const messageType = firstFile.type;

    // Create message with Cloudinary URLs
    const message = await Message.create({
      chatSession: chatSessionId,
      sender: sender._id,
      senderRole: sender.role,
      content: content || '',
      messageType,
      fileUrl: firstFile.url,
      fileName: firstFile.fileName,
      // Store all uploaded files as attachments
      attachments: req.uploadedFiles.map(file => ({
        type: file.type,
        url: file.url,
        publicId: file.publicId,
        fileName: file.fileName,
        size: file.size,
        ...(file.width && { width: file.width, height: file.height }),
        ...(file.duration && { duration: file.duration }),
      })),
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

    // Emit to socket for real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`chat_${chatSessionId}`).emit('newMessage', populatedMessage);
    }

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

// @route   PUT /api/chat/message/:id
// @desc    Edit a message
// @access  Private
router.put('/message/:id', protect, async (req, res) => {
  try {
    const { content } = req.body;
    const sender = req.user;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const message = await Message.findById(req.params.id)
      .populate('chatSession');

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Check if message is deleted
    if (message.isDeleted) {
      return res.status(400).json({ message: 'Cannot edit a deleted message' });
    }

    // Check if user is the sender
    if (message.sender.toString() !== sender._id.toString()) {
      return res.status(403).json({ message: 'You can only edit your own messages' });
    }

    // Check if user is part of this chat
    const chatSession = message.chatSession;
    if (sender.role === 'customer' && chatSession.customer.toString() !== sender._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (sender.role === 'agent' && chatSession.agent && chatSession.agent.toString() !== sender._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Store original content if first edit
    if (!message.isEdited) {
      message.originalContent = message.content;
    }

    // Update message
    message.content = content.trim();
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name email');

    // Emit to socket for real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`chat_${chatSession._id}`).emit('messageEdited', populatedMessage);
    }

    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   DELETE /api/chat/message/:id
// @desc    Delete a message
// @access  Private
router.delete('/message/:id', protect, async (req, res) => {
  try {
    const sender = req.user;

    const message = await Message.findById(req.params.id)
      .populate('chatSession');

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Check if already deleted
    if (message.isDeleted) {
      return res.status(400).json({ message: 'Message already deleted' });
    }

    // Check if user is the sender
    if (message.sender.toString() !== sender._id.toString()) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }

    // Check if user is part of this chat
    const chatSession = message.chatSession;
    if (sender.role === 'customer' && chatSession.customer.toString() !== sender._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (sender.role === 'agent' && chatSession.agent && chatSession.agent.toString() !== sender._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Store original content before deletion
    if (!message.originalContent) {
      message.originalContent = message.content;
    }

    // Mark as deleted (soft delete)
    message.isDeleted = true;
    message.deletedAt = new Date();
    message.content = ''; // Clear content
    message.fileUrl = ''; // Clear file URL
    message.attachments = []; // Clear attachments
    await message.save();

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name email');

    // Emit to socket for real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`chat_${chatSession._id}`).emit('messageDeleted', populatedMessage);
    }

    res.json({ success: true, message: populatedMessage });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

