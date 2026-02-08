/**
 * Upload the default SamStudios logo to Cloudinary and set it as the homepage logo.
 * Run from backend root: node scripts/uploadHomepageLogo.js [path-to-logo.png]
 * Default path: ../global-frontend/public/assets/samstudios-logo.png
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const SiteSetting = require('../models/SiteSetting');

const filePath = process.argv[2] || path.join(__dirname, '..', 'global-frontend', 'public', 'assets', 'samstudios-logo.png');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Missing Cloudinary credentials. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env');
  process.exit(1);
}

const absolutePath = path.resolve(filePath);
if (!fs.existsSync(absolutePath)) {
  console.error('File not found:', absolutePath);
  console.error('Usage: node scripts/uploadHomepageLogo.js [path-to-logo.png]');
  process.exit(1);
}

async function run() {
  try {
    const url = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'site-media', resource_type: 'image', use_filename: true, unique_filename: true },
        (error, result) => {
          if (error) reject(error);
          else resolve(result.secure_url);
        }
      );
      fs.createReadStream(absolutePath).pipe(uploadStream);
    });

    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/globalcare');
    await SiteSetting.set('homepage_logo', url);
    console.log('Homepage logo uploaded to Cloudinary and set as homepage_logo.');
    console.log('URL:', url);
    process.exit(0);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

run();
