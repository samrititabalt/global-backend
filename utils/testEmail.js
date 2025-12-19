/**
 * Email Testing Script
 * Run this to test if Brevo email configuration is working
 * 
 * Usage: node utils/testEmail.js
 */

require('dotenv').config();
const { mail } = require('./sendEmail');

const testEmail = async () => {
  try {
    console.log('🧪 Testing Brevo email configuration...\n');
    
    // Test email
    const testHtml = `
      <h1>Email Test</h1>
      <p>This is a test email from GlobalCare Support System.</p>
      <p>If you received this, your Brevo email configuration is working correctly! ✅</p>
      <p>Time: ${new Date().toLocaleString()}</p>
    `;
    
    // Get test email address
    const testEmailAddress = process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_USER || process.env.USER_EMAIL;
    
    if (!testEmailAddress) {
      console.error('❌ FAILED! BREVO_SENDER_EMAIL, EMAIL_USER, or USER_EMAIL not set in .env');
      process.exit(1);
    }
    
    if (!process.env.BREVO_API_KEY) {
      console.error('❌ FAILED! BREVO_API_KEY not set in .env');
      process.exit(1);
    }
    
    console.log(`📧 Sending test email to: ${testEmailAddress}`);
    
    const result = await mail(
      testEmailAddress,
      'GlobalCare Email Test (Brevo)',
      testHtml
    );
    
    if (result.success) {
      console.log('\n✅ SUCCESS! Email sent successfully via Brevo!');
      console.log('Message ID:', result.messageId);
      console.log('\nCheck your inbox (and spam folder) for the test email.');
      process.exit(0);
    } else {
      console.error('\n❌ FAILED! Email test failed:');
      console.error('Error:', result.error);
      console.error('\nPlease check:');
      console.error('1. BREVO_API_KEY is set correctly in .env');
      console.error('2. BREVO_SENDER_EMAIL is set and verified in Brevo dashboard');
      console.error('3. Internet connection is working');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ FAILED! Email test failed:');
    console.error('Error:', error.message);
    console.error('\nPlease check:');
    console.error('1. BREVO_API_KEY is set correctly in .env');
    console.error('2. BREVO_SENDER_EMAIL is set and verified in Brevo dashboard');
    console.error('3. Internet connection is working');
    
    process.exit(1);
  }
};

testEmail();
