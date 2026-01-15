const mongoose = require('mongoose');

const HiringTimesheetSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringCompany', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringEmployee', required: true },
  weekStart: { type: Date, required: true },
  weekEnd: { type: Date, required: true },
  hoursWorked: { type: Number, default: 0 },
  status: { type: String, default: 'pending' }
}, { timestamps: true });

module.exports = mongoose.model('HiringTimesheet', HiringTimesheetSchema);
