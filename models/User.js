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
  // Plain text password for admin viewing (only for agents, stored securely but not hashed)
  plainPassword: {
    type: String,
    default: null,
    select: false // Don't include in queries by default
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
  customerId: {
    type: String,
    unique: true,
    sparse: true, // Only unique when present
    default: null
  },
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
  // Agent specific fields - support multiple service categories
  serviceCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    default: null
  },
  // New field for multiple service categories (agents can have multiple)
  serviceCategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  }],
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
  // Resume Builder usage tracking
  resumeBuilderUsageRemaining: {
    type: Number,
    default: 100
  },
  // Agent-only: global access to all Sam Studios Pro solutions
  pro_access_enabled: {
    type: Boolean,
    default: false
  },
  pro_access_granted_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  pro_access_granted_at: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.pre('save', async function(next) {
  // CRITICAL: Ensure agents and admins NEVER have a customerId
  // This prevents duplicate key errors on customerId field
  // For sparse unique indexes, we need to completely unset the field, not set to null
  if (this.role !== 'customer') {
    // Use Mongoose's set with undefined to properly unset the field
    // This ensures the field is not included in the document at all
    this.set('customerId', undefined, { strict: false });
    
    // Also use $unset for MongoDB operations
    if (!this.$unset) {
      this.$unset = {};
    }
    this.$unset.customerId = '';
    
    // Log if customerId was present (shouldn't happen, but helps debug)
    const existingCustomerId = this.get('customerId');
    if (existingCustomerId) {
      console.warn(`⚠️ Warning: Non-customer ${this._id} (role: ${this.role}) had customerId: ${existingCustomerId}. Unsetting it.`);
    }
  }
  
  // Generate customer ID for new customers only
  if (this.role === 'customer' && !this.customerId && this.isNew) {
    // Generate customer ID: CUST + timestamp + random 4 digits
    // Collision probability is extremely low (1 in 10,000 per millisecond)
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    this.customerId = `CUST${timestamp}${random}`;
    
    // If collision occurs, MongoDB will throw duplicate key error (code 11000)
    // which will be handled by the route error handler
  }
  
  // For agents: migrate single serviceCategory to serviceCategories array if needed
  if (this.role === 'agent' && this.serviceCategory && (!this.serviceCategories || this.serviceCategories.length === 0)) {
    this.serviceCategories = [this.serviceCategory];
  }
  
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

