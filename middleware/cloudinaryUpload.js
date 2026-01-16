/**
 * Cloudinary Upload Middleware
 * Handles file uploads using multer and Cloudinary
 */

const multer = require('multer');
const { uploadImage, uploadAudio, uploadFile } = require('../services/cloudinary');

// Memory storage for multer (files will be in memory before uploading to Cloudinary)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Accept images
  if (file.fieldname === 'image' || file.fieldname === 'avatar' || file.fieldname === 'logo') {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
  // Accept all files
  else if (file.fieldname === 'file') {
    cb(null, true);
  }
  // Accept audio
  else if (file.fieldname === 'audio') {
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'audio/webm') {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
  else {
    cb(null, true);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB default
  },
  fileFilter: fileFilter
});

/**
 * Middleware to upload files to Cloudinary after multer processing
 */
const uploadToCloudinary = async (req, res, next) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return next();
  }

  // Check if Cloudinary is configured
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return res.status(500).json({
      message: 'Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file',
      error: 'Cloudinary configuration missing'
    });
  }

  try {
    const uploadPromises = [];

    // Upload images
    if (req.files.image && req.files.image.length > 0) {
      for (const file of req.files.image) {
        const uploadPromise = uploadImage(file.buffer, `chat-media/images/${req.user?._id || 'temp'}`, file.mimetype)
          .then(result => ({
            type: 'image',
            url: result.url,
            publicId: result.publicId,
            fileName: file.originalname,
            size: result.bytes,
            width: result.width,
            height: result.height,
          }))
          .catch(error => {
            console.error(`Error uploading image ${file.originalname}:`, error);
            throw new Error(`Failed to upload image: ${error.message}`);
          });
        uploadPromises.push(uploadPromise);
      }
    }

    // Upload company logos
    if (req.files.logo && req.files.logo.length > 0) {
      for (const file of req.files.logo) {
        const uploadPromise = uploadImage(file.buffer, `hiring-pro/logos/${req.user?._id || 'temp'}`, file.mimetype)
          .then(result => ({
            type: 'logo',
            url: result.url,
            publicId: result.publicId,
            fileName: file.originalname,
            size: result.bytes,
            width: result.width,
            height: result.height,
          }))
          .catch(error => {
            console.error(`Error uploading logo ${file.originalname}:`, error);
            throw new Error(`Failed to upload logo: ${error.message}`);
          });
        uploadPromises.push(uploadPromise);
      }
    }

    // Upload avatar
    if (req.files.avatar && req.files.avatar.length > 0) {
      for (const file of req.files.avatar) {
        const uploadPromise = uploadImage(file.buffer, `avatars/${req.user?._id || 'temp'}`, file.mimetype)
          .then(result => ({
            type: 'avatar',
            url: result.url,
            publicId: result.publicId,
            fileName: file.originalname,
            size: result.bytes,
            width: result.width,
            height: result.height,
          }))
          .catch(error => {
            console.error(`Error uploading avatar ${file.originalname}:`, error);
            throw new Error(`Failed to upload avatar: ${error.message}`);
          });
        uploadPromises.push(uploadPromise);
      }
    }

    // Upload audio files
    if (req.files.audio && req.files.audio.length > 0) {
      for (const file of req.files.audio) {
        const uploadPromise = uploadAudio(file.buffer, `chat-media/audio/${req.user._id}`, file.mimetype)
          .then(result => ({
            type: 'audio',
            url: result.url,
            publicId: result.publicId,
            fileName: file.originalname,
            size: result.bytes,
            duration: result.duration,
          }))
          .catch(error => {
            console.error(`Error uploading audio ${file.originalname}:`, error);
            throw new Error(`Failed to upload audio: ${error.message}`);
          });
        uploadPromises.push(uploadPromise);
      }
    }

    // Upload files
    if (req.files.file && req.files.file.length > 0) {
      for (const file of req.files.file) {
        const uploadPromise = uploadFile(file.buffer, `chat-media/files/${req.user._id}`, file.mimetype)
          .then(result => ({
            type: 'file',
            url: result.url,
            publicId: result.publicId,
            fileName: file.originalname,
            size: result.bytes,
          }))
          .catch(error => {
            console.error(`Error uploading file ${file.originalname}:`, error);
            throw new Error(`Failed to upload file: ${error.message}`);
          });
        uploadPromises.push(uploadPromise);
      }
    }

    // Wait for all uploads to complete
    const uploadedFiles = await Promise.all(uploadPromises);
    req.uploadedFiles = uploadedFiles;

    next();
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return res.status(500).json({
      message: 'File upload failed',
      error: error.message || 'Unknown upload error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

module.exports = {
  upload,
  uploadToCloudinary,
};
