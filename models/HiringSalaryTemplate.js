const mongoose = require('mongoose');

const HiringSalaryTemplateSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  salaryBreakup: {
    currency: { type: String, default: 'USD' },
    components: [
      {
        key: { type: String, default: '' },
        label: { type: String, default: '' },
        amount: { type: Number, default: 0 },
        description: { type: String, default: '' },
        category: { type: String, default: 'earning' }
      }
    ],
    totalCtc: { type: Number, default: 0 },
    netPay: { type: Number, default: 0 }
  },
  updatedBy: {
    id: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, default: '' },
    role: { type: String, default: '' }
  },
  updatedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('HiringSalaryTemplate', HiringSalaryTemplateSchema);
