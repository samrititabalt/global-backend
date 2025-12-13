/**
 * Email Testing Script
 * Run this to test if email configuration is working
 * 
 * Usage: node utils/testEmail.js
 */

require('dotenv').config();
const { sendEmail, initializeEmail } = require('./sendEmail');

const testEmail = async () => {
  try {
    console.log('🧪 Testing email configuration...\n');
    
    // Initialize email service
    await initializeEmail();
    
    // Test email
    const testHtml = `
      <h1>Email Test</h1>
      <p>This is a test email from GlobalCare Support System.</p>
      <p>If you received this, your email configuration is working correctly! ✅</p>
      <p>Time: ${new Date().toLocaleString()}</p>
    `;
    
    const testEmailAddress = process.env.EMAIL_USER; // Send to yourself
    console.log(`📧 Sending test email to: ${testEmailAddress}`);
    
    const result = await sendEmail(
      testEmailAddress,
      'GlobalCare Email Test',
      testHtml
    );
    
    console.log('\n✅ SUCCESS! Email sent successfully!');
    console.log('Message ID:', result.messageId);
    console.log('\nCheck your inbox (and spam folder) for the test email.');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ FAILED! Email test failed:');
    console.error('Error:', error.message);
    console.error('\nPlease check:');
    console.error('1. EMAIL_USER and EMAIL_PASS are set in .env');
    console.error('2. Email password is correct (Gmail App Password)');
    console.error('3. Internet connection is working');
    console.error('4. Gmail account has "Less secure app access" enabled or using App Password');
    
    process.exit(1);
  }
};

testEmail();

