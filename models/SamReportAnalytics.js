const mongoose = require('mongoose');

const SamReportAnalyticsSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  report: { type: mongoose.Schema.Types.ObjectId, ref: 'SamReport', default: null },
  eventType: {
    type: String,
    enum: [
      'report_generated',
      'pdf_generated',
      'pdf_downloaded',
      'sample_viewed',
      'sample_generated',
      'session_started',
      'session_ended'
    ],
    required: true
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

SamReportAnalyticsSchema.index({ eventType: 1, createdAt: -1 });
SamReportAnalyticsSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SamReportAnalytics', SamReportAnalyticsSchema);
