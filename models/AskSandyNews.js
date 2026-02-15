const mongoose = require('mongoose');

const NEWS_CATEGORIES = [
  'general_market',
  'sector_specific',
  'stock_specific',
  'country_specific',
  'asian_market_opening',
  'commodity',
  'currency'
];

const askSandyNewsSchema = new mongoose.Schema({
  category: { type: String, required: true, enum: NEWS_CATEGORIES, trim: true },
  headline: { type: String, required: true, trim: true },
  summary: { type: String, default: '', trim: true },
  sourceLink: { type: String, default: '', trim: true },
  aiRating: { type: Number, default: null, min: 1, max: 10 },
  manualRating: { type: Number, default: null, min: 1, max: 10 },
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  sectorTag: { type: String, default: null, trim: true },
  stockTag: { type: String, default: null, trim: true },
  assetTag: { type: String, default: null, trim: true }
}, { timestamps: true });

askSandyNewsSchema.index({ year: 1, month: 1 });
askSandyNewsSchema.index({ category: 1, year: 1, month: 1 });

module.exports = mongoose.model('AskSandyNews', askSandyNewsSchema);
module.exports.NEWS_CATEGORIES = NEWS_CATEGORIES;
