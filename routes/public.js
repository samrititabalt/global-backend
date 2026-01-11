const express = require('express');
const router = express.Router();
const Plan = require('../models/Plan');
const { ensureDefaultPlans, formatPlanForResponse } = require('../utils/planDefaults');
const mail = require('../utils/sendEmail');
const { generateAIResponse } = require('../services/openaiService');
const Lead = require('../models/Lead');

router.get('/plans', async (req, res) => {
  try {
    await ensureDefaultPlans();
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    res.json({
      success: true,
      plans: plans.map(formatPlanForResponse),
    });
  } catch (error) {
    console.error('Public plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to load plans at this time.',
    });
  }
});

// @route   POST /api/public/send-chat-email
// @desc    Send chat history to email
// @access  Public
router.post('/send-chat-email', async (req, res) => {
  try {
    const { to, subject, text, chatHistory } = req.body;

    if (!to || !subject || !text) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: to, subject, text',
      });
    }

    // Format chat history as HTML
    const chatHistoryHTML = chatHistory && chatHistory.length > 0
      ? `
        <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 5px;">
          <h3 style="margin-bottom: 15px; color: #333;">Chat History:</h3>
          ${chatHistory.map((msg, idx) => `
            <div style="margin-bottom: 10px; padding: 10px; background-color: white; border-left: 3px solid ${msg.sender === 'bot' ? '#3b82f6' : '#10b981'};">
              <strong style="color: ${msg.sender === 'bot' ? '#3b82f6' : '#10b981'};">
                ${msg.sender === 'bot' ? 'Bot' : 'Visitor'}
              </strong>
              <span style="color: #666; font-size: 12px; margin-left: 10px;">
                ${new Date(msg.timestamp).toLocaleString()}
              </span>
              <p style="margin-top: 5px; color: #333;">${msg.text}</p>
            </div>
          `).join('')}
        </div>
      `
      : '';

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
            .footer { background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 5px 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>${subject}</h2>
            </div>
            <div class="content">
              <p>${text.replace(/\n/g, '<br>')}</p>
              ${chatHistoryHTML}
            </div>
            <div class="footer">
              <p>This is an automated email from the Tabalt website chat bot.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const result = await mail(to, subject, htmlContent);

    if (result.success) {
      res.json({
        success: true,
        message: 'Email sent successfully',
        messageId: result.messageId,
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send email',
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Send chat email error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to send email at this time.',
      error: error.message,
    });
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
// @desc    Send email and phone number to agent
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

    if (result.success) {
      res.json({
        success: true,
        message: 'Contact information sent successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send contact information',
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Send contact info error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to send contact information at this time.',
      error: error.message,
    });
  }
});

module.exports = router;
