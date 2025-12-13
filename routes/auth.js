const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Service = require('../models/Service');
const generateToken = require('../utils/jwtToken');
const { protect } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../middleware/cloudinaryUpload');
const crypto = require('crypto');
const { sendEmail } = require('../utils/sendEmail');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const generatePassword = require('../utils/generatePassword');

// @route   POST /api/auth/register
// @desc    Register a new customer
// @access  Public
router.post('/register', upload.fields([{ name: 'avatar', maxCount: 1 }]), uploadToCloudinary, [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('country').trim().notEmpty().withMessage('Country is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, phone, country } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Get avatar URL if uploaded
    let avatarUrl = null;
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const avatarFile = req.uploadedFiles.find(f => f.type === 'avatar');
      if (avatarFile) {
        avatarUrl = avatarFile.url;
      }
    }

    // Generate password
    const generatePassword = require('../utils/generatePassword');
    const password = generatePassword();

    // Create user
    const user = await User.create({
      name,
      email,
      phone,
      country,
      password,
      role: 'customer',
      avatar: avatarUrl
    });

    // Send credentials email
    const { sendCredentialsEmail } = require('../utils/sendEmail');
    await sendCredentialsEmail(email, password, 'customer', name);

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        tokenBalance: user.tokenBalance,
        avatar: user.avatar
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    // Update online status for agents
    if (user.role === 'agent') {
      user.isOnline = true;
      await user.save();
    }

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        tokenBalance: user.tokenBalance,
        serviceCategory: user.serviceCategory,
        isOnline: user.isOnline
      }
    });
    console.log("login successfull");
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('serviceCategory', 'name')
      .populate('currentPlan', 'name price tokens');

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update current user's profile
// @access  Private
router.put(
  '/profile',
  protect,
  upload.fields([{ name: 'avatar', maxCount: 1 }]),
  uploadToCloudinary,
  [
    body('name').optional().trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('phone').optional().trim().notEmpty().withMessage('Phone is required'),
    body('country').optional().trim().notEmpty().withMessage('Country is required'),
    body('serviceCategory').optional().isMongoId().withMessage('Invalid service'),
    body('isAvailable').optional().isBoolean().withMessage('isAvailable must be boolean'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const updates = {};
      const allowedFields = ['name', 'phone', 'country'];

      allowedFields.forEach((field) => {
        if (typeof req.body[field] !== 'undefined') {
          updates[field] = req.body[field];
        }
      });

      if (req.user.role === 'agent') {
        if (typeof req.body.isAvailable !== 'undefined') {
          updates.isAvailable = req.body.isAvailable === 'true' || req.body.isAvailable === true;
        }
        if (req.body.serviceCategory && req.body.serviceCategory !== 'null' && req.body.serviceCategory !== 'undefined') {
          const serviceExists = await Service.findById(req.body.serviceCategory).select('_id');
          if (!serviceExists) {
            return res.status(404).json({ message: 'Service not found' });
          }
          updates.serviceCategory = req.body.serviceCategory;
        }
      }

      if (req.uploadedFiles && req.uploadedFiles.length > 0) {
        const avatarFile = req.uploadedFiles.find((file) => file.type === 'avatar');
        if (avatarFile) {
          updates.avatar = avatarFile.url;
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: 'No valid fields provided for update' });
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        { $set: updates },
        { new: true, runValidators: true }
      )
        .select('-password')
        .populate('serviceCategory', 'name')
        .populate('currentPlan', 'name price tokens');

      res.json({
        success: true,
        user: updatedUser,
        message: 'Profile updated successfully',
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

// @route   GET /api/auth/services
// @desc    Get active services list (for profile dropdowns)
// @access  Private
router.get('/services', protect, async (req, res) => {
  try {
    const services = await Service.find({ isActive: true }).select('name _id');
    res.json({ success: true, services });
  } catch (error) {
    console.error('Get services error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('role').isIn(['customer', 'agent', 'admin']).withMessage('Invalid user role')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, role } = req.body;

    const user = await User.findOne({ email, role });
    if (!user) {
      // Don't reveal if user exists for security
      return res.status(404).json({
        success: false,
        message: 'No account found for the provided email and role.'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save({ validateBeforeSave: false });

    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/reset-password/${resetToken}`;

    // Send email using the new email service
    try {
      const { sendPasswordResetEmail } = require('../utils/sendEmail');
      await sendPasswordResetEmail(email, user.name, resetUrl);
    } catch (emailError) {
      console.error(`Password reset email failure for ${email} (${role}):`, emailError.message);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ message: 'Email could not be sent. Please try again later.' });
    }

    res.json({
      success: true,
      message: 'Password reset email sent successfully'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/auth/reset-password/:token
// @desc    Reset password with token
// @access  Public
router.post('/reset-password/:token', [
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token } = req.params;
    const { password } = req.body;

    // Hash token to compare with stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Set new password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ============================================================================
// OAUTH CONFIGURATION
// ============================================================================

// Configure Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ 
        $or: [
          { email: profile.emails[0].value },
          { oauthId: profile.id, oauthProvider: 'google' }
        ]
      });

      if (user) {
        // Update OAuth info if not set
        if (!user.oauthProvider) {
          user.oauthProvider = 'google';
          user.oauthId = profile.id;
          if (profile.photos && profile.photos[0]) {
            user.avatar = profile.photos[0].value;
          }
          await user.save();
        }
        return done(null, user);
      } else {
        // Create new user
        const password = generatePassword();
        user = new User({
          name: profile.displayName || profile.name?.givenName || 'User',
          email: profile.emails[0].value,
          phone: 'N/A',
          country: 'N/A',
          password: password,
          role: 'customer',
          oauthProvider: 'google',
          oauthId: profile.id,
          avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : null
        });
        await user.save();
        return done(null, user);
      }
    } catch (error) {
      return done(error, null);
    }
  }));
}

// Configure Microsoft OAuth Strategy
if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  passport.use(new MicrosoftStrategy({
    clientID: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    callbackURL: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/microsoft/callback`,
    scope: ['user.read']
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ 
        $or: [
          { email: profile.emails[0].value },
          { oauthId: profile.id, oauthProvider: 'microsoft' }
        ]
      });

      if (user) {
        if (!user.oauthProvider) {
          user.oauthProvider = 'microsoft';
          user.oauthId = profile.id;
          await user.save();
        }
        return done(null, user);
      } else {
        const password = generatePassword();
        user = new User({
          name: profile.displayName || profile.name?.givenName || 'User',
          email: profile.emails[0].value,
          phone: 'N/A',
          country: 'N/A',
          password: password,
          role: 'customer',
          oauthProvider: 'microsoft',
          oauthId: profile.id
        });
        await user.save();
        return done(null, user);
      }
    } catch (error) {
      return done(error, null);
    }
  }));
}

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// ============================================================================
// OAUTH ROUTES
// ============================================================================

// @route   GET /api/auth/google
// @desc    Initiate Google OAuth
// @access  Public
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// @route   GET /api/auth/google/callback
// @desc    Handle Google OAuth callback
// @access  Public
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?error=oauth_failed` }),
  async (req, res) => {
    try {
      const user = req.user;
      const token = generateToken(user._id);

      // Update online status for agents
      if (user.role === 'agent') {
        user.isOnline = true;
        await user.save();
      }

      // Redirect to frontend with token
      const redirectUrl = `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?token=${token}&oauth=google`;
      res.redirect(redirectUrl);
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?error=oauth_failed`);
    }
  }
);

