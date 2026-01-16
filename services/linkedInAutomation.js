const { getAutomationContext } = require('./linkedInSession');

/**
 * Get browser context for automation
 * Uses active session if available, otherwise falls back to stored cookies
 */
async function getBrowserContext(account, proxy = null) {
  return await getAutomationContext(account, proxy);
}

/**
 * Human-like delay with randomization
 */
function randomDelay(minMs = 1000, maxMs = 3000) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Human-like mouse movement
 */
async function humanMouseMove(page, fromX, fromY, toX, toY) {
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const x = fromX + (toX - fromX) * (i / steps);
    const y = fromY + (toY - fromY) * (i / steps);
    await page.mouse.move(x, y);
    await randomDelay(10, 30);
  }
}

/**
 * Human-like typing (character by character)
 */
async function humanType(page, selector, text, options = {}) {
  const { delayMin = 50, delayMax = 150 } = options;
  await page.click(selector);
  await randomDelay(200, 500);
  
  for (const char of text) {
    await page.keyboard.type(char, { delay: Math.random() * (delayMax - delayMin) + delayMin });
    // Occasionally add extra delay
    if (Math.random() < 0.1) {
      await randomDelay(200, 500);
    }
  }
}

/**
 * Human-like scroll
 */
async function humanScroll(page, direction = 'down', distance = 300) {
  const steps = Math.floor(distance / 50);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, direction === 'down' ? 50 : -50);
    await randomDelay(100, 300);
  }
}

/**
 * Check for CAPTCHA
 */
