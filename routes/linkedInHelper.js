const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const LinkedInAccount = require('../models/LinkedInAccount');
const LinkedInMessage = require('../models/LinkedInMessage');
const LinkedInCampaign = require('../models/LinkedInCampaign');
const LinkedInTask = require('../models/LinkedInTask');
const LinkedInLog = require('../models/LinkedInLog');
const LinkedInTemplate = require('../models/LinkedInTemplate');
const {
  queueInboxSync,
  queueMessageReply,
  queueBulkReplies,
  queueConnectionCampaign
} = require('../services/linkedInQueue');
const { generateAIResponse } = require('../services/openaiService');

// Get all LinkedIn accounts for user
router.get('/accounts', protect, async (req, res) => {
  try {
    const accounts = await LinkedInAccount.find({ user: req.user._id })
      .select('-cookies')
      .sort({ createdAt: -1 });
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching LinkedIn accounts:', error);
    res.status(500).json({ message: 'Error fetching accounts', error: error.message });
  }
});

// Get single account
router.get('/accounts/:id', protect, async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    }).select('-cookies');

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    res.json(account);
  } catch (error) {
    console.error('Error fetching LinkedIn account:', error);
    res.status(500).json({ message: 'Error fetching account', error: error.message });
  }
});

// Connect LinkedIn account (with cookies)
router.post('/accounts/connect', protect, async (req, res) => {
  try {
    const { linkedInEmail, li_at, JSESSIONID, proxy, consentGiven } = req.body;

    if (!linkedInEmail || !li_at || !JSESSIONID) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!consentGiven) {
      return res.status(400).json({ message: 'Consent required to use this feature' });
    }

    // Check if account already exists
    const existing = await LinkedInAccount.findOne({
      user: req.user._id,
      linkedInEmail: linkedInEmail.toLowerCase()
    });

    if (existing) {
      return res.status(400).json({ message: 'LinkedIn account already connected' });
    }

    const account = await LinkedInAccount.create({
      user: req.user._id,
      linkedInEmail: linkedInEmail.toLowerCase(),
      proxy: proxy || undefined,
      consentGiven: true,
      consentGivenAt: new Date()
    });

    // Set encrypted cookies
    account.setCookies(li_at, JSESSIONID);
    await account.save();

    await LinkedInLog.create({
      user: req.user._id,
      linkedInAccount: account._id,
      action: 'account_connected',
      status: 'success',
      message: 'LinkedIn account connected successfully',
      details: { email: linkedInEmail }
    });

    res.status(201).json({
      message: 'LinkedIn account connected successfully',
      account: await LinkedInAccount.findById(account._id).select('-cookies')
    });
  } catch (error) {
    console.error('Error connecting LinkedIn account:', error);
    res.status(500).json({ message: 'Error connecting account', error: error.message });
  }
});

// Update account settings
router.put('/accounts/:id', protect, async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const { safety, proxy, status } = req.body;

    if (safety) {
      account.safety = { ...account.safety, ...safety };
    }

    if (proxy) {
      account.proxy = proxy;
    }

    if (status) {
      account.status = status;
    }

    await account.save();

    res.json({
      message: 'Account updated successfully',
      account: await LinkedInAccount.findById(account._id).select('-cookies')
    });
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ message: 'Error updating account', error: error.message });
  }
});

// Disconnect account
router.delete('/accounts/:id', protect, async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Delete all related data
    await LinkedInMessage.deleteMany({ linkedInAccount: account._id });
    await LinkedInCampaign.deleteMany({ linkedInAccount: account._id });
    await LinkedInTask.deleteMany({ linkedInAccount: account._id });
    await LinkedInLog.deleteMany({ linkedInAccount: account._id });

    await LinkedInAccount.deleteOne({ _id: account._id });

    await LinkedInLog.create({
      user: req.user._id,
      linkedInAccount: account._id,
      action: 'account_disconnected',
      status: 'success',
      message: 'LinkedIn account disconnected and all data deleted',
      details: {}
    });

    res.json({ message: 'Account disconnected and all data deleted' });
  } catch (error) {
    console.error('Error disconnecting account:', error);
    res.status(500).json({ message: 'Error disconnecting account', error: error.message });
  }
});

// Get inbox messages
router.get('/accounts/:id/inbox', protect, async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const { page = 1, limit = 50, unreadOnly = false } = req.query;
    const skip = (page - 1) * limit;

    const query = {
      linkedInAccount: account._id,
      messageType: 'incoming'
    };

    if (unreadOnly) {
      query.isRead = false;
    }

    const messages = await LinkedInMessage.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await LinkedInMessage.countDocuments(query);
    const unreadCount = await LinkedInMessage.countDocuments({
      linkedInAccount: account._id,
      messageType: 'incoming',
      isRead: false
    });

    res.json({
      messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching inbox:', error);
    res.status(500).json({ message: 'Error fetching inbox', error: error.message });
  }
});

