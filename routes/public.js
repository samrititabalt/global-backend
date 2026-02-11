const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const Plan = require('../models/Plan');
const { ensureDefaultPlans, formatPlanForResponse } = require('../utils/planDefaults');
const mail = require('../utils/sendEmail');
const { generateAIResponse } = require('../services/openaiService');
const Lead = require('../models/Lead');
const Activity = require('../models/Activity');
const VideoStatus = require('../models/VideoStatus');
const SharedChart = require('../models/SharedChart');
const SiteSetting = require('../models/SiteSetting');
const { protect } = require('../middleware/auth');
const MarketResearchAccessCode = require('../models/MarketResearchAccessCode');
const FirstCallDeckMR = require('../models/FirstCallDeckMR');
const FirstCallDeckAgencies = require('../models/FirstCallDeckAgencies');
const { DEFAULT_MARKET_RESEARCH_DECK } = require('../data/defaultMarketResearchDeck');
const { DEFAULT_AGENCIES_DECK } = require('../data/defaultAgenciesDeck');

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
    console.log('Chatbot message received:', { 
      hasMessage: !!req.body.message, 
      messageLength: req.body.message?.length,
      chatHistoryLength: req.body.chatHistory?.length 
    });

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
    let formattedHistory = [];
    try {
      formattedHistory = (Array.isArray(chatHistory) ? chatHistory : [])
        .filter(msg => msg && msg.sender && msg.text)
        .map(msg => ({
          senderType: msg.sender === 'user' ? 'customer' : 'agent',
          content: String(msg.text || '').trim(),
          timestamp: msg.timestamp || new Date()
        }))
        .filter(msg => msg.content) // Remove empty messages
        .slice(-10); // Keep last 10 messages for context
    } catch (historyError) {
      console.error('Error formatting chat history:', historyError);
      formattedHistory = []; // Use empty history if formatting fails
    }

    // Detect if this is a chart builder request
    const isChartBuilderRequest = message.toLowerCase().includes('chart') || 
                                  message.toLowerCase().includes('smart reports') ||
                                  message.toLowerCase().includes('dashboard') ||
                                  message.toLowerCase().includes('data visualization') ||
                                  message.toLowerCase().includes('ppt') ||
                                  message.toLowerCase().includes('powerpoint') ||
                                  chatHistory.some(msg => msg.content?.toLowerCase().includes('chart') || 
                                                   msg.content?.toLowerCase().includes('smart reports'));

    // Use GPT-4 Mini for responses - this will return a fallback if API key is missing/invalid
    let aiResponse;
    try {
      console.log('Calling generateAIResponse...', { isChartBuilderRequest });
      aiResponse = await generateAIResponse(
        message.trim(),
        formattedHistory,
        isChartBuilderRequest ? 'chart_builder' : 'default' // Use chart_builder prompt for chart-related requests
      );
      console.log('AI response received, length:', aiResponse?.length);
    } catch (aiError) {
      console.error('Error generating AI response:', aiError);
      console.error('Error details:', {
        message: aiError.message,
        stack: aiError.stack,
        response: aiError.response?.data,
        status: aiError.status,
        code: aiError.code
      });
      // Use a helpful fallback message if AI generation fails
      const messagePreview = message.substring(0, 50);
      aiResponse = `Thanks for your message about "${messagePreview}${message.length > 50 ? '...' : ''}". I'm here to help you with Sam's Smart Reports Pro. How can I assist you with building charts, formatting data, or customizing your dashboard?`;
    }

    // Ensure we have a response
    if (!aiResponse || typeof aiResponse !== 'string') {
      console.warn('AI response is invalid, using fallback');
      aiResponse = `I'm here to help you with Sam's Smart Reports Pro. How can I assist you with building charts, formatting data, or customizing your dashboard?`;
    }

    // Track chatbot interaction activity (completely non-blocking - use setTimeout to defer)
    setTimeout(() => {
      Activity.create({
        type: 'chatbot_interaction',
        description: `Chatbot interaction: Visitor sent message "${String(message).substring(0, 100)}${message.length > 100 ? '...' : ''}"`,
        metadata: { message: String(message).trim(), chatHistoryLength: chatHistory.length }
      }).catch(err => console.error('Error creating activity (non-blocking):', err));
    }, 0);

    // Send email notification to owner (completely non-blocking - use setTimeout to defer)
    setTimeout(() => {
      try {
        const emailSubject = 'New Chatbot Interaction - Tabalt Website';
        const safeMessage = String(message).trim().replace(/\n/g, '<br>');
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
                    <p>${safeMessage}</p>
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
        
        mail('spbajaj25@gmail.com', emailSubject, emailContent)
          .then(() => console.log('Chatbot interaction email sent'))
          .catch(err => console.error('Error sending chatbot interaction email (non-blocking):', err));
      } catch (emailError) {
        console.error('Error in email sending (non-blocking):', emailError);
      }
    }, 0);

    // Return success response
    console.log('Sending success response');
    res.json({
      success: true,
      message: aiResponse,
    });
  } catch (error) {
    console.error('Public chatbot error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    // Return a helpful fallback message even on error
    res.status(500).json({
      success: false,
      message: 'I apologize, but I\'m having trouble processing your request right now. Please try again in a moment, or feel free to ask a simpler question.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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

// @route   GET /api/public/active-homepage
// @desc    Get which homepage is active for all visitors (original | suspense)
// @access  Public
router.get('/active-homepage', async (req, res) => {
  try {
    const value = await SiteSetting.get('activeHomepage', 'original');
    const activeHomepage = value === 'suspense' ? 'suspense' : 'original';
    res.json({ activeHomepage });
  } catch (error) {
    console.error('[Public API] Error getting active homepage:', error);
    res.json({ activeHomepage: 'original' });
  }
});

// @route   GET /api/public/homepage-video
// @desc    Check if homepage video exists (public endpoint for Home page)
// @access  Public
router.get('/homepage-video', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    // Get VideoStatus record
    let videoStatus = await VideoStatus.getHomepageVideoStatus();
    
    console.log('[Public API] VideoStatus:', {
      cloudinaryUrl: videoStatus.cloudinaryUrl,
      deleted: videoStatus.deleted,
      exists: videoStatus.exists
    });
    
    // Check if Cloudinary URL exists (preferred)
    if (videoStatus.cloudinaryUrl && !videoStatus.deleted) {
      console.log('[Public API] Returning Cloudinary URL:', videoStatus.cloudinaryUrl);
      return res.json({ 
        success: true, 
        exists: true,
        videoUrl: videoStatus.cloudinaryUrl
      });
    }
    
    // Fallback to local file check (for backward compatibility)
    const videoPath = path.join(process.cwd(), 'uploads', 'videos', 'homepage-video.mp4');
    const videoExists = fs.existsSync(videoPath);
    
    console.log('[Public API] Local file check:', { videoExists, path: videoPath });
    
    // Sync status with actual file
    if (videoExists && videoStatus.deleted) {
      const stats = fs.statSync(videoPath);
      videoStatus.exists = true;
      videoStatus.deleted = false;
      videoStatus.size = stats.size;
      videoStatus.lastModified = stats.mtime;
      videoStatus.deletionReason = null;
      videoStatus.deletedAt = null;
      await videoStatus.save();
    }
    
    if (!videoExists && videoStatus.exists && !videoStatus.deleted && !videoStatus.cloudinaryUrl) {
      videoStatus.exists = false;
      videoStatus.deleted = true;
      videoStatus.deletionReason = videoStatus.deletionReason || 'Video file was deleted from server (unknown reason)';
      videoStatus.deletedAt = videoStatus.deletedAt || new Date();
      await videoStatus.save();
    }
    
    if (!videoExists) {
      console.log('[Public API] No video found');
      return res.json({ 
        success: true, 
        exists: false,
        videoUrl: null
      });
    }

    const videoPathUrl = `/uploads/videos/homepage-video.mp4`;
    console.log('[Public API] Returning local file URL:', videoPathUrl);
    
    res.json({ 
      success: true, 
      exists: true,
      videoUrl: videoPathUrl
    });
  } catch (error) {
    console.error('[Public API] Error checking video existence:', error);
    // Return exists: false on error to prevent blocking the page
    res.json({ 
      success: true, 
      exists: false,
      videoPath: null
    });
  }
});

// @route   POST /api/public/share-chart
// @desc    Save chart data and generate shareable link
// @access  Public (but protected route - user must be logged in to share)
router.post('/share-chart', protect, async (req, res) => {
  try {
    const { chartData, chartConfigs, gridData, fieldRoles, fieldModes, dateHierarchies, availableColumns } = req.body;

    if (!chartData || !chartConfigs || !gridData) {
      return res.status(400).json({
        success: false,
        message: 'Chart data, configurations, and grid data are required',
      });
    }

    // Generate unique share ID
    const shareId = require('crypto').randomBytes(16).toString('hex');

    // Save shared chart
    const sharedChart = await SharedChart.create({
      shareId,
      chartData,
      chartConfigs,
      gridData,
      fieldRoles: fieldRoles || {},
      fieldModes: fieldModes || {},
      dateHierarchies: dateHierarchies || {},
      availableColumns: availableColumns || [],
      sharedBy: req.user._id,
    });

    res.json({
      success: true,
      shareId,
      shareUrl: `${req.protocol}://${req.get('host')}/share/chart/${shareId}`,
    });
  } catch (error) {
    console.error('Error sharing chart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share chart',
      error: error.message,
    });
  }
});

// @route   GET /api/public/shared-chart/:shareId
// @desc    Get shared chart data by share ID
// @access  Public (no authentication required)
router.get('/shared-chart/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;

    const sharedChart = await SharedChart.findOne({ 
      shareId,
      expiresAt: { $gt: new Date() } // Only return if not expired
    });

    if (!sharedChart) {
      return res.status(404).json({
        success: false,
        message: 'Shared chart not found or expired',
      });
    }

    res.json({
      success: true,
      chartData: sharedChart.chartData,
      chartConfigs: sharedChart.chartConfigs,
      gridData: sharedChart.gridData,
      fieldRoles: sharedChart.fieldRoles || {},
      fieldModes: sharedChart.fieldModes || {},
      dateHierarchies: sharedChart.dateHierarchies || {},
      availableColumns: sharedChart.availableColumns || [],
      sharedAt: sharedChart.sharedAt,
    });
  } catch (error) {
    console.error('Error retrieving shared chart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve shared chart',
      error: error.message,
    });
  }
});

