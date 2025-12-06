/**
 * Cloudinary Service
 * Handles all media uploads to Cloudinary
 */

const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

// Configure Cloudinary
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.warn('⚠️  Cloudinary credentials not set. Media uploads will fail.');
  console.warn('Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload file to Cloudinary
 * @param {Buffer|Stream} file - File buffer or stream
 * @param {Object} options - Upload options
 * @returns {Promise} Cloudinary upload result
 */
const uploadToCloudinary = async (file, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder: options.folder || 'chat-media',
      resource_type: options.resource_type || 'auto',
      ...options,
    };

    // If file is a buffer, convert to base64 or use upload_stream
    if (Buffer.isBuffer(file)) {
      // Convert buffer to base64 data URI for upload
      const base64Data = file.toString('base64');
      const dataUri = `data:${options.mimeType || 'application/octet-stream'};base64,${base64Data}`;
      
      cloudinary.uploader.upload(
        dataUri,
        uploadOptions,
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            reject(error);
          } else {
            resolve(result);
          }
        }
      );
    } else {
      // File is already a stream
      const stream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            reject(error);
          } else {
            resolve(result);
          }
        }
      );

      file.pipe(stream);
    }
  });
};

/**
 * Upload image to Cloudinary
 * @param {Buffer|Stream} file - Image file
 * @param {String} folder - Folder path in Cloudinary
 * @param {String} mimeType - MIME type of the file
 * @returns {Promise} Upload result with secure_url
 */
const uploadImage = async (file, folder = 'chat-media/images', mimeType = 'image/jpeg') => {
  try {
    const result = await uploadToCloudinary(file, {
      folder,
      resource_type: 'image',
      mimeType,
      transformation: [
        { quality: 'auto', fetch_format: 'auto' },
        { width: 1920, height: 1080, crop: 'limit' }
      ],
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (error) {
    console.error('Image upload error:', error);
    throw error;
  }
};

/**
 * Upload audio file to Cloudinary
 * @param {Buffer|Stream} file - Audio file
 * @param {String} folder - Folder path in Cloudinary
 * @param {String} mimeType - MIME type of the file
 * @returns {Promise} Upload result with secure_url
 */
const uploadAudio = async (file, folder = 'chat-media/audio', mimeType = 'audio/mpeg') => {
  try {
    const result = await uploadToCloudinary(file, {
      folder,
      resource_type: 'video', // Cloudinary uses 'video' for audio files
      mimeType,
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      duration: result.duration,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (error) {
    console.error('Audio upload error:', error);
    throw error;
  }
};

/**
 * Upload file/document to Cloudinary
 * @param {Buffer|Stream} file - File
 * @param {String} folder - Folder path in Cloudinary
 * @param {String} mimeType - MIME type of the file
 * @returns {Promise} Upload result with secure_url
 */
const uploadFile = async (file, folder = 'chat-media/files', mimeType = 'application/octet-stream') => {
  try {
    const result = await uploadToCloudinary(file, {
      folder,
      resource_type: 'raw',
      mimeType,
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (error) {
    console.error('File upload error:', error);
    throw error;
  }
};

/**
 * Delete file from Cloudinary
 * @param {String} publicId - Public ID of the file
 * @param {String} resourceType - Resource type (image, video, raw)
 * @returns {Promise} Deletion result
 */
const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    return result;
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw error;
  }
};

module.exports = {
  uploadImage,
  uploadAudio,
  uploadFile,
  uploadToCloudinary,
  deleteFromCloudinary,
};
