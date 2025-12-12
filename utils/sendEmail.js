const nodemailer = require('nodemailer');

const buildTransportConfig = () => {
  const basePort = Number(process.env.EMAIL_PORT) || 587;
  const secure =
    typeof process.env.EMAIL_SECURE !== 'undefined'
      ? process.env.EMAIL_SECURE === 'true'
      : basePort === 465;

  const commonAuth = {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  };

  if (process.env.EMAIL_SERVICE) {
    return {
      service: process.env.EMAIL_SERVICE,
      auth: commonAuth,
    };
  }

  const config = {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: basePort,
    secure,
    auth: commonAuth,
  };

  if (process.env.EMAIL_ALLOW_SELF_SIGNED === 'true') {
    config.tls = { rejectUnauthorized: false };
  }

  return config;
};

const transporter = nodemailer.createTransport(buildTransportConfig());
let transporterVerified = false;

const ensureTransportReady = async () => {
  if (transporterVerified) {
    return true;
  }

  try {
    await transporter.verify();
    transporterVerified = true;
    console.log('Email transporter configuration verified.');
    return true;
  } catch (error) {
    console.error('Email transporter verification failed:', error.message);
    return false;
  }
};

const sendEmail = async (to, subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('Email credentials are not configured.');
    return false;
  }

  const isReady = await ensureTransportReady();
  if (!isReady) {
    return false;
  }

  try {
    const mailOptions = {
      from: `"GlobalCare Support" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent: ', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email: ', error.message);
    return false;
  }
};

const sendCredentialsEmail = async (email, password, role, name) => {
  const roleText = role === 'customer' ? 'Customer' : role === 'agent' ? 'Agent' : 'Admin';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .credentials { background-color: white; padding: 15px; margin: 20px 0; border-left: 4px solid #4CAF50; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to GlobalCare Support System</h1>
        </div>
        <div class="content">
          <p>Hello ${name},</p>
          <p>Your ${roleText} account has been created successfully. Please use the following credentials to log in:</p>
          <div class="credentials">
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Password:</strong> ${password}</p>
          </div>
          <p>Please keep these credentials secure and change your password after your first login.</p>
          <p>You can log in at: <a href="${process.env.FRONTEND_URL}">${process.env.FRONTEND_URL}</a></p>
        </div>
        <div class="footer">
          <p>&copy; 2024 GlobalCare Support System. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail(email, 'Your GlobalCare Support System Login Credentials', html);
};

module.exports = { sendEmail, sendCredentialsEmail };

