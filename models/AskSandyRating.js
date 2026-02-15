const mongoose = require('mongoose');

const askSandyRatingSchema = new mongoose.Schema({
  entityType: { type: String, required: true, enum: ['sector', 'stock', 'commodity', 'currency'], trim: true },
  entityId: { type: String, required: true, trim: true },
  entityName: { type: String, default: '', trim: true },
  rating: { type: Number, required: true, min: 1, max: 10 },
  date: { type: Date, required: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true }
}, { timestamps: true });

askSandyRatingSchema.index({ entityType: 1, entityId: 1, date: -1 });
askSandyRatingSchema.index({ year: 1, month: 1 });

module.exports = mongoose.model('AskSandyRating', askSandyRatingSchema);
