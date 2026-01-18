const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

const filePath = process.argv[2];
const folder = process.argv[3] || 'brand-assets';

if (!filePath) {
  console.error('Usage: node uploadAssetToCloudinary.js <file-path> [folder]');
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Missing Cloudinary credentials in environment variables.');
  process.exit(1);
}

const absolutePath = path.resolve(filePath);

if (!fs.existsSync(absolutePath)) {
  console.error(`File not found: ${absolutePath}`);
  process.exit(1);
}

const upload = cloudinary.uploader.upload_stream(
  {
    folder,
    resource_type: 'image',
    use_filename: true,
    unique_filename: true
  },
  (error, result) => {
    if (error) {
      console.error('Upload failed:', error.message || error);
      process.exit(1);
    }
    console.log('CLOUDINARY_URL', result.secure_url);
  }
);

fs.createReadStream(absolutePath).pipe(upload);
