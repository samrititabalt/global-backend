const mongoose = require('mongoose');

const HiringExpenseTemplateSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  fields: [
    {
      key: { type: String, default: '' },
      label: { type: String, default: '' },
      required: { type: Boolean, default: false },
      order: { type: Number, default: 0 }
    }
  ],
  createdBy: {
    id: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, default: '' },
    email: { type: String, default: '' }
  }
}, { timestamps: true });

module.exports = mongoose.model('HiringExpenseTemplate', HiringExpenseTemplateSchema);
