const mongoose = require('mongoose');

const customerRequestSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: { type: String, required: true },
  shortDescription: { type: String, default: '' },
  expectedBudget: { type: Number, required: true }, // minutes
  expectedDeadline: { type: String, default: '' },
  deliverableFormat: { type: String, default: '' },
  relatedToSuspenseTool: { type: String, default: 'No' },
  additionalNotes: { type: String, default: '' },
  sow: {
    title: String,
    summary: String,
    scopeOfWork: String,
    deliverables: String,
    timeline: String,
    budgetMinutes: Number,
    minutesDeducted: Number,
    requiredInputs: String,
    outputFormat: String,
    notes: String
  },
  minutesDeducted: { type: Number, required: true },
  status: {
    type: String,
    enum: ['Open', 'In Progress', 'Completed'],
    default: 'Open'
  },
  fileUrls: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CustomerRequest', customerRequestSchema);
