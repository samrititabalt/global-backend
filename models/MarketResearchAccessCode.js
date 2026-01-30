const mongoose = require('mongoose');

const MarketResearchAccessCodeSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true,
  },
  secretNumber: {
    type: String,
    required: true,
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('MarketResearchAccessCode', MarketResearchAccessCodeSchema);
