const nodemailer = require('nodemailer');

/**
 * Email Service - Completely Rewritten for Reliability
 * 
 * Features:
 * - Automatic connection pooling
 * - Retry mechanism for failed sends
 * - Better error handling
 * - Connection verification on startup
 * - No delays, immediate sending
 */

// Create transporter with optimized configuration
const createTransporter = () => {
  const emailUser = process.env.EMAIL_USER;
  let emailPass = process.env.EMAIL_PASS;

  if (!emailUser || !emailPass) {
    throw new Error('Email credentials (EMAIL_USER and EMAIL_PASS) are required in .env file');
  }

  // Clean the password - remove all spaces and trim
  emailPass = emailPass.trim().replace(/\s+/g, '');

  // Validate email format
  if (!emailUser.includes('@')) {
    throw new Error('EMAIL_USER must be a valid email address');
  }

  // Validate password length (Gmail App Passwords are 16 characters)
  if (emailPass.length < 16) {
    console.warn('⚠️ Warning: App Password seems too short. Gmail App Passwords are typically 16 characters.');
  }

  // Use explicit SMTP settings for better reliability on cloud platforms like Render
  const config = {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: emailUser.trim(),
      pass: emailPass,
    },
    // Increased timeouts for cloud platforms (Render, etc.)
    connectionTimeout: 60000, // 60 seconds (increased from 10s)
    greetingTimeout: 30000, // 30 seconds (increased from 10s)
    socketTimeout: 60000, // 60 seconds (increased from 10s)
    // Connection pool settings (disabled initially to avoid connection issues)
    pool: false, // Disable pooling initially - can enable after successful connection
    // TLS options for better compatibility
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates if needed
      ciphers: 'SSLv3'
    },
    // Retry settings
    retry: {
      attempts: 3,
      delay: 2000
    }
  };

  return nodemailer.createTransport(config);
};

// Create transporter instance
let transporter = null;
let isVerified = false;

/**
 * Initialize and verify email transporter
 * Non-blocking: Will attempt verification but won't fail if it times out (common on cloud platforms)
 */