// Sync inbox
router.post('/accounts/:id/inbox/sync', protect, async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Check last sync (don't sync more than once per 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (account.stats.lastSyncAt && account.stats.lastSyncAt > fiveMinutesAgo) {
      return res.status(429).json({
        message: 'Inbox synced recently. Please wait before syncing again.',
        nextSyncAt: new Date(account.stats.lastSyncAt.getTime() + 5 * 60 * 1000)
      });
    }

    const task = await queueInboxSync(account._id, req.user._id);

    res.json({
      message: 'Inbox sync queued',
      task: {
        _id: task._id,
        status: task.status,
        scheduledFor: task.scheduledFor
      }
    });
  } catch (error) {
    console.error('Error syncing inbox:', error);
    res.status(500).json({ message: 'Error syncing inbox', error: error.message });
  }
});

// Get conversation messages
router.get('/accounts/:id/conversations/:conversationId', protect, async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const messages = await LinkedInMessage.find({
      linkedInAccount: account._id,
      conversationId: req.params.conversationId
    }).sort({ timestamp: 1 });

    res.json({ messages });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ message: 'Error fetching conversation', error: error.message });
  }
});

// Send single reply
router.post('/accounts/:id/messages/reply', protect, async (req, res) => {
  try {
    const { conversationId, messageText } = req.body;

    if (!conversationId || !messageText) {
      return res.status(400).json({ message: 'Missing conversationId or messageText' });
    }

    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    if (!account.canSendMessage()) {
      return res.status(429).json({ message: 'Daily message limit reached' });
    }

    const task = await queueMessageReply(account._id, req.user._id, conversationId, messageText);

    res.json({
      message: 'Reply queued',
      task: {
        _id: task._id,
        status: task.status,
        scheduledFor: task.scheduledFor
      }
    });
  } catch (error) {
    console.error('Error queuing reply:', error);
    res.status(500).json({ message: 'Error queuing reply', error: error.message });
  }
});

// Bulk reply
router.post('/accounts/:id/messages/bulk-reply', protect, async (req, res) => {
  try {
    const { conversationIds, messageTemplate, campaignId } = req.body;

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      return res.status(400).json({ message: 'Missing or invalid conversationIds' });
    }

    if (!messageTemplate) {
      return res.status(400).json({ message: 'Missing messageTemplate' });
    }

    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const conversations = conversationIds.map(id => ({ conversationId: id }));
    const tasks = await queueBulkReplies(
      account._id,
      req.user._id,
      conversations,
      messageTemplate,
      campaignId
    );

    res.json({
      message: `${tasks.length} replies queued`,
      tasks: tasks.map(t => ({
        _id: t._id,
        status: t.status,
        scheduledFor: t.scheduledFor
      }))
    });
  } catch (error) {
    console.error('Error queuing bulk replies:', error);
    res.status(500).json({ message: 'Error queuing bulk replies', error: error.message });
  }
});

// AI reply suggestions
router.post('/accounts/:id/messages/ai-suggestions', protect, async (req, res) => {
  try {
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({ message: 'Missing conversationId' });
    }

    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Get conversation history
    const messages = await LinkedInMessage.find({
      linkedInAccount: account._id,
      conversationId
    })
      .sort({ timestamp: -1 })
      .limit(10);

    if (messages.length === 0) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const latestMessage = messages[0];
    const chatHistory = messages.slice(1).reverse().map(msg => ({
      role: msg.messageType === 'incoming' ? 'user' : 'assistant',
      content: msg.messageText
    }));

    // Generate AI suggestions
    const suggestions = [];
    for (let i = 0; i < 3; i++) {
      try {
        const suggestion = await generateAIResponse(
          latestMessage.messageText,
          chatHistory,
          'LinkedIn Helper'
        );
        suggestions.push(suggestion);
      } catch (error) {
        console.error('Error generating AI suggestion:', error);
      }
    }

    res.json({ suggestions });
  } catch (error) {
    console.error('Error generating AI suggestions:', error);
    res.status(500).json({ message: 'Error generating suggestions', error: error.message });
  }
});

// Campaigns
router.get('/campaigns', protect, async (req, res) => {
  try {
    const campaigns = await LinkedInCampaign.find({ user: req.user._id })
      .populate('linkedInAccount', 'linkedInEmail linkedInName')
      .sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ message: 'Error fetching campaigns', error: error.message });
  }
});

router.post('/campaigns', protect, async (req, res) => {
  try {
    const { linkedInAccount, name, type, connectionRequest, followUpMessage, bulkReply } = req.body;

    if (!linkedInAccount || !name || !type) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Verify account belongs to user
    const account = await LinkedInAccount.findOne({
      _id: linkedInAccount,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'LinkedIn account not found' });
    }

    const campaign = await LinkedInCampaign.create({
      user: req.user._id,
      linkedInAccount,
      name,
      type,
      connectionRequest: connectionRequest || undefined,
      followUpMessage: followUpMessage || undefined,
      bulkReply: bulkReply || undefined,
      status: 'draft'
    });

    res.status(201).json(campaign);
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ message: 'Error creating campaign', error: error.message });
  }
});