// @route   GET /api/public/site-media/:key
// @desc    Get stored site image URL by key (e.g. homepage_logo). Used to display admin-uploaded images anywhere on the site.
// @access  Public
router.get('/site-media/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const url = await SiteSetting.get(key, '');
    if (!url) {
      return res.status(404).json({ success: false, url: null });
    }
    res.json({ success: true, url });
  } catch (error) {
    console.error('[Public API] site-media error:', error);
    res.status(500).json({ success: false, url: null });
  }
});

// @route   GET /api/public/first-call-deck-mr
// @desc    Get Market Research first-call deck (public)
// @access  Public
router.get('/first-call-deck-mr', async (req, res) => {
  try {
    const doc = await FirstCallDeckMR.findOne({});
    const slides = doc?.slides?.length ? doc.slides : DEFAULT_MARKET_RESEARCH_DECK;
    res.json({ success: true, deck: { slides } });
  } catch (error) {
    res.status(500).json({ success: false, deck: { slides: DEFAULT_MARKET_RESEARCH_DECK } });
  }
});

// @route   GET /api/public/first-call-deck-agencies
// @desc    Get First-Call Deck To Agencies (public)
// @access  Public
router.get('/first-call-deck-agencies', async (req, res) => {
  try {
    const doc = await FirstCallDeckAgencies.findOne({});
    const slides = doc?.slides?.length ? doc.slides : DEFAULT_AGENCIES_DECK;
    res.json({ success: true, deck: { slides } });
  } catch (error) {
    res.status(500).json({ success: false, deck: { slides: DEFAULT_AGENCIES_DECK } });
  }
});

