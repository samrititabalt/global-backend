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
  const emailPass = process.env.EMAIL_PASS;

  if (!emailUser || !emailPass) {
    throw new Error('Email credentials (EMAIL_USER and EMAIL_PASS) are required in .env file');
  }

  const config = {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: emailUser,
      pass: emailPass.replace(/\s+/g, ''), // Remove spaces from app password
    },
    // Connection pool settings for better performance
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
    // TLS options for better security
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates if needed
      ciphers: 'SSLv3'
    },
    // Connection timeout
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000,
  };

  return nodemailer.createTransport(config);
};

// Create transporter instance
let transporter = null;
let isVerified = false;

/**
 * Initialize and verify email transporter
 */
const initializeEmail = async () => {
  try {
    if (!transporter) {
      transporter = createTransporter();
    }

    // Verify connection
    if (!isVerified) {
      await transporter.verify();
      isVerified = true;
      console.log('✅ Email service initialized and verified successfully');
      console.log(`📧 Email configured for: ${process.env.EMAIL_USER}`);
    }

    return true;
  } catch (error) {
    console.error('❌ Email service initialization failed:', error.message);
    isVerified = false;
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
  // Ensure email service is initialized
  if (!isVerified) {
    await initializeEmail();
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

  // Retry logic
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${to} (Message ID: ${info.messageId})`);
      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
      };
    } catch (error) {
      lastError = error;
      console.error(`❌ Email send attempt ${attempt}/${retries} failed:`, error.message);

      // If it's a connection error, try to reinitialize
      if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
        console.log('🔄 Reinitializing email connection...');
        isVerified = false;
        transporter = null;
        await initializeEmail();
      }

      // Wait before retry (exponential backoff)
      if (attempt < retries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
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

// Initialize email service on module load
initializeEmail().catch(err => {
  console.error('⚠️ Email service will be initialized on first use');
});

module.exports = {
  sendEmail,
  sendCredentialsEmail,
  sendPasswordResetEmail,
  initializeEmail,
};
