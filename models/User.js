const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: true
  },
  country: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: false // We'll handle validation in routes for OAuth users
  },
  oauthProvider: {
    type: String,
    default: null,
    required: false,
    validate: {
      validator: function(value) {
        // Allow null/undefined or valid enum values
        if (value === null || value === undefined || value === '') {
          return true; // Allow null/undefined/empty for regular signups
        }
        return ['google', 'microsoft'].includes(value);
      },
      message: 'Invalid OAuth provider. Must be one of: google, microsoft'
    }
  },
  oauthId: {
    type: String,
    default: null,
    required: false
  },
  role: {
    type: String,
    enum: ['customer', 'agent', 'admin'],
    required: true
  },
  // Customer specific fields
  tokenBalance: {
    type: Number,
    default: 0
  },
  planStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'expired'],
    default: 'none'
  },
  currentPlan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plan'
  },
  // Agent specific fields
  serviceCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  activeChats: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatSession'
  }],
  // Agent minutes tracking (total minutes worked/earned)
  totalMinutesEarned: {
    type: Number,
    default: 0
  },
  // Agent current minutes balance (can be adjusted by admin)
  agentMinutes: {
    type: Number,
    default: 0
  },
  // Common fields
  avatar: {
    type: String, // Cloudinary URL
    default: null
  },
  resetPasswordOTP: {
    type: String,
    default: null
  },
  resetPasswordOTPExpire: {
    type: Date,
    default: null
  },
  // Keep old fields for backward compatibility (can be removed later)
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpire: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.pre('save', async function(next) {
  // Skip password hashing if user is OAuth-only and password is not set
  if (!this.isModified('password') || (this.oauthProvider && !this.password)) {
    return next();
  }
  
  // Only hash password if it exists
  if (this.password) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