// @route   POST /api/public/validate-ask-sandy-code
// @desc    Validate Ask Sandy secret access code (gate for Ask Sandy page)
// @access  Public
router.post('/validate-ask-sandy-code', async (req, res) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const stored = await SiteSetting.get('ask_sandy_access_code', '9899364215');
    const valid = code === stored;
    res.json({ success: valid, valid });
  } catch (error) {
    res.status(500).json({ success: false, valid: false });
  }
});

// ---------- Ask Sandy approval flow (referral from tabaltllp@gmail.com or rainasarita72@gmail.com) ----------
const AskSandyPendingApproval = require('../models/AskSandyPendingApproval');
const crypto = require('crypto');

const ASK_SANDY_APPROVER_EMAILS = ['tabaltllp@gmail.com', 'rainasarita72@gmail.com'];

function isAskSandyApprover(email) {
  return ASK_SANDY_APPROVER_EMAILS.includes((email || '').toLowerCase().trim());
}

// @route   POST /api/public/ask-sandy-request-approval
// @desc    Request approval for Ask Sandy registration; sends approval link to both approver emails via Brevo
// @access  Public
router.post('/ask-sandy-request-approval', async (req, res) => {
  try {
    const { name, email, approverEmail } = req.body;
    const requestedEmail = (email || '').toLowerCase().trim();
    const approver = (approverEmail || '').toLowerCase().trim();
    if (!name || !requestedEmail || !approver) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and approver email are required. Please select which email is approving you (tabaltllp@gmail.com or rainasarita72@gmail.com).'
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }
    if (isAskSandyApprover(requestedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'If you are registering with tabaltllp@gmail.com or rainasarita72@gmail.com, you can register directly without approval.'
      });
    }
    if (!ASK_SANDY_APPROVER_EMAILS.includes(approver)) {
      return res.status(400).json({
        success: false,
        message: 'Please select one of the two approver emails: tabaltllp@gmail.com or rainasarita72@gmail.com.'
      });
    }

    const existing = await AskSandyPendingApproval.findOne({ requestedEmail, approved: false }).sort({ createdAt: -1 });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'An approval request for this email is already pending. You have not been approved yet. Reach out to the people who own these email addresses: tabaltllp@gmail.com, rainasarita72@gmail.com.'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const backendUrl = (process.env.BACKEND_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const approvalLink = backendUrl ? `${backendUrl}/api/public/ask-sandy-approve/${token}` : `${req.protocol}://${req.get('host')}/api/public/ask-sandy-approve/${token}`;

    await AskSandyPendingApproval.create({
      requestedEmail,
      name: String(name).trim(),
      approverEmail: approver,
      token,
      approved: false
    });

    const htmlContent = `
      <p><strong>Ask Sandy – New user approval request</strong></p>
      <p>A new user has requested access to Ask Sandy and indicated that you are approving them.</p>
      <ul>
        <li><strong>Name:</strong> ${String(name).trim()}</li>
        <li><strong>Email requested:</strong> ${requestedEmail}</li>
      </ul>
      <p>Click the button below to approve this user. Once approved, they will be able to complete registration with the email above.</p>
      <p><a href="${approvalLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600;">Approve</a></p>
      <p>If you did not expect this request, you can ignore this email.</p>
      <p style="color:#666;font-size:12px;">This link is valid until used. Approving allows the user to register with the requested email.</p>
    `;

    const sent = await Promise.allSettled(
      ASK_SANDY_APPROVER_EMAILS.map((to) => mail(to, 'Ask Sandy – Approve new user', htmlContent))
    );

    const anySent = sent.some((r) => r.status === 'fulfilled' && r.value?.success);
    if (!anySent) {
      const err = sent.find((r) => r.status === 'rejected' || (r.value && !r.value.success));
      console.error('Ask Sandy approval emails failed:', err);
      return res.status(500).json({
        success: false,
        message: 'We could not send the approval emails. Please try again later or contact support.'
      });
    }

    res.json({
      success: true,
      pending: true,
      message: 'We have sent an approval link to both email addresses (tabaltllp@gmail.com and rainasarita72@gmail.com). You will be able to register once one of them approves. Please come back to this page and complete registration with the same email after you receive approval.'
    });
  } catch (err) {
    console.error('Ask Sandy request approval:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Request approval failed.'
    });
  }
});

