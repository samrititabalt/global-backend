const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatSession',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderRole: {
    type: String,
    enum: ['customer', 'agent', 'admin', 'system'],
    required: true
  },
  content: {
    type: String
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'system'],
    default: 'text'
  },
  fileUrl: {
    type: String
  },
  fileName: {
    type: String
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },
  isAIMessage: {
    type: Boolean,
    default: false
  },
  tokenDeducted: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Message', messageSchema);

