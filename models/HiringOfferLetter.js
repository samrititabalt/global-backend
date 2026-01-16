const mongoose = require('mongoose');

const HiringOfferLetterSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringEmployee', default: null },
  candidateName: { type: String, required: true },
  roleTitle: { type: String, required: true },
  startDate: { type: String, required: true },
  salaryPackage: { type: String, required: true },
  ctcBreakdown: { type: String, default: '' },
  content: { type: String, required: true },
  fileUrl: { type: String, default: null },
  filePublicId: { type: String, default: null },
  companyName: { type: String, default: '' },
  companyLogoUrl: { type: String, default: null },
  signingAuthorityName: { type: String, default: '' },
  signingAuthorityTitle: { type: String, default: '' },
  status: { type: String, default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompanyAdmin', required: true }
}, { timestamps: true });

module.exports = mongoose.model('HiringOfferLetter', HiringOfferLetterSchema);
