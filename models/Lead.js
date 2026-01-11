const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  visitorName: {
    type: String,
    trim: true,
    default: null
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    trim: true,
    default: null
  },
  companyName: {
    type: String,
    trim: true,
    default: null
  },
  source: {
    type: String,
    default: 'Chatbot',
    enum: ['Chatbot', 'Website', 'Referral', 'Other']
  },
  status: {
    type: String,
    default: 'Lead',
    enum: ['Lead', 'Contacted', 'Qualified', 'Converted', 'Lost']
  },
  dateCaptured: {
    type: Date,
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
leadSchema.index({ email: 1 });
leadSchema.index({ dateCaptured: -1 });
leadSchema.index({ status: 1 });

module.exports = mongoose.model('Lead', leadSchema);
