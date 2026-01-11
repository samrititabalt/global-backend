const mongoose = require('mongoose');

const agentHoursSchema = new mongoose.Schema({
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  payRate: {
    type: Number,
    required: true,
    min: 0
  },
  hoursWorked: {
    type: Number,
    required: true,
    min: 0
  },
  totalPay: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
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
agentHoursSchema.index({ agent: 1, date: -1 });
agentHoursSchema.index({ date: -1 });

module.exports = mongoose.model('AgentHours', agentHoursSchema);
