const { chromium } = require('playwright');
const LinkedInAccount = require('../models/LinkedInAccount');
const LinkedInMessage = require('../models/LinkedInMessage');
const LinkedInLog = require('../models/LinkedInLog');
const LinkedInTask = require('../models/LinkedInTask');

// Store browser instances per account
const browserInstances = new Map();

// Human-like delay function
const humanDelay = (min = 1000, max = 3000) => {
  return new Promise(resolve => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    setTimeout(resolve, delay);
  });
};

// Type text character by character (human-like)
const humanType = async (page, selector, text, options = {}) => {
  const { minDelay = 50, maxDelay = 150 } = options;
  await page.click(selector);
  await humanDelay(200, 500);
  
  for (const char of text) {
    await page.type(selector, char, { delay: Math.random() * (maxDelay - minDelay) + minDelay });
  }
};

// Random mouse movement
const randomMouseMove = async (page) => {
  const x = Math.random() * 100;
  const y = Math.random() * 100;
  await page.mouse.move(x, y);
  await humanDelay(100, 300);
};

// Check for CAPTCHA
const checkCaptcha = async (page) => {
  try {
    const captchaSelectors = [
      'iframe[src*="captcha"]',
      '.captcha',
      '#captcha',
      '[data-testid*="captcha"]',
      'text=/challenge/i'
    ];
    
    for (const selector of captchaSelectors) {
      const element = await page.$(selector);
      if (element) {
        return true;
      }
    }
    
    // Check for CAPTCHA text in page
    const pageText = await page.textContent('body');
    if (pageText && /captcha|challenge|verify/i.test(pageText)) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
};

// Check for LinkedIn warnings
const checkWarning = async (page) => {
  try {
    const warningSelectors = [
      '[data-testid*="warning"]',
      '.warning',
      'text=/unusual activity/i',
      'text=/suspicious/i',
      'text=/temporarily restricted/i'
    ];
    
    for (const selector of warningSelectors) {
      const element = await page.$(selector);
      if (element) {
        const text = await element.textContent();
        return { detected: true, message: text };
      }
    }
    
    return { detected: false };
  } catch (error) {
    return { detected: false };
  }
};

// Get or create browser instance for account
const getBrowserInstance = async (accountId) => {
  if (browserInstances.has(accountId)) {
    return browserInstances.get(accountId);
  }

  const account = await LinkedInAccount.findById(accountId);
  if (!account) {
    throw new Error('LinkedIn account not found');
  }

  const cookies = account.getCookies();
  if (!cookies.li_at || !cookies.JSESSIONID) {
    throw new Error('LinkedIn cookies not found');
  }

  // TODO: Configure proxy if available
  const proxyConfig = account.proxy?.host ? {
    server: `${account.proxy.type}://${account.proxy.host}:${account.proxy.port}`,
    username: account.proxy.username,
    password: account.proxy.password
  } : undefined;

  const browser = await chromium.launch({
    headless: true, // Run in background
    proxy: proxyConfig
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York'
  });

  // Set cookies
  await context.addCookies([
    {
      name: 'li_at',
      value: cookies.li_at,
      domain: '.linkedin.com',
      path: '/'
    },
    {
      name: 'JSESSIONID',
      value: cookies.JSESSIONID,
      domain: '.linkedin.com',
      path: '/'
    }
  ]);

  const instance = {
    browser,
    context,
    accountId,
    lastUsed: Date.now()
  };

  browserInstances.set(accountId, instance);
  return instance;
};

// Close browser instance
const closeBrowserInstance = async (accountId) => {
  if (browserInstances.has(accountId)) {
    const instance = browserInstances.get(accountId);
    await instance.browser.close();
    browserInstances.delete(accountId);
  }
};

// Sync inbox
const syncInbox = async (accountId) => {
  const account = await LinkedInAccount.findById(accountId);
  if (!account) {
    throw new Error('LinkedIn account not found');
  }

  const instance = await getBrowserInstance(accountId);
  const page = await instance.context.newPage();

  try {
    // Check for CAPTCHA or warnings first
    await page.goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await humanDelay(2000, 4000);

    const hasCaptcha = await checkCaptcha(page);
    if (hasCaptcha) {
      await LinkedInLog.create({
        user: account.user,
        linkedInAccount: accountId,
        action: 'captcha_detected',
        status: 'warning',
        message: 'CAPTCHA detected during inbox sync',
        details: {}
      });
      
      account.status = 'warning';
      account.lastError = {
        message: 'CAPTCHA detected',
        timestamp: new Date(),
        type: 'captcha'
      };
      await account.save();
      
      throw new Error('CAPTCHA detected');
    }

    const warning = await checkWarning(page);
    if (warning.detected) {
      await LinkedInLog.create({
        user: account.user,
        linkedInAccount: accountId,
        action: 'warning_received',
        status: 'warning',
        message: warning.message || 'LinkedIn warning detected',
        details: {}
      });
      
      account.status = 'warning';
      account.lastError = {
        message: warning.message || 'LinkedIn warning',
        timestamp: new Date(),
        type: 'warning'
      };
      await account.save();
      
      throw new Error('LinkedIn warning detected');
    }

    // Scroll to load conversations
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await humanDelay(2000, 3000);

    // Extract conversations
    const conversations = await page.evaluate(() => {
      const conversationElements = document.querySelectorAll('[data-testid*="conversation"]');
      const results = [];
      
      conversationElements.forEach((el, index) => {
        if (index > 20) return; // Limit to first 20 conversations
        
        const nameEl = el.querySelector('[data-testid*="name"]') || el.querySelector('span[dir="ltr"]');
        const messageEl = el.querySelector('[data-testid*="message"]') || el.querySelector('p');
        const timeEl = el.querySelector('time') || el.querySelector('[data-testid*="time"]');
        const linkEl = el.closest('a');
        
        if (nameEl && messageEl) {
          results.push({
            name: nameEl.textContent?.trim() || '',
            message: messageEl.textContent?.trim() || '',
            time: timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '',
            url: linkEl?.href || ''
          });
        }
      });
      
      return results;
    });

    // Save messages to database
    let syncedCount = 0;
    for (const conv of conversations) {
      try {
        const conversationId = conv.url.split('/').pop() || `conv_${Date.now()}_${Math.random()}`;
      
        const existingMessage = await LinkedInMessage.findOne({
          linkedInAccount: accountId,
          conversationId,
          messageText: conv.message
        });

        if (!existingMessage) {
          await LinkedInMessage.create({
            linkedInAccount: accountId,
            user: account.user,
            conversationId,
            conversationUrl: conv.url,
            senderName: conv.name,
            messageText: conv.message,
            messageType: 'incoming',
            timestamp: new Date(conv.time || Date.now()),
            isRead: false
          });
          syncedCount++;
        }
      } catch (error) {
        console.error('Error saving message:', error);
      }
    }

    account.stats.lastSyncAt = new Date();
    await account.save();

    await LinkedInLog.create({
      user: account.user,
      linkedInAccount: accountId,
      action: 'inbox_synced',
      status: 'success',
      message: `Synced ${syncedCount} new messages`,
      details: { syncedCount, totalConversations: conversations.length }
    });

    return { syncedCount, totalConversations: conversations.length };
  } catch (error) {
    await LinkedInLog.create({
      user: account.user,
      linkedInAccount: accountId,
      action: 'error_occurred',
      status: 'failure',
      message: error.message,
      details: { error: error.toString() }
    });
    throw error;
  } finally {
    await page.close();
  }
};

// Send message reply
const sendMessageReply = async (accountId, conversationId, messageText) => {
  const account = await LinkedInAccount.findById(accountId);
  if (!account) {
    throw new Error('LinkedIn account not found');
  }

  if (!account.canSendMessage()) {
    throw new Error('Daily message limit reached');
  }

  if (!account.isWithinWorkingHours()) {
    throw new Error('Outside working hours');
  }

  const instance = await getBrowserInstance(accountId);
  const page = await instance.context.newPage();

  try {
    const conversationUrl = `https://www.linkedin.com/messaging/${conversationId}/`;
    await page.goto(conversationUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await humanDelay(2000, 4000);
    await randomMouseMove(page);

    // Check for CAPTCHA/warnings
    const hasCaptcha = await checkCaptcha(page);
    if (hasCaptcha) {
      throw new Error('CAPTCHA detected');
    }

    const warning = await checkWarning(page);
    if (warning.detected) {
      throw new Error('LinkedIn warning detected');
    }

    // Find message input
    const messageInputSelector = 'div[contenteditable="true"][data-testid*="message"]';
    await page.waitForSelector(messageInputSelector, { timeout: 10000 });

    // Type message
    await humanType(page, messageInputSelector, messageText);

    await humanDelay(1000, 2000);

    // Click send button
    const sendButton = await page.$('button[data-testid*="send"]');
    if (!sendButton) {
      throw new Error('Send button not found');
    }

    await sendButton.click();
    await humanDelay(2000, 4000);

    // Update stats
    account.stats.messagesSentToday += 1;
    account.stats.lastMessageSentAt = new Date();
    await account.save();

    await LinkedInLog.create({
      user: account.user,
      linkedInAccount: accountId,
      action: 'message_sent',
      status: 'success',
      message: `Message sent to conversation ${conversationId}`,
      details: { conversationId, messageLength: messageText.length }
    });

    return { success: true };
  } catch (error) {
    await LinkedInLog.create({
      user: account.user,
      linkedInAccount: accountId,
      action: 'error_occurred',
      status: 'failure',
      message: `Failed to send message: ${error.message}`,
      details: { error: error.toString(), conversationId }
    });
    throw error;
  } finally {
    await page.close();
  }
};

// Send connection request
const sendConnectionRequest = async (accountId, profileUrl, message) => {
  const account = await LinkedInAccount.findById(accountId);
  if (!account) {
    throw new Error('LinkedIn account not found');
  }

  if (!account.canSendConnection()) {
    throw new Error('Daily connection limit reached');
  }

  if (!account.isWithinWorkingHours()) {
    throw new Error('Outside working hours');
  }

  const instance = await getBrowserInstance(accountId);
  const page = await instance.context.newPage();

  try {
    await page.goto(profileUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await humanDelay(2000, 4000);
    await randomMouseMove(page);

    // Check for CAPTCHA/warnings
    const hasCaptcha = await checkCaptcha(page);
    if (hasCaptcha) {
      throw new Error('CAPTCHA detected');
    }

    const warning = await checkWarning(page);
    if (warning.detected) {
      throw new Error('LinkedIn warning detected');
    }

    // Find Connect button
    const connectButton = await page.$('button:has-text("Connect")');
    if (!connectButton) {
      // Check if already connected
      const connectedText = await page.$('text=/Connected|Message/i');
      if (connectedText) {
        throw new Error('Already connected');
      }
      throw new Error('Connect button not found');
    }

    await connectButton.click();
    await humanDelay(1000, 2000);

    // If message input appears, type message
    const messageInput = await page.$('textarea[placeholder*="message"]');
    if (messageInput && message) {
      await humanType(page, 'textarea[placeholder*="message"]', message);
      await humanDelay(1000, 2000);
    }

    // Click Send now or Add a note
    const sendButton = await page.$('button:has-text("Send")');
    if (sendButton) {
      await sendButton.click();
      await humanDelay(2000, 4000);
    }

    // Update stats
    account.stats.connectionsSentToday += 1;
    account.stats.lastConnectionSentAt = new Date();
    await account.save();

    await LinkedInLog.create({
      user: account.user,
      linkedInAccount: accountId,
      action: 'connection_sent',
      status: 'success',
      message: `Connection request sent to ${profileUrl}`,
      details: { profileUrl }
    });

    return { success: true };
  } catch (error) {
    await LinkedInLog.create({
      user: account.user,
      linkedInAccount: accountId,
      action: 'error_occurred',
      status: 'failure',
      message: `Failed to send connection: ${error.message}`,
      details: { error: error.toString(), profileUrl }
    });
    throw error;
  } finally {
    await page.close();
  }
};

module.exports = {
  getBrowserInstance,
  closeBrowserInstance,
  syncInbox,
  sendMessageReply,
  sendConnectionRequest,
  checkCaptcha,
  checkWarning,
  humanDelay
};

