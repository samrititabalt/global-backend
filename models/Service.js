const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String
  },
  /** Salesforce / Tabalt industry cloud label for assignment context (e.g. Financial Services Cloud). */
  industryCloud: {
    type: String,
    default: '',
    trim: true
  },
  subServices: [{
    name: {
      type: String,
      required: true
    },
    description: {
      type: String
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Service', serviceSchema);

