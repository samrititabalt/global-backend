const mongoose = require('mongoose');

const PageContentSchema = new mongoose.Schema({
  pagePath: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  contentBlocks: [{
    blockId: {
      type: String,
      required: true,
    },
    blockType: {
      type: String,
      enum: ['heading', 'paragraph', 'text', 'table', 'list'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    htmlContent: {
      type: String,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  }],
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

module.exports = mongoose.model('PageContent', PageContentSchema);
