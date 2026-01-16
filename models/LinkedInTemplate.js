const mongoose = require('mongoose');

const LinkedInTemplateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['message', 'connection_request'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  variables: [{
    name: String,
    description: String,
    example: String
  }],
  isDefault: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

LinkedInTemplateSchema.index({ userId: 1, type: 1 });

module.exports = mongoose.model('LinkedInTemplate', LinkedInTemplateSchema);

