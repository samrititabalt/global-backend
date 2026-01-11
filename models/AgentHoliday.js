const mongoose = require('mongoose');

const agentHolidaySchema = new mongoose.Schema({
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  notes: {
    type: String,
    trim: true,
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

// Index for faster queries
agentHolidaySchema.index({ agent: 1, startDate: 1 });
agentHolidaySchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('AgentHoliday', agentHolidaySchema);
