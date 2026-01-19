const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const HiringEmployeeSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: 'employee' },
  employeeCode: { type: String, default: '' },
  designation: { type: String, default: '' },
  phone: { type: String, default: '' },
  emergencyContact: { type: String, default: '' },
  bloodGroup: { type: String, default: '' },
  address: { type: String, default: '' },
  highestQualification: { type: String, default: '' },
  previousEmployerName: { type: String, default: '' }
}, { timestamps: true });

HiringEmployeeSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

HiringEmployeeSchema.methods.comparePassword = function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('HiringEmployee', HiringEmployeeSchema);
