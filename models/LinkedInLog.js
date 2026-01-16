const mongoose = require('mongoose');

const LinkedInLogSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInAccount',
    required: true,
    index: true
  },
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInTask',
    index: true
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LinkedInCampaign',
    index: true
  },
  action: {
    type: String,
    enum: [
      'sync_inbox',
      'send_message',
      'send_connection',
      'follow_up',
      'detect_captcha',
      'detect_warning',
      'pause_account',
      'resume_account',
      'error'
    ],
    required: true
  },
  status: {
    type: String,
    enum: ['success', 'failure', 'warning'],
    required: true
  },
  message: String,
  error: String,
  metadata: mongoose.Schema.Types.Mixed,
  duration: Number // milliseconds
}, {
  timestamps: true
});

LinkedInLogSchema.index({ accountId: 1, createdAt: -1 });
LinkedInLogSchema.index({ accountId: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model('LinkedInLog', LinkedInLogSchema);

