const mongoose = require('mongoose');
const crypto = require('crypto');

const LinkedInAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Connection method
  connectionMethod: {
    type: String,
    enum: ['cookies', 'extension', 'browser_session'],
    default: 'browser_session'
  },
  // Extension ID (for extension-based connection)
  extensionId: String,
  // Encrypted cookies (only for cookie-based connection)
  encryptedLiAt: {
    type: String,
    required: function() { return this.connectionMethod === 'cookies'; }
  },
  encryptedJSESSIONID: {
    type: String,
    required: function() { return this.connectionMethod === 'cookies'; }
  },
  // Proxy settings (optional)
  proxy: {
    host: String,
    port: Number,
    username: String,
    password: String,
    type: { type: String, enum: ['http', 'socks5'], default: 'http' }
  },
  // Safety settings
  settings: {
    dailyMessageLimit: { type: Number, default: 20 },
    dailyConnectionLimit: { type: Number, default: 30 },
    workingHoursStart: { type: String, default: '09:00' },
    workingHoursEnd: { type: String, default: '17:00' },
    workingDays: { type: [String], default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
    minDelaySeconds: { type: Number, default: 120 }, // 2 minutes
    maxDelaySeconds: { type: Number, default: 300 }, // 5 minutes
    warmUpMode: { type: Boolean, default: true },
    warmUpDays: { type: Number, default: 3 },
    autoPauseOnCaptcha: { type: Boolean, default: true },
    autoPauseOnWarning: { type: Boolean, default: true }
  },
  // Status
  status: {
    type: String,
    enum: ['active', 'paused', 'error', 'captcha_required', 'warning'],
    default: 'active'
  },
  // Browser session info
  browserSessionId: String,
  lastSyncAt: Date,
  lastActivityAt: Date,
  // Stats
  stats: {
    totalMessagesSent: { type: Number, default: 0 },
    totalConnectionsSent: { type: Number, default: 0 },
    messagesToday: { type: Number, default: 0 },
    connectionsToday: { type: Number, default: 0 },
    lastResetDate: Date
  },
  // Metadata
  linkedInProfileUrl: String,
  linkedInName: String,
  linkedInEmail: String,
  connectedAt: Date,
  consentAccepted: { type: Boolean, default: false },
  consentAcceptedAt: Date
}, {
  timestamps: true
});

// Encryption/Decryption helpers
const ENCRYPTION_KEY = process.env.LINKEDIN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  if (!text) return null;
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

function decrypt(encryptedData) {
  if (!encryptedData || !encryptedData.encrypted) return null;
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const authTag = Buffer.from(encryptedData.authTag, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Instance methods
LinkedInAccountSchema.methods.getCookies = function() {
  if (this.connectionMethod === 'extension') {
    return null; // Extension handles auth, no cookies stored
  }
  return {
    li_at: decrypt(this.encryptedLiAt),
    JSESSIONID: decrypt(this.encryptedJSESSIONID)
  };
};

LinkedInAccountSchema.methods.setCookies = function(liAt, jSessionId) {
  if (liAt && jSessionId) {
    this.encryptedLiAt = encrypt(liAt);
    this.encryptedJSESSIONID = encrypt(jSessionId);
    this.connectionMethod = 'cookies';
  }
};

LinkedInAccountSchema.methods.resetDailyStats = function() {
  const today = new Date().toDateString();
  if (this.stats.lastResetDate?.toDateString() !== today) {
    this.stats.messagesToday = 0;
    this.stats.connectionsToday = 0;
    this.stats.lastResetDate = new Date();
  }
};

LinkedInAccountSchema.methods.canSendMessage = function() {
  this.resetDailyStats();
  return this.status === 'active' && 
         this.stats.messagesToday < this.settings.dailyMessageLimit;
};

LinkedInAccountSchema.methods.canSendConnection = function() {
  this.resetDailyStats();
  if (this.settings.warmUpMode) {
    const daysSinceConnect = Math.floor((Date.now() - this.connectedAt) / (1000 * 60 * 60 * 24));
    if (daysSinceConnect < this.settings.warmUpDays) {
      const warmUpLimit = Math.min(15 + (daysSinceConnect * 5), 25);
      return this.stats.connectionsToday < warmUpLimit;
    }
  }
  return this.status === 'active' && 
         this.stats.connectionsToday < this.settings.dailyConnectionLimit;
};

module.exports = mongoose.model('LinkedInAccount', LinkedInAccountSchema);

