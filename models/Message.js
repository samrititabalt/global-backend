const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatSession',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderRole: {
    type: String,
    enum: ['customer', 'agent', 'admin', 'system'],
    required: true
  },
  content: {
    type: String
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'system'],
    default: 'text'
  },
  fileUrl: {
    type: String
  },
  fileName: {
    type: String
  },
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'audio', 'file']
    },
    url: String,
    publicId: String,
    fileName: String,
    size: Number,
    width: Number,
    height: Number,
    duration: Number
  }],
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },
  isAIMessage: {
    type: Boolean,
    default: false
  },
  tokenDeducted: {
    type: Boolean,
    default: false
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date
  },
  originalContent: {
    type: String  // Store original content for deleted messages
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
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

// Update the updatedAt field before saving
messageSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.updatedAt = Date.now();
  }
  next();
});

module.exports = mongoose.model('Message', messageSchema);

