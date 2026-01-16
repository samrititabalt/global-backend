const mongoose = require('mongoose');

const LinkedInCampaignSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInAccount',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['connection_request', 'follow_up_message'],
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'paused', 'completed', 'stopped'],
    default: 'draft'
  },
  // Connection request campaign
  profileUrls: [String],
  connectionMessageTemplate: String,
  // Follow-up message campaign
  targetConversations: [{
    conversationId: String,
    messageId: mongoose.Schema.Types.ObjectId
  }],
  followUpMessageTemplate: String,
  // Settings
  settings: {
    dailyLimit: { type: Number, default: 20 },
    delayMinSeconds: { type: Number, default: 120 },
    delayMaxSeconds: { type: Number, default: 300 },
    workingHoursStart: String,
    workingHoursEnd: String,
    workingDays: [String],
    stopOnReply: { type: Boolean, default: true }
  },
  // Stats
  stats: {
    totalSent: { type: Number, default: 0 },
    totalAccepted: { type: Number, default: 0 },
    totalReplied: { type: Number, default: 0 },
    totalFailed: { type: Number, default: 0 }
  },
  startedAt: Date,
  completedAt: Date,
  pausedAt: Date
}, {
  timestamps: true
});

LinkedInCampaignSchema.index({ accountId: 1, status: 1 });
LinkedInCampaignSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('LinkedInCampaign', LinkedInCampaignSchema);

