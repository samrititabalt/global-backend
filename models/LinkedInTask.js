const mongoose = require('mongoose');

const LinkedInTaskSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInAccount',
    required: true,
    index: true
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInCampaign',
    index: true
  },
  type: {
    type: String,
    enum: ['sync_inbox', 'send_message', 'send_connection', 'follow_up'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  priority: {
    type: Number,
    default: 5 // 1-10, higher = more priority
  },
  // Task data
  data: {
    conversationId: String,
    messageId: mongoose.Schema.Types.ObjectId,
    messageText: String,
    profileUrl: String,
    connectionMessage: String,
    recipientId: String,
    recipientName: String
  },
  // Scheduling
  scheduledFor: Date,
  startedAt: Date,
  completedAt: Date,
  // Retry logic
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 3 },
  lastError: String,
  // Queue info
  queueJobId: String
}, {
  timestamps: true
});

LinkedInTaskSchema.index({ accountId: 1, status: 1, scheduledFor: 1 });
LinkedInTaskSchema.index({ campaignId: 1, status: 1 });
LinkedInTaskSchema.index({ status: 1, scheduledFor: 1, priority: -1 });

module.exports = mongoose.model('LinkedInTask', LinkedInTaskSchema);

