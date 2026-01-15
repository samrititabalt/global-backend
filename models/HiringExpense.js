const mongoose = require('mongoose');

const HiringExpenseSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringEmployee', required: true },
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  status: { type: String, default: 'pending' }
}, { timestamps: true });

module.exports = mongoose.model('HiringExpense', HiringExpenseSchema);