async function detectCaptcha(page) {
  try {
    const captchaSelectors = [
      'iframe[src*="captcha"]',
      '.captcha',
      '#captcha',
      '[data-testid*="captcha"]',
      'text=/verify you.*human/i'
    ];
    
    for (const selector of captchaSelectors) {
      const element = await page.$(selector);
      if (element) {
        return true;
      }
    }
    
    const pageText = await page.textContent('body');
    if (pageText && /captcha|verify.*human|robot/i.test(pageText)) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Check for LinkedIn warnings
 */
async function detectWarning(page) {
  try {
    const warningSelectors = [
      'text=/unusual activity/i',
      'text=/suspicious activity/i',
      'text=/account.*restricted/i',
      'text=/temporarily.*limited/i',
      '[data-testid*="warning"]'
    ];
    
    for (const selector of warningSelectors) {
      const element = await page.$(selector);
      if (element) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Sync LinkedIn inbox
 */
async function syncInbox(account) {
  const context = await getBrowserContext(account, account.proxy);
  const page = await context.newPage();
  
  try {
    await page.goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await randomDelay(2000, 4000);

    // Check for CAPTCHA or warnings
    if (await detectCaptcha(page)) {
      throw new Error('CAPTCHA detected');
    }
    if (await detectWarning(page)) {
      throw new Error('LinkedIn warning detected');
    }

    // Wait for conversations to load
    await page.waitForSelector('[data-testid*="conversation"]', { timeout: 10000 }).catch(() => {});
    
    // Scroll to load more conversations
    await humanScroll(page, 'down', 500);
    await randomDelay(1000, 2000);

    // Extract conversations
    const conversations = await page.evaluate(() => {
      const items = [];
      const conversationElements = document.querySelectorAll('[data-testid*="conversation"]');
      
      conversationElements.forEach((el, index) => {
        if (index >= 20) return; // Limit to 20 conversations per sync
        
        const nameEl = el.querySelector('[data-testid*="name"]') || el.querySelector('span[dir="ltr"]');
        const messageEl = el.querySelector('[data-testid*="message"]') || el.querySelector('span[class*="message"]');
        const timeEl = el.querySelector('time') || el.querySelector('[data-testid*="time"]');
        
        const conversationId = el.getAttribute('data-conversation-id') || 
                              el.getAttribute('href')?.match(/\/messaging\/thread\/([^\/]+)/)?.[1] ||
                              `conv_${index}`;
        
        items.push({
          conversationId,
          senderName: nameEl?.textContent?.trim() || 'Unknown',
          lastMessage: messageEl?.textContent?.trim() || '',
          timestamp: timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || new Date().toISOString()
        });
      });
      
      return items;
    });

    // For each conversation, get messages
    const messages = [];
    for (const conv of conversations.slice(0, 10)) { // Limit to 10 conversations
      try {
        await page.goto(`https://www.linkedin.com/messaging/thread/${conv.conversationId}/`, {
          waitUntil: 'networkidle',
          timeout: 15000
        });
        
        await randomDelay(2000, 3000);
        
        const convMessages = await page.evaluate((convId) => {
          const msgs = [];
          const messageElements = document.querySelectorAll('[data-testid*="message"]') || 
                                 document.querySelectorAll('[class*="message"]');
          
          messageElements.forEach((el, index) => {
            if (index >= 50) return; // Limit messages per conversation
            
            const textEl = el.querySelector('span[dir="ltr"]') || el.querySelector('p');
            const senderEl = el.closest('[data-testid*="sender"]') || el.closest('[class*="sender"]');
            const timeEl = el.querySelector('time') || el.querySelector('[data-testid*="time"]');
            
            msgs.push({
              messageId: `msg_${convId}_${index}`,
              text: textEl?.textContent?.trim() || '',
              senderName: senderEl?.querySelector('span')?.textContent?.trim() || 'Unknown',
              timestamp: timeEl?.getAttribute('datetime') || new Date().toISOString()
            });
          });
          
          return msgs;
        }, conv.conversationId);

        messages.push(...convMessages.map(msg => ({
          ...msg,
          conversationId: conv.conversationId
        })));

        await randomDelay(1000, 2000);
      } catch (error) {
        console.error(`Error syncing conversation ${conv.conversationId}:`, error.message);
      }
    }

    return {
      success: true,
      conversations: conversations.length,
      messages: messages.length,
      data: messages
    };
  } catch (error) {
    if (error.message.includes('CAPTCHA') || await detectCaptcha(page)) {
      return { success: false, error: 'CAPTCHA_DETECTED' };
    }
    if (error.message.includes('warning') || await detectWarning(page)) {
      return { success: false, error: 'WARNING_DETECTED' };
    }
    return { success: false, error: error.message };
  } finally {
    await page.close();
  }
}

/**
 * Send a LinkedIn message
 */
async function sendMessage(account, conversationId, messageText) {
  const context = await getBrowserContext(account, account.proxy);
  const page = await context.newPage();
  
  try {
    await page.goto(`https://www.linkedin.com/messaging/thread/${conversationId}/`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await randomDelay(2000, 4000);

    // Check for CAPTCHA or warnings
    if (await detectCaptcha(page)) {
      throw new Error('CAPTCHA detected');
    }
    if (await detectWarning(page)) {
      throw new Error('LinkedIn warning detected');
    }

    // Find message input
    const messageInput = await page.waitForSelector('div[contenteditable="true"][role="textbox"]', { timeout: 10000 });
    
    // Type message slowly
    await humanType(page, 'div[contenteditable="true"][role="textbox"]', messageText);
    
    await randomDelay(500, 1000);
    
    // Find and click send button
    const sendButton = await page.waitForSelector('button[aria-label*="Send"]', { timeout: 5000 });
    const box = await sendButton.boundingBox();
    if (box) {
      await humanMouseMove(page, 0, 0, box.x + box.width / 2, box.y + box.height / 2);
    }
    await randomDelay(200, 500);
    await sendButton.click();
    
    await randomDelay(1000, 2000);
    
    return { success: true };
  } catch (error) {
    if (error.message.includes('CAPTCHA') || await detectCaptcha(page)) {
      return { success: false, error: 'CAPTCHA_DETECTED' };
    }
    if (error.message.includes('warning') || await detectWarning(page)) {
      return { success: false, error: 'WARNING_DETECTED' };
    }
    return { success: false, error: error.message };
  } finally {
    await page.close();
  }
}

/**
 * Send a connection request
 */
async function sendConnectionRequest(account, profileUrl, message = null) {
  const context = await getBrowserContext(account, account.proxy);
  const page = await context.newPage();
  
  try {
    await page.goto(profileUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await randomDelay(2000, 4000);

    // Check for CAPTCHA or warnings
    if (await detectCaptcha(page)) {
      throw new Error('CAPTCHA detected');
    }
    if (await detectWarning(page)) {
      throw new Error('LinkedIn warning detected');
    }

    // Find Connect button
    const connectButton = await page.waitForSelector('button:has-text("Connect")', { timeout: 10000 });
    
    const box = await connectButton.boundingBox();
    if (box) {
      await humanMouseMove(page, 0, 0, box.x + box.width / 2, box.y + box.height / 2);
    }
    await randomDelay(300, 600);
    await connectButton.click();
    
    await randomDelay(1000, 2000);

    // If message provided, add note
    if (message) {
      const addNoteButton = await page.$('button:has-text("Add a note")');
      if (addNoteButton) {
        await addNoteButton.click();
        await randomDelay(500, 1000);
        
        const noteInput = await page.waitForSelector('textarea[placeholder*="note"]', { timeout: 5000 });
        await humanType(page, 'textarea[placeholder*="note"]', message);
        await randomDelay(500, 1000);
      }
    }

    // Click Send
    const sendButton = await page.waitForSelector('button:has-text("Send")', { timeout: 5000 });
    await sendButton.click();
    
    await randomDelay(1000, 2000);
    
    return { success: true };
  } catch (error) {
    if (error.message.includes('CAPTCHA') || await detectCaptcha(page)) {
      return { success: false, error: 'CAPTCHA_DETECTED' };
    }
    if (error.message.includes('warning') || await detectWarning(page)) {
      return { success: false, error: 'WARNING_DETECTED' };
    }
    return { success: false, error: error.message };
  } finally {
    await page.close();
  }
}

/**
 * Close browser context for an account
 */
async function closeBrowserContext(accountId) {
  const contextKey = accountId.toString();
  if (browserContexts.has(contextKey)) {
    const context = browserContexts.get(contextKey);
    await context.close();
    browserContexts.delete(contextKey);
  }
}

module.exports = {
  syncInbox,
  sendMessage,
  sendConnectionRequest,
  getBrowserContext,
  closeBrowserContext,
  detectCaptcha,
  detectWarning
};

