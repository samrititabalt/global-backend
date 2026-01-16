const mongoose = require('mongoose');

const linkedInTaskSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  linkedInAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInAccount',
    required: true,
    index: true
  },
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInCampaign',
    default: null,
    index: true
  },
  type: {
    type: String,
    enum: ['send_message', 'send_connection', 'read_inbox', 'reply_message'],
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  priority: {
    type: Number,
    default: 5,
    min: 1,
    max: 10
  },
  // Task data
  data: {
    // For send_message
    conversationId: String,
    messageText: String,
    recipientName: String,
    // For send_connection
    profileUrl: String,
    connectionMessage: String,
    // For reply_message
    messageId: mongoose.Schema.Types.ObjectId,
    replyText: String
  },
  // Scheduling
  scheduledFor: {
    type: Date,
    default: Date.now,
    index: true
  },
  startedAt: Date,
  completedAt: Date,
  // Retry logic
  retryCount: {
    type: Number,
    default: 0
  },
  maxRetries: {
    type: Number,
    default: 3
  },
  lastError: {
    message: String,
    timestamp: Date,
    code: String
  },
  // BullMQ job ID
  jobId: {
    type: String,
    default: null,
    index: true
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

linkedInTaskSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes
linkedInTaskSchema.index({ status: 1, scheduledFor: 1 });
linkedInTaskSchema.index({ linkedInAccount: 1, status: 1 });
linkedInTaskSchema.index({ campaign: 1, status: 1 });
linkedInTaskSchema.index({ createdAt: -1 });

module.exports = mongoose.model('LinkedInTask', linkedInTaskSchema);

