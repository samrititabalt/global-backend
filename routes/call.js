const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Call = require('../models/Call');
const ChatSession = require('../models/ChatSession');

// @route   GET /api/call/history/:chatSessionId
// @desc    Get call history for a chat session
// @access  Private
router.get('/history/:chatSessionId', protect, async (req, res) => {
  try {
    const { chatSessionId } = req.params;
    const user = req.user;

    // Verify chat session
    const chatSession = await ChatSession.findById(chatSessionId);
    if (!chatSession) {
      return res.status(404).json({ message: 'Chat session not found' });
    }

    // Check if user is part of this chat
    if (user.role === 'customer' && chatSession.customer.toString() !== user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (user.role === 'agent' && chatSession.agent && chatSession.agent.toString() !== user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Get call history
    const calls = await Call.find({ chatSession: chatSessionId })
      .populate('caller', 'name email')
      .populate('receiver', 'name email')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ calls });
  } catch (error) {
    console.error('Error fetching call history:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/call/user-history
// @desc    Get all call history for current user
// @access  Private
router.get('/user-history', protect, async (req, res) => {
  try {
    const user = req.user;

    // Get all calls where user is caller or receiver
    const calls = await Call.find({
      $or: [
        { caller: user._id },
        { receiver: user._id }
      ]
    })
      .populate('chatSession', 'service subService')
      .populate('caller', 'name email')
      .populate('receiver', 'name email')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ calls });
  } catch (error) {
    console.error('Error fetching user call history:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
