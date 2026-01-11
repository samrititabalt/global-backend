const mongoose = require('mongoose');

const resumeBuilderUsageSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  usedAt: {
    type: Date,
    default: Date.now
  },
  // Don't store any resume content for privacy
});

// Index for faster queries
resumeBuilderUsageSchema.index({ customer: 1, usedAt: -1 });

module.exports = mongoose.model('ResumeBuilderUsage', resumeBuilderUsageSchema);
