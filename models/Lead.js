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
  // New fields for chatbot integration
  transcript: {
    type: String,
    trim: true,
    default: null
  },
  summary: {
    type: String,
    trim: true,
    default: null
  },
  conversations: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    transcript: String,
    summary: String
  }],
  consent: {
    type: Boolean,
    default: false
  },
  pageUrl: {
    type: String,
    trim: true,
    default: null
  },
  utm: {
    source: { type: String, default: null },
    campaign: { type: String, default: null },
    medium: { type: String, default: null },
    term: { type: String, default: null },
    content: { type: String, default: null }
  },
  assignedAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  gdprDeleteRequested: {
    type: Boolean,
    default: false
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
leadSchema.index({ phoneNumber: 1 });
leadSchema.index({ dateCaptured: -1 });
leadSchema.index({ status: 1 });
leadSchema.index({ 'utm.source': 1, 'utm.campaign': 1 });

// Update updatedAt before saving
leadSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Lead', leadSchema);
