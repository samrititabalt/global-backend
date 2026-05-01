/**
 * One-off (or repeatable) GPT-generated testimonials → MongoDB for /api/public/testimonials.
 *
 * Usage (from global-backend root):
 *   node scripts/seed-homepage-testimonials.js
 *
 * Requires: MONGODB_URI, OPENAI_API_KEY (uses OPENAI_MODEL or gpt-4o-mini)
 *
 * After seeding, optionally replace imageUrl values in Atlas with Cloudinary URLs
 * (upload headshots → copy secure URL → update documents).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const OpenAI = require('openai');
const HomepageTestimonial = require('../models/HomepageTestimonial');
const { HOMEPAGE_TESTIMONIALS_FALLBACK } = require('../utils/homepageTestimonialsFallback');

const USER_PROMPT = `Generate short, realistic B2B testimonials for a company providing offshore Salesforce and data developers.
Rules:
- Return ONLY a valid JSON array (no markdown fences, no commentary).
- Exactly 10 objects.
- Each object keys: quote, name, role, company, tags
- quote: max 20 words, credible tone, no hype adjectives spam
- company: generic type only (e.g. "UK consultancy", "B2B SaaS scale-up") — NO real brand names
- tags: array of 1-2 strings, chosen only from: "Salesforce Developer", "Data Team", "7-Day Pilot", "Tableau", "Power BI"`;

function stripCodeFence(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '');
  s = s.replace(/\s*```$/i, '');
  return s.trim();
}

async function fetchGenerated() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.75,
    max_tokens: 2200,
    messages: [
      { role: 'system', content: 'You reply with JSON only.' },
      { role: 'user', content: USER_PROMPT },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content || '';
  return JSON.parse(stripCodeFence(raw));
}

async function run() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/globalcare');
  console.log('Connected to MongoDB');

  let items;
  try {
    items = await fetchGenerated();
  } catch (e) {
    console.error('GPT parse failed:', e.message);
    process.exit(1);
  }

  if (!Array.isArray(items) || items.length < 8) {
    console.error('Expected JSON array with at least 8 items, got:', typeof items);
    process.exit(1);
  }

  const portraits = HOMEPAGE_TESTIMONIALS_FALLBACK.map((t) => t.imageUrl);

  const docs = items.slice(0, 12).map((row, i) => ({
    quote: String(row.quote || '').slice(0, 500),
    name: String(row.name || '').slice(0, 120),
    role: String(row.role || '').slice(0, 120),
    company: String(row.company || '').slice(0, 160),
    imageUrl: portraits[i % portraits.length],
    tags: Array.isArray(row.tags) ? row.tags.map(String).slice(0, 3) : [],
    sortOrder: i,
    isActive: true,
  }));

  await HomepageTestimonial.deleteMany({});
  await HomepageTestimonial.insertMany(docs);
  console.log(`Inserted ${docs.length} HomepageTestimonial documents.`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