// @route   GET /api/auth/microsoft
// @desc    Initiate Microsoft OAuth
// @access  Public
router.get('/microsoft', passport.authenticate('microsoft', { scope: ['user.read'] }));

// @route   GET /api/auth/microsoft/callback
// @desc    Handle Microsoft OAuth callback
// @access  Public
router.get('/microsoft/callback',
  passport.authenticate('microsoft', { session: false, failureRedirect: `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?error=oauth_failed` }),
  async (req, res) => {
    try {
      const user = req.user;
      const token = generateToken(user._id);

      if (user.role === 'agent') {
        user.isOnline = true;
        await user.save();
      }

      const redirectUrl = `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?token=${token}&oauth=microsoft`;
      res.redirect(redirectUrl);
    } catch (error) {
      console.error('Microsoft OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?error=oauth_failed`);
    }
  }
);

// @route   GET /api/auth/apple
// @desc    Initiate Apple OAuth (Note: Apple requires additional setup)
// @access  Public
router.get('/apple', (req, res) => {
  // Apple OAuth requires more complex setup with JWT signing
  // For now, return a message that it's not yet implemented
  res.status(501).json({ 
    message: 'Apple OAuth is not yet fully implemented. Please use Google or Microsoft for now.',
    error: 'not_implemented'
  });
});

// @route   GET /api/auth/apple/callback
// @desc    Handle Apple OAuth callback
// @access  Public
router.get('/apple/callback', (req, res) => {
  res.status(501).json({ 
    message: 'Apple OAuth is not yet fully implemented.',
    error: 'not_implemented'
  });
});

module.exports = router;

