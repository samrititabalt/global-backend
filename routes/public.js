const express = require('express');
const router = express.Router();
const Plan = require('../models/Plan');
const { ensureDefaultPlans, formatPlanForResponse } = require('../utils/planDefaults');
const mail = require('../utils/sendEmail');
const { generateAIResponse } = require('../services/openaiService');
const Lead = require('../models/Lead');
const Activity = require('../models/Activity');

// @route   GET /api/public/plans
// @desc    Get all available plans (public)
// @access  Public
router.get('/plans', async (req, res) => {
  try {
    await ensureDefaultPlans();
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    res.json({ success: true, plans: plans.map(formatPlanForResponse) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/public/chatbot-message
// @desc    Send message to public chatbot (GPT-4 Mini)
// @access  Public
router.post('/chatbot-message', async (req, res) => {
  try {
    const { message, chatHistory = [] } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      });
    }

    // Format chat history for GPT-4 Mini
    // Convert from frontend format {sender: 'user'|'bot', text: string} to backend format
    // buildChatMessages expects: senderType 'customer' -> role 'user', others -> role 'assistant'
    const formattedHistory = chatHistory
      .filter(msg => msg.sender && msg.text)
      .map(msg => ({
        senderType: msg.sender === 'user' ? 'customer' : 'agent',
        content: msg.text.trim(),
        timestamp: msg.timestamp || new Date()
      }))
      .slice(-10); // Keep last 10 messages for context

    // Use GPT-4 Mini for responses
    const aiResponse = await generateAIResponse(
      message.trim(),
      formattedHistory,
      'default' // Using default service prompt
    );

    // Track chatbot interaction activity
    Activity.create({
      type: 'chatbot_interaction',
      description: `Chatbot interaction: Visitor sent message "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`,
      metadata: { message: message.trim(), chatHistoryLength: chatHistory.length }
    }).catch(err => console.error('Error creating activity:', err));

    // Send email notification to owner
    const emailSubject = 'New Chatbot Interaction - Tabalt Website';
    const emailContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 5px 5px 0 0; }
            .content { background: white; padding: 20px; border: 1px solid #ddd; }
            .message-box { background: #f5f5f5; padding: 15px; margin: 15px 0; border-radius: 5px; border-left: 4px solid #667eea; }
            .footer { background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 5px 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>New Chatbot Interaction</h2>
            </div>
            <div class="content">
              <p>A visitor on the Tabalt website has interacted with the chatbot.</p>
              <div class="message-box">
                <p><strong>Visitor Message:</strong></p>
                <p>${message.trim().replace(/\n/g, '<br>')}</p>
                <p style="margin-top: 10px; font-size: 12px; color: #666;">
                  <strong>Timestamp:</strong> ${new Date().toLocaleString()}
                </p>
              </div>
            </div>
            <div class="footer">
              <p>This is an automated email from the Tabalt website chat bot.</p>
            </div>
          </div>
        </body>
      </html>
    `;
    
    // Send email notification (non-blocking)
    mail('spbajaj25@gmail.com', emailSubject, emailContent)
      .then(() => console.log('Chatbot interaction email sent'))
      .catch(err => console.error('Error sending chatbot interaction email:', err));

    res.json({
      success: true,
      message: aiResponse,
    });
  } catch (error) {
    console.error('Public chatbot error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to process message at this time.',
      error: error.message,
    });
  }
});

// @route   POST /api/public/send-contact-info
// @desc    Send email and phone number to agent and save as lead
// @access  Public
router.post('/send-contact-info', async (req, res) => {
  try {
    const { email, phoneNumber } = req.body;

    if (!email || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Email and phone number are required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
      });
    }

    const subject = 'New Chatbot Contact Information - Tabalt Website';
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 5px 5px 0 0; }
            .content { background: white; padding: 20px; border: 1px solid #ddd; }
            .info-box { background: #f5f5f5; padding: 15px; margin: 15px 0; border-radius: 5px; border-left: 4px solid #667eea; }
            .footer { background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 5px 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>New Contact Information from Chatbot</h2>
            </div>
            <div class="content">
              <p>A visitor on the Tabalt website has provided their contact information through the chatbot.</p>
              <div class="info-box">
                <p><strong>Email Address:</strong> ${email}</p>
                <p><strong>Phone Number:</strong> ${phoneNumber}</p>
                <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
              </div>
            </div>
            <div class="footer">
              <p>This is an automated email from the Tabalt website chat bot.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const result = await mail('spbajaj25@gmail.com', subject, htmlContent);

    // Save lead to CRM database
    try {
      await Lead.create({
        email,
        phoneNumber,
        source: 'Chatbot',
        status: 'Lead',
        dateCaptured: new Date()
      });
    } catch (leadError) {
      console.error('Error saving lead to CRM:', leadError);
      // Don't fail the request if lead save fails, just log it
    }

    // Track activity for contact shared
    Activity.create({
      type: 'chatbot_contact_shared',
      description: `Chatbot contact shared: ${email} (${phoneNumber})`,
      metadata: { email, phoneNumber }
    }).catch(err => console.error('Error creating activity:', err));

    if (result.success) {
      res.json({
        success: true,
        message: 'Contact information sent and lead saved successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send contact information or save lead',
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Send contact info or save lead error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to process contact information at this time.',
      error: error.message,
    });
  }
});

// @route   POST /api/public/ensure-owner-customer
// @desc    Ensure owner email has customer profile with Full Time plan
// @access  Public (but only works for owner email)
router.post('/ensure-owner-customer', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Only allow for owner email
    if (!email || email.toLowerCase() !== 'spbajaj25@gmail.com') {
      return res.status(403).json({ 
        success: false,
        message: 'Unauthorized' 
      });
    }

    const User = require('../models/User');
    const Plan = require('../models/Plan');
    const bcrypt = require('bcryptjs');
    const generateToken = require('../utils/jwtToken');
    const { ensureDefaultPlans } = require('../utils/planDefaults');

    // Ensure default plans exist
    await ensureDefaultPlans();

    // Find or create user
    let user = await User.findOne({ email: email.toLowerCase() });
    let isNewUser = false;
    
    if (!user) {
      // Create new user as customer
      isNewUser = true;
      const defaultPassword = 'sam12345';
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      
      user = await User.create({
        name: 'Samriti Bajaj',
        email: email.toLowerCase(),
        phone: '0000000000', // Placeholder
        country: 'USA', // Placeholder
        password: hashedPassword,
        role: 'customer'
      });
    }

    // Find Full Time plan
    const fullTimePlan = await Plan.findOne({ slug: 'fulltime' });
    
    if (!fullTimePlan) {
      return res.status(500).json({ 
        success: false,
        message: 'Full Time plan not found' 
      });
    }

    // For owner email, always ensure they have Full Time plan access
    // If user is an agent, we don't change their role in DB, but return customer role for frontend
    if (isNewUser || user.role === 'customer') {
      // Assign Full Time plan if not already assigned
      if (!user.currentPlan || user.currentPlan.toString() !== fullTimePlan._id.toString()) {
        user.currentPlan = fullTimePlan._id;
        user.planStatus = 'approved';
        user.tokenBalance = fullTimePlan.tokens || 9600;
        await user.save();
      }
    } else {
      // User exists as agent - ensure they have token balance for customer features
      // Don't change their role in DB, but ensure they have access
      if (!user.tokenBalance || user.tokenBalance < fullTimePlan.tokens) {
        user.tokenBalance = fullTimePlan.tokens || 9600;
        await user.save();
      }
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        role: 'customer',
        tokenBalance: user.tokenBalance,
        currentPlan: user.currentPlan,
        planStatus: user.planStatus
      }
    });
  } catch (error) {
    console.error('Error ensuring owner customer:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

module.exports = router;
