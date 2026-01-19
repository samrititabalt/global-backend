const mongoose = require('mongoose');

const HiringExpenseSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringEmployee', required: true },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringExpenseTemplate' },
  templateFields: [
    {
      key: { type: String, default: '' },
      label: { type: String, default: '' },
      required: { type: Boolean, default: false },
      order: { type: Number, default: 0 }
    }
  ],
  values: [
    {
      key: { type: String, default: '' },
      label: { type: String, default: '' },
      value: { type: String, default: '' }
    }
  ],
  remarks: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  expenseType: { type: String, default: '' },
  invoiceUrl: { type: String, default: '' },
  invoicePublicId: { type: String, default: '' },
  invoiceFileName: { type: String, default: '' },
  invoiceMimeType: { type: String, default: '' },
  pdfUrl: { type: String, default: '' },
  pdfPublicId: { type: String, default: '' },
  status: { type: String, default: 'pending' },
  adminComment: { type: String, default: '' },
  submittedAt: { type: Date },
  reviewedAt: { type: Date },
  reviewedBy: {
    id: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, default: '' },
    email: { type: String, default: '' }
  }
}, { timestamps: true });

module.exports = mongoose.model('HiringExpense', HiringExpenseSchema);
