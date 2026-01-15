const mongoose = require('mongoose');

const HiringHolidaySchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringEmployee', required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, default: 'pending' },
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('HiringHoliday', HiringHolidaySchema);
