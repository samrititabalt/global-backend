const mongoose = require('mongoose');

const HiringCompanySchema = new mongoose.Schema({
  name: { type: String, required: true },
  logoUrl: { type: String, default: null },
  signingAuthority: {
    name: { type: String, required: true },
    title: { type: String, required: true }
  }
}, { timestamps: true });

module.exports = mongoose.model('HiringCompany', HiringCompanySchema);
