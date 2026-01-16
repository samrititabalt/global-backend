const mongoose = require('mongoose');

const HiringDocumentSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringEmployee', default: null },
  title: { type: String, required: true },
  type: { type: String, required: true },
  fileUrl: { type: String, default: null },
  filePublicId: { type: String, default: null },
  fileName: { type: String, default: '' },
  fileMimeType: { type: String, default: '' },
  content: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdByRole: { type: String, default: 'employee' }
}, { timestamps: true });

module.exports = mongoose.model('HiringDocument', HiringDocumentSchema);
