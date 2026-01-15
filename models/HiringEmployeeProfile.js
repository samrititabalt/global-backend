const mongoose = require('mongoose');

const HiringEmployeeProfileSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringEmployee', required: true, index: true },
  phone: { type: String, default: '' },
  emergencyContact: { type: String, default: '' },
  bloodGroup: { type: String, default: '' },
  currentAddress: { type: String, default: '' },
  highestQualification: { type: String, default: '' },
  previousEmployer: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('HiringEmployeeProfile', HiringEmployeeProfileSchema);
