const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  chatSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatSession',
    required: true
  },
  caller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  callerRole: {
    type: String,
    enum: ['customer', 'agent'],
    required: true
  },
  receiverRole: {
    type: String,
    enum: ['customer', 'agent'],
    required: true
  },
  duration: {
    type: Number, // Duration in seconds
    default: 0
  },
  status: {
    type: String,
    enum: ['missed', 'answered', 'rejected', 'ended'],
    default: 'ended'
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
callSchema.index({ chatSession: 1, createdAt: -1 });
callSchema.index({ caller: 1, createdAt: -1 });
callSchema.index({ receiver: 1, createdAt: -1 });

module.exports = mongoose.model('Call', callSchema);