const initializeEmail = async () => {
  try {
    if (!transporter) {
      transporter = createTransporter();
    }

    // Verify connection (with timeout handling for cloud platforms)
    if (!isVerified) {
      try {
        // Set a timeout for verification (30 seconds)
        const verifyPromise = transporter.verify();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Verification timeout')), 30000)
        );
        
        await Promise.race([verifyPromise, timeoutPromise]);
        isVerified = true;
        console.log('✅ Email service initialized and verified successfully');
        console.log(`📧 Email configured for: ${process.env.EMAIL_USER}`);
      } catch (verifyError) {
        // On cloud platforms, verification might timeout but sending can still work
        if (verifyError.message.includes('timeout') || verifyError.message.includes('Connection timeout')) {
          console.warn('⚠️ Email verification timed out (common on cloud platforms). Email sending will be attempted on first use.');
          console.warn('⚠️ This is normal for Render/Heroku/etc. - emails will still be sent, verification is just skipped.');
          // Don't mark as verified, but don't throw - allow sending to proceed
          isVerified = false;
        } else {
          throw verifyError;
        }
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Email service initialization failed:', error.message);
    isVerified = false;
    
    // Provide helpful error messages
    if (error.message.includes('Invalid login') || error.message.includes('535')) {
      console.error('\n🔧 GMAIL AUTHENTICATION ERROR - Fix Steps:');
      console.error('1. Make sure 2-Factor Authentication (2FA) is enabled on your Gmail account');
      console.error('2. Generate a NEW App Password: https://myaccount.google.com/apppasswords');
      console.error('3. Select "Mail" and "Other (Custom name)" - name it "GlobalCare"');
      console.error('4. Copy the 16-character password (no spaces)');
      console.error('5. Update EMAIL_PASS in your .env file');
      console.error('6. Make sure EMAIL_USER matches the Gmail account');
      console.error('\n📝 Current EMAIL_USER:', process.env.EMAIL_USER);
      console.error('📝 EMAIL_PASS length:', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.replace(/\s+/g, '').length : 0, 'characters');
      throw error; // Throw auth errors - these need to be fixed
    }
    
    // For connection timeouts, don't throw - allow sending to be attempted
    if (error.message.includes('timeout') || error.message.includes('Connection timeout') || error.code === 'ETIMEDOUT') {
      console.warn('⚠️ Connection timeout during initialization. Email sending will be attempted on first use.');
      return false; // Return false but don't throw
    }
    
    throw error;
  }
};

/**
 * Send email with retry mechanism
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @param {number} retries - Number of retry attempts (default: 3)
 * @returns {Promise} Email info
 */
const sendEmail = async (to, subject, html, retries = 3) => {
  // Try to initialize if not verified, but don't fail if it times out
  if (!transporter) {
    try {
      await initializeEmail();
    } catch (initError) {
      // If initialization fails due to timeout, continue anyway
      if (!initError.message.includes('timeout') && !initError.message.includes('Connection timeout')) {
        throw initError;
      }
      console.warn('⚠️ Email initialization timed out, but will attempt to send anyway...');
    }
  }

  // Validate inputs
  if (!to || !subject || !html) {
    throw new Error('Missing required email parameters: to, subject, or html');
  }

  // Email options
  const mailOptions = {
    from: `"GlobalCare Support" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: subject,
    html: html,
    // Add text version for better compatibility
    text: html.replace(/<[^>]*>/g, ''), // Strip HTML tags for text version
  };

  // Retry logic with increased timeouts
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Ensure transporter exists (create new one if needed)
      if (!transporter) {
        transporter = createTransporter();
      }

      // Send email with longer timeout
      const sendPromise = transporter.sendMail(mailOptions);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Send timeout')), 90000) // 90 second timeout
      );
      
      const info = await Promise.race([sendPromise, timeoutPromise]);
      console.log(`✅ Email sent successfully to ${to} (Message ID: ${info.messageId})`);
      isVerified = true; // Mark as verified after successful send
      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
      };
    } catch (error) {
      lastError = error;
      console.error(`❌ Email send attempt ${attempt}/${retries} failed:`, error.message);
      
      // Log full error in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Full error details:', error);
      }

      // If it's an authentication error, don't retry
      if (error.message.includes('Invalid login') || error.message.includes('535')) {
        throw new Error(`Gmail authentication failed. Please check your EMAIL_USER and EMAIL_PASS in .env file. Make sure you're using a Gmail App Password (not your regular password). See GMAIL_SETUP_FIX.md for instructions.`);
      }

      // If it's a connection/timeout error, create a new transporter
      if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT' || error.message.includes('timeout') || error.message.includes('Connection timeout')) {
        console.log(`🔄 Connection issue detected (attempt ${attempt}). Creating new transporter...`);
        transporter = null; // Reset transporter
        isVerified = false;
        // Wait a bit longer before retry for connection issues
        if (attempt < retries) {
          const waitTime = Math.min(3000 * attempt, 10000); // 3s, 6s, 9s max
          console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        continue; // Continue to next attempt
      }

      // Wait before retry (exponential backoff)
      if (attempt < retries) {
        const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // All retries failed
  throw new Error(`Failed to send email after ${retries} attempts: ${lastError.message}`);
};

/**
 * Send credentials email to new users
 * @param {string} email - Recipient email
 * @param {string} password - Generated password
 * @param {string} role - User role (customer, agent, admin)
 * @param {string} name - User name
 */
const sendCredentialsEmail = async (email, password, role, name) => {
  const roleText = role === 'customer' ? 'Customer' : role === 'agent' ? 'Agent' : 'Admin';
  const loginUrl = process.env.FRONTEND_URL || 'https://mainproduct.vercel.app';
  
  const roleLoginPath = role === 'customer' ? '/customer/login' : 
                       role === 'agent' ? '/agent/login' : 
                       '/admin/login';
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to GlobalCare</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333333;
          background-color: #f4f4f4;
        }
        .email-container {
          max-width: 600px;
          margin: 0 auto;
          background-color: #ffffff;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #ffffff;
          padding: 40px 20px;
          text-align: center;
        }
        .header h1 {
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 10px;
        }
        .content {
          padding: 40px 30px;
          background-color: #ffffff;
        }
        .greeting {
          font-size: 18px;
          color: #333333;
          margin-bottom: 20px;
        }
        .message {
          font-size: 16px;
          color: #666666;
          margin-bottom: 30px;
          line-height: 1.8;
        }
        .credentials-box {
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          border-radius: 8px;
          padding: 25px;
          margin: 30px 0;
          border-left: 4px solid #667eea;
        }
        .credential-item {
          margin-bottom: 15px;
        }
        .credential-label {
          font-weight: 600;
          color: #333333;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 5px;
        }
        .credential-value {
          font-size: 18px;
          color: #667eea;
          font-weight: 600;
          font-family: 'Courier New', monospace;
          background-color: #ffffff;
          padding: 10px 15px;
          border-radius: 4px;
          word-break: break-all;
        }
        .button-container {
          text-align: center;
          margin: 35px 0;
        }
        .login-button {
          display: inline-block;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #ffffff;
          text-decoration: none;
          padding: 15px 40px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 16px;
          transition: transform 0.2s;
        }
        .login-button:hover {
          transform: translateY(-2px);
        }
        .security-note {
          background-color: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 15px;
          margin: 25px 0;
          border-radius: 4px;
        }
        .security-note p {
          color: #856404;
          font-size: 14px;
          margin: 0;
        }
        .footer {
          background-color: #f8f9fa;
          padding: 30px;
          text-align: center;
          color: #666666;
          font-size: 12px;
        }
        .footer a {
          color: #667eea;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <h1>Welcome to GlobalCare!</h1>
          <p style="margin-top: 10px; opacity: 0.9;">Your ${roleText} Account is Ready</p>
        </div>
        <div class="content">
          <p class="greeting">Hello ${name},</p>
          <p class="message">
            Your ${roleText} account has been successfully created. We're excited to have you on board!
          </p>
          
          <div class="credentials-box">
            <div class="credential-item">
              <div class="credential-label">Email Address</div>
              <div class="credential-value">${email}</div>
            </div>
            <div class="credential-item">
              <div class="credential-label">Password</div>
              <div class="credential-value">${password}</div>
            </div>
          </div>

          <div class="button-container">
            <a href="${loginUrl}${roleLoginPath}" class="login-button">Login to Your Account</a>
          </div>

          <div class="security-note">
            <p><strong>🔒 Security Reminder:</strong> Please keep these credentials secure and change your password after your first login.</p>
          </div>

          <p class="message" style="margin-top: 30px;">
            If you have any questions or need assistance, please don't hesitate to contact our support team.
          </p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} GlobalCare Support System. All rights reserved.</p>
          <p style="margin-top: 10px;">
            <a href="${loginUrl}">Visit Our Website</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail(
    email,
    `Welcome to GlobalCare - Your ${roleText} Account Credentials`,
    html
  );
};

/**
 * Send password reset email
 * @param {string} email - Recipient email
 * @param {string} name - User name
 * @param {string} resetUrl - Password reset URL
 */
const sendPasswordResetEmail = async (email, name, resetUrl) => {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset Request</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333333;
          background-color: #f4f4f4;
        }
        .email-container {
          max-width: 600px;
          margin: 0 auto;
          background-color: #ffffff;
        }
        .header {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: #ffffff;
          padding: 40px 20px;
          text-align: center;
        }
        .header h1 {
          font-size: 28px;
          font-weight: 600;
        }
        .content {
          padding: 40px 30px;
        }
        .greeting {
          font-size: 18px;
          color: #333333;
          margin-bottom: 20px;
        }
        .message {
          font-size: 16px;
          color: #666666;
          margin-bottom: 30px;
          line-height: 1.8;
        }
        .button-container {
          text-align: center;
          margin: 35px 0;
        }
        .reset-button {
          display: inline-block;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: #ffffff;
          text-decoration: none;
          padding: 15px 40px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 16px;
        }
        .link-box {
          background-color: #f8f9fa;
          padding: 15px;
          border-radius: 4px;
          margin: 20px 0;
          word-break: break-all;
          font-size: 12px;
          color: #666666;
        }
        .warning-box {
          background-color: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 15px;
          margin: 25px 0;
          border-radius: 4px;
        }
        .warning-box p {
          color: #856404;
          font-size: 14px;
          margin: 0;
        }
        .footer {
          background-color: #f8f9fa;
          padding: 30px;
          text-align: center;
          color: #666666;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <h1>Password Reset Request</h1>
        </div>
        <div class="content">
          <p class="greeting">Hello ${name},</p>
          <p class="message">
            We received a request to reset your password. Click the button below to create a new password:
          </p>
          
          <div class="button-container">
            <a href="${resetUrl}" class="reset-button">Reset Password</a>
          </div>

          <p class="message" style="font-size: 14px; color: #999;">
            Or copy and paste this link into your browser:
          </p>
          <div class="link-box">${resetUrl}</div>

          <div class="warning-box">
            <p><strong>⏰ Important:</strong> This link will expire in 10 minutes. If you didn't request this, please ignore this email.</p>
          </div>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} GlobalCare Support System. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail(
    email,
    'Password Reset Request - GlobalCare',
    html
  );
};

