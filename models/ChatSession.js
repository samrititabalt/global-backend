const mongoose = require('mongoose');

const chatSessionSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  subService: {
    type: String
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'completed', 'transferred'],
    default: 'pending'
  },
  assignedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  aiMessagesSent: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('ChatSession', chatSessionSchema);

