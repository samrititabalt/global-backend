const mongoose = require('mongoose');

const linkedInCampaignSchema = new mongoose.Schema({
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
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['connection_request', 'follow_up_message', 'bulk_reply'],
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'paused', 'completed', 'stopped'],
    default: 'draft',
    index: true
  },
  // Connection request campaign
  connectionRequest: {
    profileUrls: [{
      type: String,
      trim: true
    }],
    messageTemplate: {
      type: String,
      default: ''
    },
    dailyLimit: {
      type: Number,
      default: 25,
      min: 1,
      max: 60
    },
    delayRange: {
      min: { type: Number, default: 120 }, // seconds
      max: { type: Number, default: 300 }
    }
  },
  // Follow-up message campaign
  followUpMessage: {
    delayDays: {
      type: Number,
      default: 3,
      min: 1,
      max: 30
    },
    messageTemplate: {
      type: String,
      required: true
    },
    targetConnections: [{
      type: String // LinkedIn profile URLs or IDs
    }]
  },
  // Bulk reply campaign
  bulkReply: {
    conversationIds: [{
      type: String
    }],
    messageTemplate: {
      type: String,
      required: true
    },
    delayRange: {
      min: { type: Number, default: 120 }, // seconds between replies
      max: { type: Number, default: 300 }
    },
    stopOnReply: {
      type: Boolean,
      default: true
    }
  },
  // Statistics
  stats: {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    pending: { type: Number, default: 0 }
  },
  startedAt: Date,
  completedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

linkedInCampaignSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes
linkedInCampaignSchema.index({ user: 1, status: 1 });
linkedInCampaignSchema.index({ linkedInAccount: 1, status: 1 });
linkedInCampaignSchema.index({ createdAt: -1 });

module.exports = mongoose.model('LinkedInCampaign', linkedInCampaignSchema);

