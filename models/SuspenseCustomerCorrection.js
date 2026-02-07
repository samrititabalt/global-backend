const mongoose = require('mongoose');

/**
 * Stores human corrections per customer so AI can apply them in future suspense reports.
 * Data is strictly per-user; never shared across customers.
 */
const suspenseCustomerCorrectionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  originalEntrySnippet: { type: String, required: true },
  correctedCompany: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

suspenseCustomerCorrectionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SuspenseCustomerCorrection', suspenseCustomerCorrectionSchema);
