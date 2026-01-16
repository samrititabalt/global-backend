const mongoose = require('mongoose');

const linkedInTemplateSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['connection_request', 'follow_up', 'reply'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  variables: [{
    type: String,
    default: []
  }], // e.g., ['{{name}}', '{{company}}']
  isDefault: {
    type: Boolean,
    default: false
  },
  usageCount: {
    type: Number,
    default: 0
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

linkedInTemplateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes
linkedInTemplateSchema.index({ user: 1, type: 1 });
linkedInTemplateSchema.index({ user: 1, isDefault: 1 });

module.exports = mongoose.model('LinkedInTemplate', linkedInTemplateSchema);

