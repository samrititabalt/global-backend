const mongoose = require('mongoose');

const homepageTestimonialSchema = new mongoose.Schema(
  {
    quote: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    company: { type: String, required: true, trim: true },
    imageUrl: { type: String, required: true, trim: true },
    tags: { type: [String], default: [] },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

homepageTestimonialSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('HomepageTestimonial', homepageTestimonialSchema);
