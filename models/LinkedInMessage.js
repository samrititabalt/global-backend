const mongoose = require('mongoose');

const LinkedInMessageSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInAccount',
    required: true,
    index: true
  },
  conversationId: {
    type: String,
    required: true,
    index: true
  },
  senderId: String,
  senderName: String,
  senderProfileUrl: String,
  messageText: {
    type: String,
    required: true
  },
  messageId: {
    type: String,
    unique: true,
    sparse: true
  },
  timestamp: {
    type: Date,
    required: true
  },
  isRead: {
    type: Boolean,
    default: false
  },
  isReplied: {
    type: Boolean,
    default: false
  },
  replyMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInMessage'
  },
  // AI suggestions
  aiSuggestions: [{
    text: String,
    generatedAt: Date
  }]
}, {
  timestamps: true
});

LinkedInMessageSchema.index({ accountId: 1, timestamp: -1 });
LinkedInMessageSchema.index({ accountId: 1, conversationId: 1, timestamp: -1 });

module.exports = mongoose.model('LinkedInMessage', LinkedInMessageSchema);

