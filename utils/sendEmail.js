const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendEmail = async (to, subject, html) => {
  try {
    const mailOptions = {
      from: `"GlobalCare Support" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent: ', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email: ', error);
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

