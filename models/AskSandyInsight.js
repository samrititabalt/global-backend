const mongoose = require('mongoose');

const askSandyInsightSchema = new mongoose.Schema({
  /** Optional: specific stock/symbol; null means global insight for all stocks */
  stockSymbol: { type: String, default: null },
  stockName: { type: String, default: null },
  /** Optional: action/timeframe context when insight was captured */
  action: { type: String, enum: ['buy', 'sell'], default: null },
  timeframe: { type: String, enum: ['intraday', 'week', 'month'], default: null },
  /** User's question or rebuttal */
  userInput: { type: String, required: true },
  /** GPT's response (revised analysis or explanation) */
  gptResponse: { type: String, required: true },
  /** If true, this insight is used to improve future analyses for all users */
  fruitful: { type: Boolean, default: false },
  /** Optional: revised analysis numbers when GPT agreed and updated */
  revisedAnalysis: {
    intradayParagraph: String,
    weeklyParagraph: String,
    monthlyParagraph: String,
    entryRange: String,
    exitRange: String,
    stopLoss: String,
    takeProfit: String,
    methodExplanation: String,
    methodSteps: [String]
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'AskSandyUser', default: null }
}, { timestamps: true });

module.exports = mongoose.model('AskSandyInsight', askSandyInsightSchema);
