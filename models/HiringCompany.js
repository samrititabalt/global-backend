const mongoose = require('mongoose');

const HiringCompanySchema = new mongoose.Schema({
  name: { type: String, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  customerEmail: { type: String, required: true, lowercase: true },
  logoUrl: { type: String, default: null },
  signingAuthority: {
    name: { type: String, required: true },
    title: { type: String, required: true }
  },
  onboardingComplete: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('HiringCompany', HiringCompanySchema);
