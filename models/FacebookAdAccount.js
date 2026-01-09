const mongoose = require('mongoose');

const facebookAdAccountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  adAccountId: {
    type: String,
    required: true,
  },
  pageId: {
    type: String,
  },
  accessToken: {
    type: String,
    required: true,
  },
  refreshToken: {
    type: String,
  },
  expiresAt: {
    type: Date,
  },
  metadata: {
    lastSynced: Date,
    scopes: [String],
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('FacebookAdAccount', facebookAdAccountSchema);

