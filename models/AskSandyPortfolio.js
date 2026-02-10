const mongoose = require('mongoose');

const askSandyPortfolioSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'AskSandyUser', required: true },
  stockName: { type: String, required: true, trim: true },
  symbol: { type: String, trim: true, default: '' },
  quantity: { type: Number, required: true, min: 0 },
  avgBuyPrice: { type: Number, required: true, min: 0 },
  currentPrice: { type: Number, default: null },
  priceAsOfDate: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('AskSandyPortfolio', askSandyPortfolioSchema);
