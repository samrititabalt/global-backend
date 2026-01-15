const mongoose = require('mongoose');

const HiringEmploymentContractSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringEmployee', default: null },
  candidateName: { type: String, required: true },
  roleTitle: { type: String, required: true },
  startDate: { type: String, required: true },
  salaryPackage: { type: String, required: true },
  content: { type: String, required: true },
  status: { type: String, default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompanyAdmin', required: true }
}, { timestamps: true });

module.exports = mongoose.model('HiringEmploymentContract', HiringEmploymentContractSchema);
