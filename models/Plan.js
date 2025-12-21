const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String
  },
  price: {
    type: Number,
    required: true
  },
  tokens: {
    type: Number,
    required: true
  },
  minutesPerMonth: {
    type: Number,
    default: null
  },
  // Keep hoursPerMonth for backward compatibility (deprecated)
  hoursPerMonth: {
    type: Number,
    default: null
  },
  bonusFeatures: {
    type: [String],
    default: []
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Plan', planSchema);

