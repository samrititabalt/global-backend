const mongoose = require('mongoose');

const FirstCallDeckAgenciesSchema = new mongoose.Schema({
  slides: { type: [mongoose.Schema.Types.Mixed], default: [] },
  /** 'standard' (light) | 'consultingDark' (navy / teal / gold rate-card style) */
  visualTheme: { type: String, default: 'standard' },
  updatedBy: {
    id: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, default: '' },
    role: { type: String, default: '' }
  },
  updatedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('FirstCallDeckAgencies', FirstCallDeckAgenciesSchema);
