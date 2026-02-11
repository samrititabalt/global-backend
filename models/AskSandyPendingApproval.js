const mongoose = require('mongoose');
const crypto = require('crypto');

const askSandyPendingApprovalSchema = new mongoose.Schema({
  requestedEmail: { type: String, required: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  /** Which of the two approvers the user indicated (tabaltllp@gmail.com or rainasarita72@gmail.com) */
  approverEmail: { type: String, required: true, lowercase: true, trim: true },
  token: { type: String, required: true, unique: true },
  approved: { type: Boolean, default: false },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: String, default: null },
  used: { type: Boolean, default: false }
}, { timestamps: true });

askSandyPendingApprovalSchema.index({ requestedEmail: 1 });
askSandyPendingApprovalSchema.index({ token: 1 });

module.exports = mongoose.model('AskSandyPendingApproval', askSandyPendingApprovalSchema);
