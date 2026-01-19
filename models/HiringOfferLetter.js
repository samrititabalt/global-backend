const mongoose = require('mongoose');

const HiringOfferLetterSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringEmployee', default: null },
  candidateName: { type: String, required: true },
  roleTitle: { type: String, default: '' },
  startDate: { type: String, default: '' },
  salaryPackage: { type: String, default: '' },
  ctcBreakdown: { type: String, default: '' },
  documentTitle: { type: String, default: '' },
  documentType: { type: String, default: 'Offer Letter' },
  customDocumentType: { type: String, default: '' },
  employeeCode: { type: String, default: '' },
  documentDate: { type: String, default: '' },
  content: { type: String, required: true },
  fileUrl: { type: String, default: null },
  filePublicId: { type: String, default: null },
  companyName: { type: String, default: '' },
  companyLogoUrl: { type: String, default: null },
  documentLogoUrl: { type: String, default: null },
  adminSignatureUrl: { type: String, default: '' },
  adminSignaturePublicId: { type: String, default: '' },
  employeeSignatureUrl: { type: String, default: '' },
  employeeSignaturePublicId: { type: String, default: '' },
  adminSignedAt: { type: Date },
  employeeSignedAt: { type: Date },
  signingAuthorityName: { type: String, default: '' },
  signingAuthorityTitle: { type: String, default: '' },
  status: { type: String, default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompanyAdmin', default: null }
}, { timestamps: true });

module.exports = mongoose.model('HiringOfferLetter', HiringOfferLetterSchema);