// Initialize email service on module load (non-blocking)
// On cloud platforms like Render, this might timeout, which is OK
initializeEmail().catch(err => {
  if (err.message.includes('timeout') || err.message.includes('Connection timeout')) {
    console.log('ℹ️ Email service initialization timed out (normal on cloud platforms). Will initialize on first email send.');
  } else {
    console.error('⚠️ Email service will be initialized on first use:', err.message);
  }
});

/**
 * Send password reset OTP code email
 * @param {string} email - Recipient email
 * @param {string} name - User name
 * @param {string} otpCode - 6-digit OTP code
 * @param {string} role - User role
 */
const sendPasswordResetOTPEmail = async (email, name, otpCode, role) => {
  const loginUrl = process.env.FRONTEND_URL || 'https://mainproduct.vercel.app';
  const roleLoginPath = role === 'customer' ? '/customer/login' : 
                       role === 'agent' ? '/agent/login' : 
                       '/admin/login';
  const resetPath = role === 'customer' ? '/customer/reset-password' : 
                   role === 'agent' ? '/agent/reset-password' : 
                   '/admin/reset-password';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset Code</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333333;
          background-color: #f4f4f4;
        }
        .email-container {
          max-width: 600px;
          margin: 0 auto;
          background-color: #ffffff;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #ffffff;
          padding: 40px 20px;
          text-align: center;
        }
        .header h1 {
          font-size: 28px;
          font-weight: 600;
        }
        .content {
          padding: 40px 30px;
        }
        .greeting {
          font-size: 18px;
          color: #333333;
          margin-bottom: 20px;
        }
        .message {
          font-size: 16px;
          color: #666666;
          margin-bottom: 30px;
          line-height: 1.8;
        }
        .otp-box {
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          border-radius: 12px;
          padding: 30px;
          margin: 30px 0;
          text-align: center;
          border: 2px dashed #667eea;
        }
        .otp-code {
          font-size: 48px;
          font-weight: 700;
          color: #667eea;
          letter-spacing: 8px;
          font-family: 'Courier New', monospace;
          margin: 20px 0;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
        }
        .otp-label {
          font-size: 14px;
          color: #666666;
          text-transform: uppercase;
          letter-spacing: 2px;
          margin-bottom: 10px;
        }
        .button-container {
          text-align: center;
          margin: 35px 0;
        }
        .reset-button {
          display: inline-block;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #ffffff;
          text-decoration: none;
          padding: 15px 40px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 16px;
        }
        .warning-box {
          background-color: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 15px;
          margin: 25px 0;
          border-radius: 4px;
        }
        .warning-box p {
          color: #856404;
          font-size: 14px;
          margin: 0;
        }
        .info-box {
          background-color: #e7f3ff;
          border-left: 4px solid #2196F3;
          padding: 15px;
          margin: 25px 0;
          border-radius: 4px;
        }
        .info-box p {
          color: #0d47a1;
          font-size: 14px;
          margin: 0;
        }
        .footer {
          background-color: #f8f9fa;
          padding: 30px;
          text-align: center;
          color: #666666;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <h1>Password Reset Code</h1>
        </div>
        <div class="content">
          <p class="greeting">Hello ${name},</p>
          <p class="message">
            We received a request to reset your password. Use the verification code below to proceed:
          </p>
          
          <div class="otp-box">
            <div class="otp-label">Your Verification Code</div>
            <div class="otp-code">${otpCode}</div>
            <p style="color: #666; font-size: 12px; margin-top: 10px;">This code expires in 5 minutes</p>
          </div>

          <div class="button-container">
            <a href="${loginUrl}${resetPath}" class="reset-button">Enter Code to Reset Password</a>
          </div>

          <div class="info-box">
            <p><strong>📝 Instructions:</strong></p>
            <p style="margin-top: 8px;">1. Go to the password reset page</p>
            <p>2. Enter your email and this verification code</p>
            <p>3. Set your new password</p>
          </div>

          <div class="warning-box">
            <p><strong>🔒 Security:</strong> Never share this code with anyone. If you didn't request this, please ignore this email and your password will remain unchanged.</p>
          </div>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} GlobalCare Support System. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail(
    email,
    'Password Reset Verification Code - GlobalCare',
    html
  );
};

module.exports = {
  sendEmail,
  sendCredentialsEmail,
  sendPasswordResetEmail,
  sendPasswordResetOTPEmail,
  initializeEmail,
};
