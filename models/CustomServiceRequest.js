const mongoose = require('mongoose');

const customServiceRequestSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  customerName: {
    type: String,
    required: true
  },
  customerEmail: {
    type: String,
    required: true
  },
  requestDetails: {
    type: String,
    required: true
  },
  plan: {
    type: String,
    default: 'No plan'
  },
  tokenBalance: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['New – Custom Request', 'Assigned', 'completed', 'rejected'],
    default: 'New – Custom Request'
  },
  assignedAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  adminNotes: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: {
    type: Date
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

module.exports = mongoose.model('CustomServiceRequest', customServiceRequestSchema);
