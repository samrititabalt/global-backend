const mongoose = require('mongoose');

const TextContentSchema = new mongoose.Schema({
  contentKey: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  page: {
    type: String,
    required: true,
    index: true,
  },
  section: {
    type: String,
    default: '',
  },
  textValue: {
    type: String,
    required: true,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('TextContent', TextContentSchema);
