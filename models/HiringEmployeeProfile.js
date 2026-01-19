const mongoose = require('mongoose');

const HiringEmployeeProfileSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringEmployee', required: true, index: true },
  profileImageUrl: { type: String, default: '' },
  profileImagePublicId: { type: String, default: '' },
  phone: { type: String, default: '' },
  emergencyContact: { type: String, default: '' },
  bloodGroup: { type: String, default: '' },
  currentAddress: { type: String, default: '' },
  highestQualification: { type: String, default: '' },
  previousEmployer: { type: String, default: '' },
  salaryBreakup: {
    currency: { type: String, default: 'USD' },
    components: [
      {
        key: { type: String, default: '' },
        label: { type: String, default: '' },
        amount: { type: Number, default: 0 },
        description: { type: String, default: '' },
        category: { type: String, default: 'earning' }
      }
    ],
    totalCtc: { type: Number, default: 0 },
    netPay: { type: Number, default: 0 }
  },
  salaryUpdatedBy: {
    id: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, default: '' },
    role: { type: String, default: '' }
  },
  salaryUpdatedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('HiringEmployeeProfile', HiringEmployeeProfileSchema);