// @route   GET /api/public/ask-sandy-approve/:token
// @desc    Approve a pending user (link clicked from email); redirects to frontend
// @access  Public
router.get('/ask-sandy-approve/:token', async (req, res) => {
  const frontendUrl = (process.env.FRONTEND_URL || 'https://mainproduct.vercel.app').replace(/\/$/, '');
  const redirectUrl = `${frontendUrl}/ask-sandy?approved=1`;
  try {
    const { token } = req.params;
    if (!token) {
      return res.redirect(`${redirectUrl}?error=missing`);
    }
    const pending = await AskSandyPendingApproval.findOne({ token, approved: false });
    if (!pending) {
      return res.redirect(`${redirectUrl}?error=invalid`);
    }
    pending.approved = true;
    pending.approvedAt = new Date();
    pending.approvedBy = null;
    await pending.save();
    return res.redirect(`${redirectUrl}&email=${encodeURIComponent(pending.requestedEmail)}`);
  } catch (err) {
    console.error('Ask Sandy approve token:', err);
    return res.redirect(`${redirectUrl}?error=server`);
  }
});

// @route   POST /api/public/market-research/validate
// @desc    Validate Market Research Platform access
// @access  Public
router.post('/market-research/validate', async (req, res) => {
  try {
    const { companyName, secretNumber } = req.body;
    if (!companyName || !secretNumber) {
      return res.status(400).json({
        success: false,
        message: 'Company name and secret number are required',
      });
    }

    const normalizedName = String(companyName).trim();
    const normalizedSecret = String(secretNumber).trim();
    const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const code = await MarketResearchAccessCode.findOne({
      companyName: { $regex: new RegExp(`^${escapedName}$`, 'i') },
      secretNumber: normalizedSecret,
    });

    if (!code) {
      return res.status(401).json({
        success: false,
        message: 'Invalid company name or secret number',
      });
    }

    res.json({
      success: true,
      companyName: code.companyName,
      slug: code.slug,
    });
  } catch (error) {
    console.error('Error validating Market Research access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate access',
    });
  }
});

module.exports = router;
