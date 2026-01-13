const mongoose = require('mongoose');

const sharedChartSchema = new mongoose.Schema({
  shareId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  chartData: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  chartConfigs: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  gridData: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  fieldRoles: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  fieldModes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  dateHierarchies: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  availableColumns: {
    type: [String],
    default: []
  },
  sharedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  sharedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Default expiration: 1 year from now
      const oneYear = new Date();
      oneYear.setFullYear(oneYear.getFullYear() + 1);
      return oneYear;
    }
  }
}, {
  timestamps: true
});

// Index for faster lookups
sharedChartSchema.index({ shareId: 1 });
sharedChartSchema.index({ expiresAt: 1 });

// Auto-delete expired charts
sharedChartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SharedChart', sharedChartSchema);
