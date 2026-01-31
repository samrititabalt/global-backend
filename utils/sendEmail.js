const brevo = require('@getbrevo/brevo');

/**
 * Simple email sending function using Brevo API
 * @param {string} receiverEmail - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const mail = async (receiverEmail, subject, html, customSenderEmail = null, customSenderName = null) => {
  try {
    const brevoApiKey = process.env.BREVO_API_KEY;

    if (!brevoApiKey) {
      throw new Error('BREVO_API_KEY is required in .env file');
    }

    // Use custom sender if provided, otherwise get from environment or use default
    const senderEmail = customSenderEmail || process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_USER || process.env.USER_EMAIL;
    const senderName = customSenderName || process.env.BREVO_SENDER_NAME || 'GlobalCare Support System';

    if (!senderEmail) {
      throw new Error('BREVO_SENDER_EMAIL (or EMAIL_USER/USER_EMAIL) is required in .env file');
    }

    // Initialize Brevo API client
    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, brevoApiKey);

    // Create email data
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;
    sendSmtpEmail.sender = { name: senderName, email: senderEmail };
    sendSmtpEmail.to = [{ email: receiverEmail }];

    // Send email via Brevo API
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);

    console.log("Email send successfully :- ", data.messageId);
    return { success: true, messageId: data.messageId };
  } catch (error) {
    console.error("Error sending email :- ", error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send email with attachments using Brevo API
 * @param {string} receiverEmail
 * @param {string} subject
 * @param {string} html
 * @param {Array<{content: string, name: string, contentType?: string}>} attachments
 * @param {string|null} customSenderEmail
 * @param {string|null} customSenderName
 */
const mailWithAttachment = async (
  receiverEmail,
  subject,
  html,
  attachments = [],
  customSenderEmail = null,
  customSenderName = null
) => {
  try {
    const brevoApiKey = process.env.BREVO_API_KEY;
    if (!brevoApiKey) {
      throw new Error('BREVO_API_KEY is required in .env file');
    }

    const senderEmail = customSenderEmail || process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_USER || process.env.USER_EMAIL;
    const senderName = customSenderName || process.env.BREVO_SENDER_NAME || 'GlobalCare Support System';

    if (!senderEmail) {
      throw new Error('BREVO_SENDER_EMAIL (or EMAIL_USER/USER_EMAIL) is required in .env file');
    }

    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, brevoApiKey);

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;
    sendSmtpEmail.sender = { name: senderName, email: senderEmail };
    sendSmtpEmail.to = [{ email: receiverEmail }];
    if (attachments && attachments.length) {
      sendSmtpEmail.attachment = attachments.map((attachment) => ({
        content: attachment.content,
        name: attachment.name,
        contentType: attachment.contentType || 'application/pdf'
      }));
    }

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('Email sent with attachment:', data.messageId);
    return { success: true, messageId: data.messageId };
  } catch (error) {
    console.error('Error sending email with attachment:', error.message);
    return { success: false, error: error.message };
  }
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

  const result = await mail(email, `Welcome to GlobalCare - Your ${roleText} Account Credentials`, html);
  if (!result.success) {
    throw new Error(result.error || 'Failed to send credentials email');
  }
  return result;
};

/**
 * Send password reset OTP code email
 * @param {string} email - Recipient email
 * @param {string} name - User name
 * @param {string} otpCode - 6-digit OTP code
 * @param {string} role - User role
 */
const sendPasswordResetOTPEmail = async (email, name, otpCode, role) => {
  const loginUrl = process.env.FRONTEND_URL || 'https://mainproduct.vercel.app';
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

  const result = await mail(email, 'Password Reset Verification Code - GlobalCare', html);
  if (!result.success) {
    throw new Error(result.error || 'Failed to send OTP email');
  }
  return result;
};

// Export functions
module.exports = {
  mail,
  sendEmail: mail, // Alias for backward compatibility
  mailWithAttachment,
  sendCredentialsEmail,
  sendPasswordResetOTPEmail,
};
