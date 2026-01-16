const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const LinkedInAccount = require('../models/LinkedInAccount');
const LinkedInMessage = require('../models/LinkedInMessage');
const LinkedInCampaign = require('../models/LinkedInCampaign');
const LinkedInTask = require('../models/LinkedInTask');
const LinkedInLog = require('../models/LinkedInLog');
const LinkedInTemplate = require('../models/LinkedInTemplate');
const { addInboxSyncTask, addMessageTask, addConnectionTask } = require('../services/linkedInQueue');
const { generateAIResponse } = require('../services/openaiService');

// All routes require authentication
router.use(protect);
router.use(authorize('customer', 'admin'));

/**
 * GET /api/linkedin-helper/accounts
 * Get all LinkedIn accounts for the user
 */
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await LinkedInAccount.find({ userId: req.user._id })
      .select('-encryptedLiAt -encryptedJSESSIONID')
      .sort({ createdAt: -1 });
    res.json({ success: true, accounts });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/linkedin-helper/accounts
 * Create/connect a LinkedIn account (Extension-based, no cookies needed)
 */
router.post('/accounts', async (req, res) => {
  try {
    const { extensionId, proxy, consentAccepted } = req.body;

    if (!consentAccepted) {
      return res.status(400).json({ message: 'You must accept the terms and risks' });
    }

    // Check if account already exists
    let account = await LinkedInAccount.findOne({ userId: req.user._id });

    if (account) {
      // Update existing account
      if (proxy) account.proxy = proxy;
      if (extensionId) account.extensionId = extensionId;
      account.consentAccepted = true;
      account.consentAcceptedAt = new Date();
      account.status = 'active';
      account.connectionMethod = 'extension';
      await account.save();
    } else {
      // Create new account (extension-based, no cookies stored)
      account = new LinkedInAccount({
        userId: req.user._id,
        extensionId: extensionId || null,
        proxy: proxy || null,
        consentAccepted: true,
        consentAcceptedAt: new Date(),
        connectedAt: new Date(),
        connectionMethod: 'extension'
      });
      // For extension method, we don't store cookies
      // Extension handles authentication directly
      await account.save();
    }

    res.json({ success: true, account: account.toObject() });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/linkedin-helper/accounts/current
 * Get current user's account
 */
router.get('/accounts/current', async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({ userId: req.user._id })
      .select('-encryptedLiAt -encryptedJSESSIONID');

    if (!account) {
      return res.status(404).json({ message: 'No account found' });
    }

    res.json({ success: true, account });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/linkedin-helper/accounts/:id
 * Get account details
 */
router.get('/accounts/:id', async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).select('-encryptedLiAt -encryptedJSESSIONID');

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    res.json({ success: true, account });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * PUT /api/linkedin-helper/accounts/:id
 * Update account settings
 */
router.put('/accounts/:id', async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    if (req.body.settings) {
      account.settings = { ...account.settings, ...req.body.settings };
    }
    if (req.body.proxy !== undefined) {
      account.proxy = req.body.proxy;
    }
    if (req.body.status) {
      account.status = req.body.status;
    }

    await account.save();

    res.json({ success: true, account: account.toObject() });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * DELETE /api/linkedin-helper/accounts/:id
 * Delete account and all related data
 */
router.delete('/accounts/:id', async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Delete all related data
    await Promise.all([
      LinkedInMessage.deleteMany({ accountId: account._id }),
      LinkedInCampaign.deleteMany({ accountId: account._id }),
      LinkedInTask.deleteMany({ accountId: account._id }),
      LinkedInLog.deleteMany({ accountId: account._id }),
      account.deleteOne()
    ]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/linkedin-helper/accounts/:id/inbox
 * Get inbox messages
 */
router.get('/accounts/:id/inbox', async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const messages = await LinkedInMessage.find({ accountId: account._id })
      .sort({ timestamp: -1 })
      .limit(100);

    // Group by conversation
    const conversations = {};
    messages.forEach(msg => {
      if (!conversations[msg.conversationId]) {
        conversations[msg.conversationId] = {
          conversationId: msg.conversationId,
          senderName: msg.senderName,
          senderProfileUrl: msg.senderProfileUrl,
          messages: [],
          unreadCount: 0,
          lastMessageAt: msg.timestamp
        };
      }
      conversations[msg.conversationId].messages.push(msg);
      if (!msg.isRead) {
        conversations[msg.conversationId].unreadCount += 1;
      }
      if (msg.timestamp > conversations[msg.conversationId].lastMessageAt) {
        conversations[msg.conversationId].lastMessageAt = msg.timestamp;
      }
    });

    res.json({
      success: true,
      conversations: Object.values(conversations).sort((a, b) => 
        new Date(b.lastMessageAt) - new Date(a.lastMessageAt)
      )
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/linkedin-helper/accounts/:id/inbox/sync
 * Trigger inbox sync (for extension-based accounts, extension handles sync)
 */
router.post('/accounts/:id/inbox/sync', async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // For extension-based accounts, sync is handled by extension
    // This endpoint just acknowledges the sync request
    if (account.connectionMethod === 'extension') {
      res.json({ 
        success: true, 
        message: 'Sync request sent to extension',
        method: 'extension'
      });
    } else {
      // For cookie-based accounts, use background workers
      const result = await addInboxSyncTask(account._id);
      res.json({ success: true, ...result });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/linkedin-helper/accounts/current/inbox/sync
 * Sync inbox data from extension
 */
router.post('/accounts/current/inbox/sync', async (req, res) => {
  try {
    const { conversations } = req.body;
    
    const account = await LinkedInAccount.findOne({ userId: req.user._id });
    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Save conversations to database
    const savedMessages = [];
    for (const conv of conversations || []) {
      const message = await LinkedInMessage.findOneAndUpdate(
        { 
          accountId: account._id, 
          conversationId: conv.conversationId,
          messageId: conv.messageId || `ext_${conv.conversationId}_${Date.now()}`
        },
        {
          accountId: account._id,
          conversationId: conv.conversationId,
          senderName: conv.senderName,
          messageText: conv.lastMessage,
          messageId: conv.messageId || `ext_${conv.conversationId}_${Date.now()}`,
          timestamp: new Date(conv.timestamp),
          isRead: false
        },
        { upsert: true, new: true }
      );
      savedMessages.push(message);
    }

    account.lastSyncAt = new Date();
    await account.save();

    res.json({ 
      success: true, 
      messagesSaved: savedMessages.length,
      conversations: savedMessages.length 
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/linkedin-helper/accounts/:id/messages/send
 * Send a message
 */
router.post('/accounts/:id/messages/send', async (req, res) => {
  try {
    const { conversationId, messageText, delay = 0 } = req.body;

    if (!conversationId || !messageText) {
      return res.status(400).json({ message: 'conversationId and messageText are required' });
    }

    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    if (account.status !== 'active') {
      return res.status(400).json({ message: 'Account is not active' });
    }

    const delayMs = delay * 1000; // Convert seconds to milliseconds
    const result = await addMessageTask(account._id, conversationId, messageText, delayMs);

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/linkedin-helper/accounts/:id/messages/bulk-send
 * Send bulk messages with delays
 */
router.post('/accounts/:id/messages/bulk-send', async (req, res) => {
  try {
    const { conversations, messageText, delayBetween = 120 } = req.body;

    if (!conversations || !Array.isArray(conversations) || conversations.length === 0) {
      return res.status(400).json({ message: 'conversations array is required' });
    }

    if (!messageText) {
      return res.status(400).json({ message: 'messageText is required' });
    }

    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    if (account.status !== 'active') {
      return res.status(400).json({ message: 'Account is not active' });
    }

    const tasks = [];
    let currentDelay = 0;

    for (const conversationId of conversations) {
      const delayMs = currentDelay * 1000;
      try {
        const result = await addMessageTask(account._id, conversationId, messageText, delayMs);
        tasks.push(result);
        currentDelay += delayBetween; // Add delay between messages
      } catch (error) {
        // Continue with other messages even if one fails
        console.error(`Failed to queue message for ${conversationId}:`, error.message);
      }
    }

    res.json({ success: true, tasks, total: tasks.length });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/linkedin-helper/accounts/:id/messages/ai-suggest
 * Get AI reply suggestions
 */
router.post('/accounts/:id/messages/ai-suggest', async (req, res) => {
  try {
    const { conversationId, messageText } = req.body;

    if (!messageText) {
      return res.status(400).json({ message: 'messageText is required' });
    }

    const prompt = `You are a professional LinkedIn messaging assistant. Generate 2-3 short, professional, and friendly reply suggestions for this LinkedIn message. Keep replies concise (1-2 sentences), professional, and appropriate for LinkedIn.

Message: "${messageText}"

Generate 2-3 reply suggestions:`;

    const suggestions = await generateAIResponse(prompt, [], 'hiring');
    
    // Parse suggestions (assuming they're numbered or separated)
    const parsedSuggestions = suggestions
      .split(/\n+/)
      .filter(line => line.trim() && /^[0-9]\.|^[-*]/.test(line.trim()))
      .map(line => line.replace(/^[0-9]\.\s*|^[-*]\s*/, '').trim())
      .filter(s => s.length > 0)
      .slice(0, 3);

    res.json({ success: true, suggestions: parsedSuggestions });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/linkedin-helper/campaigns
 * Get all campaigns
 */
router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await LinkedInCampaign.find({ userId: req.user._id })
      .populate('accountId', 'linkedInName linkedInEmail status')
      .sort({ createdAt: -1 });
    res.json({ success: true, campaigns });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/linkedin-helper/campaigns
 * Create a campaign
 */
router.post('/campaigns', async (req, res) => {
  try {
    const { accountId, name, type, profileUrls, connectionMessageTemplate, followUpMessageTemplate, targetConversations, settings } = req.body;

    if (!accountId || !name || !type) {
      return res.status(400).json({ message: 'accountId, name, and type are required' });
    }

    const account = await LinkedInAccount.findOne({
      _id: accountId,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const campaign = await LinkedInCampaign.create({
      accountId,
      userId: req.user._id,
      name,
      type,
      profileUrls: profileUrls || [],
      connectionMessageTemplate,
      followUpMessageTemplate,
      targetConversations: targetConversations || [],
      settings: settings || {}
    });

    res.json({ success: true, campaign });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/linkedin-helper/campaigns/:id/start
 * Start a campaign
 */
router.post('/campaigns/:id/start', async (req, res) => {
  try {
    const campaign = await LinkedInCampaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    const account = await LinkedInAccount.findById(campaign.accountId);
    if (!account || account.status !== 'active') {
      return res.status(400).json({ message: 'Account is not active' });
    }

    campaign.status = 'active';
    campaign.startedAt = new Date();
    await campaign.save();

    // Queue tasks based on campaign type
    if (campaign.type === 'connection_request' && campaign.profileUrls.length > 0) {
      let delay = 0;
      for (const profileUrl of campaign.profileUrls) {
        const delayMs = delay * 1000;
        const delaySeconds = Math.floor(Math.random() * (campaign.settings.delayMaxSeconds - campaign.settings.delayMinSeconds + 1)) + campaign.settings.delayMinSeconds;
        await addConnectionTask(campaign.accountId, profileUrl, campaign.connectionMessageTemplate, delayMs);
        delay += delaySeconds;
      }
    }

    res.json({ success: true, campaign });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/linkedin-helper/campaigns/:id/pause
 * Pause a campaign
 */
router.post('/campaigns/:id/pause', async (req, res) => {
  try {
    const campaign = await LinkedInCampaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    campaign.status = 'paused';
    campaign.pausedAt = new Date();
    await campaign.save();

    res.json({ success: true, campaign });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/linkedin-helper/accounts/:id/tasks
 * Get tasks for an account
 */
router.get('/accounts/:id/tasks', async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const tasks = await LinkedInTask.find({ accountId: account._id })
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ success: true, tasks });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/linkedin-helper/accounts/:id/logs
 * Get logs for an account
 */
router.get('/accounts/:id/logs', async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const logs = await LinkedInLog.find({ accountId: account._id })
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * GET /api/linkedin-helper/templates
 * Get message templates
 */
router.get('/templates', async (req, res) => {
  try {
    const templates = await LinkedInTemplate.find({ userId: req.user._id })
      .sort({ isDefault: -1, createdAt: -1 });
    res.json({ success: true, templates });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * POST /api/linkedin-helper/templates
 * Create a template
 */
router.post('/templates', async (req, res) => {
  try {
    const { name, type, content, variables, isDefault } = req.body;

    if (!name || !type || !content) {
      return res.status(400).json({ message: 'name, type, and content are required' });
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await LinkedInTemplate.updateMany(
        { userId: req.user._id, type },
        { isDefault: false }
      );
    }

    const template = await LinkedInTemplate.create({
      userId: req.user._id,
      name,
      type,
      content,
      variables: variables || [],
      isDefault: isDefault || false
    });

    res.json({ success: true, template });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * DELETE /api/linkedin-helper/templates/:id
 * Delete a template
 */
router.delete('/templates/:id', async (req, res) => {
  try {
    const template = await LinkedInTemplate.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }

    await template.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

