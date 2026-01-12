const mongoose = require('mongoose');

const videoStatusSchema = new mongoose.Schema({
  videoType: {
    type: String,
    required: true,
    default: 'homepage',
    enum: ['homepage']
  },
  fileName: {
    type: String,
    required: true,
    default: 'homepage-video.mp4'
  },
  filePath: {
    type: String,
    required: false // Optional for backward compatibility
  },
  cloudinaryUrl: {
    type: String,
    required: false
  },
  cloudinaryPublicId: {
    type: String,
    required: false
  },
  exists: {
    type: Boolean,
    default: true
  },
  size: {
    type: Number,
    default: 0
  },
  lastUploaded: {
    type: Date,
    default: Date.now
  },
  lastModified: {
    type: Date,
    default: Date.now
  },
  deleted: {
    type: Boolean,
    default: false
  },
  deletionReason: {
    type: String,
    default: null
  },
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Ensure only one document exists for homepage video
videoStatusSchema.statics.getHomepageVideoStatus = async function() {
  let status = await this.findOne({ videoType: 'homepage' });
  if (!status) {
    status = await this.create({
      videoType: 'homepage',
      fileName: 'homepage-video.mp4',
      filePath: '/uploads/videos/homepage-video.mp4',
      exists: false,
      deleted: false
    });
  }
  return status;
};

module.exports = mongoose.model('VideoStatus', videoStatusSchema);
