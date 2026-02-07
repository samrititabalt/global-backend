const mongoose = require('mongoose');

const suspenseJobSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true },
  fileType: { type: String, enum: ['excel', 'pdf', 'csv'], required: true },
  fileUrl: { type: String, required: true },
  cloudinaryPublicId: { type: String },
  status: {
    type: String,
    enum: ['uploaded', 'analyzing', 'ready', 'review_complete'],
    default: 'uploaded'
  },
  // Original sheet structure: array of row objects (keys = column names)
  originalColumns: [{ type: String }],
  rawRows: [{ type: mongoose.Schema.Types.Mixed }],
  // AI analysis: one entry per row index (or per "entry" row)
  analysisResult: [{
    rowIndex: Number,
    originalEntry: String,
    predictedCompany: String,
    confidence: Number,
    humanCorrection: { type: String, default: null },
    correctedAt: { type: Date }
  }],
  reviewCompletedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

suspenseJobSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SuspenseJob', suspenseJobSchema);
