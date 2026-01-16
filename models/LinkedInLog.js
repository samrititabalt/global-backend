const mongoose = require('mongoose');

const linkedInLogSchema = new mongoose.Schema({
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
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInTask',
    default: null
  },
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInCampaign',
    default: null
  },
  action: {
    type: String,
    required: true,
    enum: [
      'account_connected',
      'account_disconnected',
      'inbox_synced',
      'message_sent',
      'message_replied',
      'connection_sent',
      'campaign_started',
      'campaign_paused',
      'campaign_stopped',
      'campaign_completed',
      'error_occurred',
      'captcha_detected',
      'warning_received',
      'rate_limit_hit',
      'account_banned'
    ],
    index: true
  },
  status: {
    type: String,
    enum: ['success', 'failure', 'warning'],
    required: true,
    index: true
  },
  message: {
    type: String,
    required: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Indexes
linkedInLogSchema.index({ user: 1, timestamp: -1 });
linkedInLogSchema.index({ linkedInAccount: 1, timestamp: -1 });
linkedInLogSchema.index({ action: 1, timestamp: -1 });
linkedInLogSchema.index({ status: 1, timestamp: -1 });

module.exports = mongoose.model('LinkedInLog', linkedInLogSchema);

