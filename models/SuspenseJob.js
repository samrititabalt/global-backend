const mongoose = require('mongoose');

const analysisEntrySchema = new mongoose.Schema({
  rowIndex: Number,
  originalEntry: String,
  predictedCompany: String,
  confidence: Number,
  humanCorrection: { type: String, default: null },
  correctedAt: { type: Date },
  vendorCategory: { type: String, default: null },
  remarks: { type: String, default: null }
}, { _id: false });

const sheetSchema = new mongoose.Schema({
  sheetId: { type: String, required: true },
  sheetName: { type: String, required: true },
  workbookName: { type: String, default: '' },
  fileUrl: { type: String },
  originalColumns: [{ type: String }],
  rawRows: [{ type: mongoose.Schema.Types.Mixed }],
  analysisResult: [analysisEntrySchema]
}, { _id: false });

const suspenseJobSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, default: '' },
  fileType: { type: String, enum: ['excel', 'pdf', 'csv', 'multi'], default: 'excel' },
  fileUrl: { type: String, default: '' },
  cloudinaryPublicId: { type: String },
  country: { type: String, default: '' },
  multiSheet: { type: Boolean, default: false },
  multiWorkbook: { type: Boolean, default: false },
  hasPdfUpload: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['uploaded', 'analyzing', 'ready', 'review_complete'],
    default: 'uploaded'
  },
  sheets: [sheetSchema],
  summaryReport: { type: String, default: '' },
  originalColumns: [{ type: String }],
  rawRows: [{ type: mongoose.Schema.Types.Mixed }],
  analysisResult: [analysisEntrySchema],
  reviewCompletedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

suspenseJobSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SuspenseJob', suspenseJobSchema);
