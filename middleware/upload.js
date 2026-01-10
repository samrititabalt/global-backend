const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let uploadPath = 'uploads/';
    
    if (file.fieldname === 'image') {
      uploadPath += 'images/';
    } else if (file.fieldname === 'file') {
      uploadPath += 'files/';
    } else if (file.fieldname === 'audio') {
      uploadPath += 'audio/';
    } else if (file.fieldname === 'video') {
      uploadPath += 'videos/';
    }
    
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // For homepage video, use fixed filename
    if (file.fieldname === 'video' && req.body?.videoType === 'homepage') {
      cb(null, 'homepage-video.mp4');
    } else {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  }
});

const fileFilter = (req, file, cb) => {
  // Accept images
  if (file.fieldname === 'image') {
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
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
  // Accept video files (mp4, mov, webm)
  else if (file.fieldname === 'video') {
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(mp4|mov|webm|avi)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files (mp4, mov, webm) are allowed'), false);
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

// Special upload for homepage video with higher size limit (200MB)
// Uses diskStorage which streams files to disk, not loading entirely into memory
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadPath = 'uploads/videos/';
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
      // Always save as homepage-video.mp4 for consistent path
      // Note: Users should ideally upload MP4 files for best compatibility
      // Non-MP4 files will be saved with .mp4 extension (may require conversion for proper playback)
      cb(null, 'homepage-video.mp4');
    }
  }),
  limits: {
    fileSize: parseInt(process.env.MAX_VIDEO_SIZE) || 200 * 1024 * 1024, // 200MB default for videos
    fieldSize: 200 * 1024 * 1024, // 200MB for form fields
    fieldNameSize: 200, // Max field name size
    fields: 10, // Max number of non-file fields
    files: 1 // Max number of file fields
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(mp4|mov|webm|avi)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files (mp4, mov, webm) are allowed'), false);
    }
  }
});

module.exports = upload;
module.exports.videoUpload = videoUpload;

