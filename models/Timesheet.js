const mongoose = require('mongoose');

const timesheetSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  weekStart: {
    type: Date,
    required: true
  },
  weekEnd: {
    type: Date,
    required: true
  },
  weekNumber: {
    type: String,
    required: true
  },
  dateRange: {
    type: String,
    required: true
  },
  hoursWorked: {
    type: Number,
    default: 0,
    min: 0
  },
  hourlyRate: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  approvalStatus: {
    type: String,
    enum: ['Approved', 'Not Approved', 'Conditionally Approved'],
    default: 'Not Approved'
  },
  conditionalComment: {
    type: String,
    default: ''
  },
  paidToBank: {
    type: String,
    enum: ['Yes', 'No'],
    default: 'No'
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

// Index for efficient queries
timesheetSchema.index({ agentId: 1, weekStart: 1 }, { unique: true });

// Update the updatedAt field before saving
timesheetSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.updatedAt = Date.now();
  }
  // Auto-calculate total amount
  if (this.isModified('hoursWorked') || this.isModified('hourlyRate')) {
    this.totalAmount = (this.hoursWorked || 0) * (this.hourlyRate || 0);
  }
  next();
});

module.exports = mongoose.model('Timesheet', timesheetSchema);

