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

    // If file is a buffer, use upload_stream for better memory efficiency (especially for large videos)
    if (Buffer.isBuffer(file)) {
      // For large files (videos), use upload_stream instead of base64
      // This is more memory efficient and handles large files better
      const { Readable } = require('stream');
      const stream = Readable.from(file);
      
      const uploadStream = cloudinary.uploader.upload_stream(
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
      
      stream.pipe(uploadStream);
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
 * Upload video to Cloudinary
 * @param {Buffer|Stream} file - Video file
 * @param {String} folder - Folder path in Cloudinary
 * @param {String} mimeType - MIME type of the file
 * @returns {Promise} Upload result with secure_url
 */
const uploadVideo = async (file, folder = 'homepage-media/videos', mimeType = 'video/mp4') => {
  try {
    // Check if Cloudinary is configured
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      throw new Error('Cloudinary credentials not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file.');
    }

    const fileSizeMB = (file.length / 1024 / 1024).toFixed(2);
    console.log('[Cloudinary] Uploading video to folder:', folder);
    console.log('[Cloudinary] File size:', fileSizeMB, 'MB');
    
    // Cloudinary free tier limit is 100MB, paid tiers can handle larger
    // For files over 100MB, we need to use chunked upload or warn the user
    if (file.length > 100 * 1024 * 1024) {
      console.warn('[Cloudinary] File size exceeds 100MB. Cloudinary free tier limit is 100MB. Paid plans support up to 2GB.');
    }
    
    const result = await uploadToCloudinary(file, {
      folder,
      resource_type: 'video',
      mimeType,
      chunk_size: 6000000, // 6MB chunks for large videos
      // For large files, use eager transformation to process in background
      eager_async: true,
    });

    console.log('[Cloudinary] Video uploaded successfully:', result.secure_url);

    return {
      url: result.secure_url,
      publicId: result.public_id,
      duration: result.duration,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
    };
  } catch (error) {
    console.error('[Cloudinary] Video upload error:', error);
    
    // Handle specific Cloudinary errors
    if (error.http_code === 413 || error.message?.includes('413') || error.message?.includes('too large')) {
      throw new Error('File too large for Cloudinary. Maximum size is 100MB for free accounts, 2GB for paid accounts. Please compress your video or upgrade your Cloudinary plan.');
    }
    if (error.http_code === 400 && error.message?.includes('Invalid')) {
      throw new Error('Invalid video file format. Please ensure the file is a valid MP4, MOV, or WEBM video.');
    }
    if (error.message && error.message.includes('Invalid API')) {
      throw new Error('Invalid Cloudinary API credentials. Please check your CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.');
    }
    if (error.message && error.message.includes('not configured')) {
      throw error; // Re-throw configuration errors as-is
    }
    
    // Extract error message from Cloudinary response
    const errorMsg = error.message || error.error?.message || 'Unknown error';
    throw new Error(`Cloudinary upload failed: ${errorMsg}`);
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

/**
 * Get a signed delivery URL for Cloudinary assets
 * @param {String} publicId - Public ID of the asset
 * @param {Object} options - Cloudinary delivery options
 * @returns {String} Signed URL
 */
const getSignedUrl = (publicId, options = {}) => {
  return cloudinary.url(publicId, {
    secure: true,
    sign_url: true,
    ...options,
  });
};

/**
 * Get a signed download URL for Cloudinary assets
 * @param {String} publicId - Public ID of the asset
 * @param {String} format - File format (e.g., pdf)
 * @param {Object} options - Cloudinary delivery options
 * @returns {String} Signed download URL
 */
const getSignedDownloadUrl = (publicId, format, options = {}) => {
  return cloudinary.utils.private_download_url(publicId, format, options);
};

module.exports = {
  uploadImage,
  uploadAudio,
  uploadFile,
  uploadVideo,
  uploadToCloudinary,
  deleteFromCloudinary,
  getSignedUrl,
  getSignedDownloadUrl,
};
