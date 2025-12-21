const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Service = require('../models/Service');
const generateToken = require('../utils/jwtToken');
const { protect } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../middleware/cloudinaryUpload');
const crypto = require('crypto');
const { sendEmail, sendCredentialsEmail } = require('../utils/sendEmail');
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
    // Log incoming request data for debugging
    console.log('Registration request body:', req.body);
    console.log('Registration request files:', req.files);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map(e => e.msg);
      console.log('Validation errors:', errorMessages);
      console.log('Full validation errors:', errors.array());
      return res.status(400).json({ 
        message: errorMessages.join('. '),
        errors: errors.array() 
      });
    }

    const { name, email, phone, country } = req.body;
    console.log('Registration attempt:', { name, email, phone, country });
    
    // Validate that all required fields are present (double check)
    if (!name || !email || !phone || !country) {
      console.log('Missing fields detected:', { 
        hasName: !!name, 
        hasEmail: !!email, 
        hasPhone: !!phone, 
        hasCountry: !!country 
      });
      return res.status(400).json({ 
        message: 'All fields are required: name, email, phone, and country' 
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log('User already exists:', email);
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
    console.log('Generating password...');
    const password = generatePassword();
    if (!password || password.length < 6) {
      console.error('Password generation failed or password too short');
      return res.status(500).json({ 
        message: 'Failed to generate password. Please try again.' 
      });
    }
    console.log('Password generated successfully');

    // Create user
    console.log('Creating user in database...');
    let user;
    try {
      user = await User.create({
        name,
        email,
        phone,
        country,
        password,
        role: 'customer',
        avatar: avatarUrl
      });
      console.log('User created successfully:', user._id);
    } catch (dbError) {
      console.error('Database error during user creation:', dbError);
      console.error('Database error details:', {
        name: dbError.name,
        message: dbError.message,
        code: dbError.code,
        keyPattern: dbError.keyPattern,
        keyValue: dbError.keyValue,
        errors: dbError.errors
      });
      // If it's a duplicate key error, provide a clearer message
      if (dbError.code === 11000) {
        return res.status(400).json({ 
          message: 'User already exists with this email',
          error: 'Duplicate email'
        });
      }
      throw dbError; // Re-throw to be caught by outer catch
    }

    // Send credentials email (non-blocking - don't fail registration if email fails)
    // Fire and forget - don't await to avoid blocking registration
    sendCredentialsEmail(email, password, 'customer', name)
      .then(() => {
        console.log(`✅ Welcome email sent successfully to ${email}`);
      })
      .catch((emailError) => {
        console.error(`❌ Failed to send welcome email to ${email}:`, emailError.message);
        // Don't fail registration if email fails, just log it
        // User is already created, so we continue
      });

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
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      keyPattern: error.keyPattern,
      keyValue: error.keyValue
    });
    
    // Provide more specific error messages
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation error', 
        errors: Object.values(error.errors).map(e => e.message)
      });
    }
    
    if (error.code === 11000) {
      return res.status(400).json({ 
        message: 'User already exists with this email',
        error: 'Duplicate email'
      });
    }
    
    res.status(500).json({ 
      message: 'Server error during registration', 
      error: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred. Please try again.'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user with role-based portal restriction
// @access  Public
router.post('/login', [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required'),
  body('expectedRole').optional().isIn(['customer', 'agent', 'admin']).withMessage('Invalid expected role')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, expectedRole } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // STRICT ROLE-BASED LOGIN RESTRICTION
    // If expectedRole is provided, user's role MUST match
    if (expectedRole && user.role !== expectedRole) {
      return res.status(403).json({ 
        message: `Access denied. ${user.role === 'customer' ? 'Customer' : user.role === 'agent' ? 'Agent' : 'Admin'} accounts can only login through the ${user.role} portal.` 
      });
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
// @desc    Send password reset OTP code via email
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

    // Generate 6-digit OTP code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP (hashed for security) and expiration (5 minutes)
    user.resetPasswordOTP = crypto.createHash('sha256').update(otpCode).digest('hex');
    user.resetPasswordOTPExpire = Date.now() + 5 * 60 * 1000; // 5 minutes
    await user.save({ validateBeforeSave: false });

    // Send OTP email
    try {
      console.log(`📧 Sending password reset OTP to ${email} (${role})...`);
      const { sendPasswordResetOTPEmail } = require('../utils/sendEmail');
      await sendPasswordResetOTPEmail(email, user.name, otpCode, role);
      console.log(`✅ Password reset OTP sent successfully to ${email}`);
    } catch (emailError) {
      console.error(`❌ Password reset OTP email failure for ${email} (${role}):`, emailError.message);
      if (process.env.NODE_ENV === 'development') {
        console.error('Full error:', emailError);
      }
      user.resetPasswordOTP = undefined;
      user.resetPasswordOTPExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ 
        success: false,
        message: 'Email could not be sent. Please check your email configuration and try again later.',
        error: process.env.NODE_ENV === 'development' ? emailError.message : undefined
      });
    }

    res.json({
      success: true,
      message: 'Password reset code sent to your email. Please check your inbox.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/auth/verify-reset-otp
// @desc    Verify OTP code and allow password reset
// @access  Public
router.post('/verify-reset-otp', [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('role').isIn(['customer', 'agent', 'admin']).withMessage('Invalid user role'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, role, otp } = req.body;

    const user = await User.findOne({ email, role });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Hash OTP to compare with stored hash
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');

    // Verify OTP
    if (user.resetPasswordOTP !== hashedOTP) {
      return res.status(400).json({ message: 'Invalid OTP code' });
    }

    // Check if OTP expired
    if (!user.resetPasswordOTPExpire || user.resetPasswordOTPExpire < Date.now()) {
      user.resetPasswordOTP = undefined;
      user.resetPasswordOTPExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({ message: 'OTP code has expired. Please request a new one.' });
    }

    // OTP is valid - generate a temporary session token for password reset
    const resetSessionToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetSessionToken).digest('hex');
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes to reset password
    // Clear OTP after successful verification
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpire = undefined;
    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: 'OTP verified successfully',
      resetToken: resetSessionToken // Send token to frontend for password reset
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password with verified session token
// @access  Public
router.post('/reset-password', [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('role').isIn(['customer', 'agent', 'admin']).withMessage('Invalid user role'),
  body('resetToken').notEmpty().withMessage('Reset token is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, role, resetToken, password } = req.body;

    // Hash token to compare with stored hash
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    const user = await User.findOne({
      email,
      role,
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset session. Please verify OTP again.' });
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
  passport.use('google', new GoogleStrategy({
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
  console.log('✅ Google OAuth strategy configured');
} else {
  console.log('⚠️  Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)');
}

// Configure Microsoft OAuth Strategy
if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  passport.use('microsoft', new MicrosoftStrategy({
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
  console.log('✅ Microsoft OAuth strategy configured');
} else {
  console.log('⚠️  Microsoft OAuth not configured (missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET)');
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

// Helper function to check if a strategy is configured
const isStrategyConfigured = (strategyName) => {
  return passport._strategies && passport._strategies[strategyName];
};

// Test route to verify OAuth routes are accessible
router.get('/oauth-status', (req, res) => {
  res.json({
    google: {
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      strategyRegistered: isStrategyConfigured('google'),
      callbackURL: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`
    },
    microsoft: {
      configured: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
      strategyRegistered: isStrategyConfigured('microsoft'),
      callbackURL: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/microsoft/callback`
    }
  });
});

// @route   GET /api/auth/google
// @desc    Initiate Google OAuth
// @access  Public
router.get('/google', (req, res, next) => {
  // Check if Google OAuth is configured
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ 
      message: 'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in environment variables.',
      error: 'oauth_not_configured'
    });
  }
  
  // Check if strategy is registered
  if (!isStrategyConfigured('google')) {
    return res.status(503).json({ 
      message: 'Google OAuth strategy is not initialized. Please check server configuration.',
      error: 'oauth_strategy_not_initialized'
    });
  }
  
  // Proceed with authentication
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// @route   GET /api/auth/google/callback
// @desc    Handle Google OAuth callback
// @access  Public
router.get('/google/callback',
  (req, res, next) => {
    // Check if Google OAuth is configured
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?error=oauth_not_configured`);
    }
    
    // Check if strategy is registered
    if (!isStrategyConfigured('google')) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?error=oauth_strategy_not_initialized`);
    }
    
    // Proceed with authentication
    passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?error=oauth_failed` })(req, res, next);
  },
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
router.get('/microsoft', (req, res, next) => {
  // Check if Microsoft OAuth is configured
  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
    return res.status(503).json({ 
      message: 'Microsoft OAuth is not configured. Please set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in environment variables.',
      error: 'oauth_not_configured'
    });
  }
  
  // Check if strategy is registered
  if (!isStrategyConfigured('microsoft')) {
    return res.status(503).json({ 
      message: 'Microsoft OAuth strategy is not initialized. Please check server configuration.',
      error: 'oauth_strategy_not_initialized'
    });
  }
  
  // Proceed with authentication
  passport.authenticate('microsoft', { scope: ['user.read'] })(req, res, next);
});

// @route   GET /api/auth/microsoft/callback
// @desc    Handle Microsoft OAuth callback
// @access  Public
router.get('/microsoft/callback',
  (req, res, next) => {
    // Check if Microsoft OAuth is configured
    if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?error=oauth_not_configured`);
    }
    
    // Check if strategy is registered
    if (!isStrategyConfigured('microsoft')) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?error=oauth_strategy_not_initialized`);
    }
    
    // Proceed with authentication
    passport.authenticate('microsoft', { session: false, failureRedirect: `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/login?error=oauth_failed` })(req, res, next);
  },
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

// Catch-all route for OAuth to provide helpful error messages
router.get('/:provider', (req, res) => {
  const { provider } = req.params;
  
  if (provider === 'google' || provider === 'microsoft') {
    return res.status(404).json({
      message: `Cannot GET /api/auth/${provider}`,
      error: 'route_not_found',
      hint: `Make sure you're accessing the correct URL: /api/auth/${provider}`,
      availableRoutes: [
        'GET /api/auth/google',
        'GET /api/auth/google/callback',
        'GET /api/auth/microsoft',
        'GET /api/auth/microsoft/callback',
        'GET /api/auth/oauth-status'
      ]
    });
  }
  
  res.status(404).json({
    message: `Route not found: /api/auth/${provider}`,
    error: 'route_not_found'
  });
});

module.exports = router;

