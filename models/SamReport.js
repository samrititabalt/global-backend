const mongoose = require('mongoose');

const SamReportSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reportType: {
    type: String,
    enum: ['industry', 'sector', 'company', 'sample_industry', 'sample_sector', 'sample_company'],
    required: true
  },
  industry: { type: String, default: '' },
  sector: { type: String, default: '' },
  yearRange: { type: String, default: '' },
  companyName: { type: String, default: '' },
  region: { type: String, default: '' },
  content: { type: mongoose.Schema.Types.Mixed, default: {} },
  pdfUrl: { type: String, default: null },
  pdfPublicId: { type: String, default: null },
  isSample: { type: Boolean, default: false }
}, { timestamps: true });

SamReportSchema.index({ reportType: 1, createdAt: -1 });
SamReportSchema.index({ industry: 1, sector: 1 });

module.exports = mongoose.model('SamReport', SamReportSchema);
