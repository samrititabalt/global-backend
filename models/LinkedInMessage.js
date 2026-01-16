const mongoose = require('mongoose');

const linkedInMessageSchema = new mongoose.Schema({
  linkedInAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInAccount',
    required: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  conversationId: {
    type: String,
    required: true,
    index: true
  },
  conversationUrl: {
    type: String,
    default: ''
  },
  senderName: {
    type: String,
    required: true
  },
  senderProfileUrl: {
    type: String,
    default: ''
  },
  senderLinkedInId: {
    type: String,
    default: ''
  },
  messageText: {
    type: String,
    required: true
  },
  messageType: {
    type: String,
    enum: ['incoming', 'outgoing'],
    required: true
  },
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  linkedInMessageId: {
    type: String,
    default: ''
  },
  isRead: {
    type: Boolean,
    default: false
  },
  isReplied: {
    type: Boolean,
    default: false
  },
  replySentAt: Date,
  // For bulk reply tracking
  bulkReplyCampaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInCampaign',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

linkedInMessageSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes
linkedInMessageSchema.index({ linkedInAccount: 1, conversationId: 1, timestamp: -1 });
linkedInMessageSchema.index({ user: 1, isRead: 1, timestamp: -1 });
linkedInMessageSchema.index({ linkedInAccount: 1, isReplied: 1 });

module.exports = mongoose.model('LinkedInMessage', linkedInMessageSchema);

