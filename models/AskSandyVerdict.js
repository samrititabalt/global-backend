const mongoose = require('mongoose');

const VERDICTS = ['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'];

const askSandyVerdictSchema = new mongoose.Schema({
  entityType: { type: String, required: true, enum: ['sector', 'stock', 'commodity', 'currency'], trim: true },
  entityId: { type: String, required: true, trim: true },
  entityName: { type: String, default: '', trim: true },
  finalRating: { type: Number, required: true, min: 1, max: 10 },
  verdict: { type: String, required: true, enum: VERDICTS, trim: true },
  explanation: { type: String, default: '', trim: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true }
}, { timestamps: true });

askSandyVerdictSchema.index({ entityType: 1, entityId: 1, year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('AskSandyVerdict', askSandyVerdictSchema);
module.exports.VERDICTS = VERDICTS;
