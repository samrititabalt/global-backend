const mongoose = require('mongoose');

const leverWeightSchema = new mongoose.Schema({
  leverName: { type: String, required: true, trim: true },
  intradayPct: { type: Number, default: 0, min: 0, max: 100 },
  weekPct: { type: Number, default: 0, min: 0, max: 100 },
  monthPct: { type: Number, default: 0, min: 0, max: 100 }
}, { _id: true });

const askSandyLeverSchema = new mongoose.Schema({
  stockSymbol: { type: String, required: true, trim: true, unique: true },
  stockName: { type: String, required: true, trim: true },
  levers: [leverWeightSchema]
}, { timestamps: true });

module.exports = mongoose.model('AskSandyLever', askSandyLeverSchema);