router.post('/campaigns/:id/start', protect, async (req, res) => {
  try {
    const campaign = await LinkedInCampaign.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    if (campaign.status !== 'draft') {
      return res.status(400).json({ message: 'Campaign can only be started from draft status' });
    }

    campaign.status = 'active';
    campaign.startedAt = new Date();
    await campaign.save();

    // Queue tasks based on campaign type
    if (campaign.type === 'connection_request' && campaign.connectionRequest) {
      const tasks = await queueConnectionCampaign(
        campaign.linkedInAccount,
        req.user._id,
        campaign.connectionRequest.profileUrls,
        campaign.connectionRequest.messageTemplate,
        campaign._id,
        {
          min: campaign.connectionRequest.delayRange.min * 1000,
          max: campaign.connectionRequest.delayRange.max * 1000
        }
      );
      campaign.stats.total = tasks.length;
      campaign.stats.pending = tasks.length;
      await campaign.save();
    } else if (campaign.type === 'bulk_reply' && campaign.bulkReply) {
      const conversations = campaign.bulkReply.conversationIds.map(id => ({ conversationId: id }));
      const tasks = await queueBulkReplies(
        campaign.linkedInAccount,
        req.user._id,
        conversations,
        campaign.bulkReply.messageTemplate,
        campaign._id
      );
      campaign.stats.total = tasks.length;
      campaign.stats.pending = tasks.length;
      await campaign.save();
    }

    res.json({
      message: 'Campaign started',
      campaign
    });
  } catch (error) {
    console.error('Error starting campaign:', error);
    res.status(500).json({ message: 'Error starting campaign', error: error.message });
  }
});

router.post('/campaigns/:id/pause', protect, async (req, res) => {
  try {
    const campaign = await LinkedInCampaign.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    if (campaign.status !== 'active') {
      return res.status(400).json({ message: 'Campaign is not active' });
    }

    campaign.status = 'paused';
    await campaign.save();

    res.json({ message: 'Campaign paused', campaign });
  } catch (error) {
    console.error('Error pausing campaign:', error);
    res.status(500).json({ message: 'Error pausing campaign', error: error.message });
  }
});

router.post('/campaigns/:id/stop', protect, async (req, res) => {
  try {
    const campaign = await LinkedInCampaign.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    campaign.status = 'stopped';
    await campaign.save();

    // Cancel pending tasks
    await LinkedInTask.updateMany(
      {
        campaign: campaign._id,
        status: { $in: ['pending', 'processing'] }
      },
      {
        status: 'cancelled'
      }
    );

    res.json({ message: 'Campaign stopped', campaign });
  } catch (error) {
    console.error('Error stopping campaign:', error);
    res.status(500).json({ message: 'Error stopping campaign', error: error.message });
  }
});

// Templates
router.get('/templates', protect, async (req, res) => {
  try {
    const { type } = req.query;
    const query = { user: req.user._id };
    if (type) {
      query.type = type;
    }
    const templates = await LinkedInTemplate.find(query).sort({ createdAt: -1 });
    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ message: 'Error fetching templates', error: error.message });
  }
});

router.post('/templates', protect, async (req, res) => {
  try {
    const { name, type, content, variables } = req.body;

    if (!name || !type || !content) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const template = await LinkedInTemplate.create({
      user: req.user._id,
      name,
      type,
      content,
      variables: variables || []
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ message: 'Error creating template', error: error.message });
  }
});

router.put('/templates/:id', protect, async (req, res) => {
  try {
    const template = await LinkedInTemplate.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }

    const { name, content, variables } = req.body;
    if (name) template.name = name;
    if (content) template.content = content;
    if (variables) template.variables = variables;

    await template.save();
    res.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ message: 'Error updating template', error: error.message });
  }
});

router.delete('/templates/:id', protect, async (req, res) => {
  try {
    const template = await LinkedInTemplate.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }

    await LinkedInTemplate.deleteOne({ _id: template._id });
    res.json({ message: 'Template deleted' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ message: 'Error deleting template', error: error.message });
  }
});

// Logs
router.get('/accounts/:id/logs', protect, async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const { page = 1, limit = 50, action, status } = req.query;
    const skip = (page - 1) * limit;

    const query = { linkedInAccount: account._id };
    if (action) query.action = action;
    if (status) query.status = status;

    const logs = await LinkedInLog.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await LinkedInLog.countDocuments(query);

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ message: 'Error fetching logs', error: error.message });
  }
});

// Tasks
router.get('/accounts/:id/tasks', protect, async (req, res) => {
  try {
    const account = await LinkedInAccount.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const { status, type, page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    const query = { linkedInAccount: account._id };
    if (status) query.status = status;
    if (type) query.type = type;

    const tasks = await LinkedInTask.find(query)
      .sort({ scheduledFor: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await LinkedInTask.countDocuments(query);

    res.json({
      tasks,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ message: 'Error fetching tasks', error: error.message });
  }
});

module.exports = router;

