const mongoose = require('mongoose');

const FirstCallDeckMRSchema = new mongoose.Schema({
  slides: { type: [mongoose.Schema.Types.Mixed], default: [] },
  updatedBy: {
    id: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, default: '' },
    role: { type: String, default: '' }
  },
  updatedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('FirstCallDeckMR', FirstCallDeckMRSchema);
