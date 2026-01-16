const mongoose = require('mongoose');
const crypto = require('crypto');

// TODO: Set ENCRYPTION_KEY in .env (32-byte hex string)
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const ENCRYPTION_KEY = process.env.LINKEDIN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';

const encrypt = (text) => {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
};

const decrypt = (encryptedData) => {
  if (!encryptedData || !encryptedData.encrypted) return null;
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const authTag = Buffer.from(encryptedData.authTag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

const linkedInAccountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  linkedInEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  linkedInName: {
    type: String,
    default: ''
  },
  // Encrypted cookies
  cookies: {
    li_at: {
      encrypted: String,
      iv: String,
      authTag: String
    },
    JSESSIONID: {
      encrypted: String,
      iv: String,
      authTag: String
    }
  },
  // Proxy configuration
  proxy: {
    host: String,
    port: Number,
    username: String,
    password: String,
    type: {
      type: String,
      enum: ['http', 'socks5'],
      default: 'http'
    }
  },
  // Status
  status: {
    type: String,
    enum: ['active', 'paused', 'error', 'warning', 'banned'],
    default: 'active'
  },
  // Safety settings
  safety: {
    dailyMessageLimit: {
      type: Number,
      default: 20,
      min: 1,
      max: 50
    },
    dailyConnectionLimit: {
      type: Number,
      default: 25,
      min: 1,
      max: 60
    },
    workingHours: {
      enabled: { type: Boolean, default: false },
      start: { type: String, default: '09:00' }, // HH:mm format
      end: { type: String, default: '17:00' }
    },
    warmupMode: {
      type: Boolean,
      default: true
    },
    warmupDay: {
      type: Number,
      default: 1,
      min: 1,
      max: 30
    }
  },
  // Statistics
  stats: {
    messagesSentToday: { type: Number, default: 0 },
    connectionsSentToday: { type: Number, default: 0 },
    lastMessageSentAt: Date,
    lastConnectionSentAt: Date,
    lastSyncAt: Date
  },
  // Browser session info
  browserSessionId: {
    type: String,
    default: null
  },
  // Consent
  consentGiven: {
    type: Boolean,
    default: false
  },
  consentGivenAt: Date,
  // Error tracking
  lastError: {
    message: String,
    timestamp: Date,
    type: {
      type: String,
      enum: ['captcha', 'warning', 'rate_limit', 'banned', 'other']
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Virtual to get decrypted cookies
linkedInAccountSchema.virtual('decryptedCookies').get(function() {
  if (!this.cookies) return null;
  return {
    li_at: decrypt(this.cookies.li_at),
    JSESSIONID: decrypt(this.cookies.JSESSIONID)
  };
});

// Method to set encrypted cookies
linkedInAccountSchema.methods.setCookies = function(li_at, JSESSIONID) {
  this.cookies = {
    li_at: encrypt(li_at),
    JSESSIONID: encrypt(JSESSIONID)
  };
};

// Method to get decrypted cookies
linkedInAccountSchema.methods.getCookies = function() {
  return {
    li_at: decrypt(this.cookies?.li_at),
    JSESSIONID: decrypt(this.cookies?.JSESSIONID)
  };
};

// Reset daily stats
linkedInAccountSchema.methods.resetDailyStats = function() {
  this.stats.messagesSentToday = 0;
  this.stats.connectionsSentToday = 0;
};

// Check if daily limit reached
linkedInAccountSchema.methods.canSendMessage = function() {
  return this.stats.messagesSentToday < this.safety.dailyMessageLimit;
};

linkedInAccountSchema.methods.canSendConnection = function() {
  return this.stats.connectionsSentToday < this.safety.dailyConnectionLimit;
};

// Check if within working hours
linkedInAccountSchema.methods.isWithinWorkingHours = function() {
  if (!this.safety.workingHours.enabled) return true;
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return currentTime >= this.safety.workingHours.start && currentTime <= this.safety.workingHours.end;
};

linkedInAccountSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes
linkedInAccountSchema.index({ user: 1, status: 1 });
linkedInAccountSchema.index({ 'stats.lastSyncAt': 1 });

module.exports = mongoose.model('LinkedInAccount', linkedInAccountSchema);

