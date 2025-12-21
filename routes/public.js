const express = require('express');
const router = express.Router();
const Plan = require('../models/Plan');
const { ensureDefaultPlans, formatPlanForResponse } = require('../utils/planDefaults');
const mail = require('../utils/sendEmail');

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

module.exports = router;
