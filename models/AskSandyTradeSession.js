const mongoose = require('mongoose');

const askSandyTradeSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'AskSandyUser', required: true },
  portfolioId: { type: mongoose.Schema.Types.ObjectId, ref: 'AskSandyPortfolio', required: true },
  stockName: { type: String, required: true },
  action: { type: String, enum: ['buy', 'sell'], required: true },
  timeframe: { type: String, enum: ['intraday', 'week', 'month'], required: true },
  targetProfit: { type: Number, default: null },
  method: { type: String, enum: ['multiple_small', 'few_big'], default: null },
  gptChallenge: { type: String, default: null },
  userAcceptedSuggestion: { type: Boolean, default: null },
  finalAction: { type: String, enum: ['buy', 'sell'], default: null },
  analysis: {
    intradayParagraph: String,
    weeklyParagraph: String,
    monthlyParagraph: String,
    entryRange: String,
    exitRange: String,
    stopLoss: String,
    takeProfit: String,
    methodExplanation: String,
    methodSteps: [String],
    raw: mongoose.Schema.Types.Mixed
  }
}, { timestamps: true });

module.exports = mongoose.model('AskSandyTradeSession', askSandyTradeSessionSchema);
