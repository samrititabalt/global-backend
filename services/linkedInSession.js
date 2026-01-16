const { chromium } = require('playwright');
const crypto = require('crypto');

// Store active browser sessions
const activeSessions = new Map();

/**
 * Create a new browser session for user to log in
 * Returns a session ID and browser URL for user to access
 */
async function createLoginSession(userId, accountId = null) {
  const sessionId = crypto.randomBytes(16).toString('hex');
  
  // Determine if we should use headless or visible browser
  // For local development: visible, for production: headless with remote debugging
  const isProduction = process.env.NODE_ENV === 'production';
  const useHeadless = isProduction && !process.env.ENABLE_VISIBLE_BROWSER;
  
  // Launch browser
  const browser = await chromium.launch({
    headless: useHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=9222' // Fixed port for remote access
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  
  // Navigate to LinkedIn login
  await page.goto('https://www.linkedin.com/login', {
    waitUntil: 'networkidle'
  });

  // Store session info
  activeSessions.set(sessionId, {
    userId,
    accountId,
    browser,
    context,
    page,
    status: 'waiting_login',
    createdAt: new Date(),
    cookies: null
  });

  // Monitor for successful login
  monitorLogin(sessionId, page);

  // Get remote debugging URL if headless
  let remoteUrl = null;
  if (useHeadless) {
    // For headless, provide remote debugging URL
    const serverUrl = process.env.SERVER_URL || 'http://localhost:5000';
    remoteUrl = `${serverUrl}/browser/${sessionId}`;
  }

  return {
    sessionId,
    loginUrl: 'https://www.linkedin.com/login',
    remoteUrl,
    isHeadless: useHeadless,
    instructions: useHeadless 
      ? 'Browser session started. Please access the remote browser URL to log in.'
      : 'Browser window opened. Please log in to LinkedIn in that window. Once logged in, the session will be automatically captured.'
  };
}

/**
 * Monitor page for successful login
 */
async function monitorLogin(sessionId, page) {
  try {
    // Wait for navigation away from login page (indicates successful login)
    await page.waitForFunction(() => {
      return !window.location.href.includes('/login') && 
             document.cookie.includes('li_at');
    }, { timeout: 300000 }); // 5 minute timeout

    // Get cookies after login
    const cookies = await page.context().cookies();
    const liAtCookie = cookies.find(c => c.name === 'li_at');
    const jSessionCookie = cookies.find(c => c.name === 'JSESSIONID');

    if (liAtCookie && jSessionCookie) {
      const session = activeSessions.get(sessionId);
      if (session) {
        session.cookies = {
          li_at: liAtCookie.value,
          JSESSIONID: jSessionCookie.value
        };
        session.status = 'logged_in';
        session.loggedInAt = new Date();
        
        // Get user profile info
        try {
          await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'networkidle' });
          const profileInfo = await page.evaluate(() => {
            const nameEl = document.querySelector('[data-testid="nav-profile"]') || 
                          document.querySelector('a[href*="/in/"]');
            return {
              name: nameEl?.textContent?.trim() || 'LinkedIn User',
              profileUrl: nameEl?.href || window.location.href
            };
          });
          session.profileInfo = profileInfo;
        } catch (e) {
          console.error('Error getting profile info:', e);
        }
      }
    }
  } catch (error) {
    const session = activeSessions.get(sessionId);
    if (session) {
      session.status = 'error';
      session.error = error.message;
    }
  }
}

/**
 * Get session status
 */
function getSessionStatus(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return { exists: false };
  }

  return {
    exists: true,
    status: session.status,
    cookies: session.cookies ? 'captured' : null,
    profileInfo: session.profileInfo,
    error: session.error
  };
}

/**
 * Get cookies from session (after login)
 */
function getSessionCookies(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session || !session.cookies) {
    return null;
  }
  return session.cookies;
}

/**
 * Close session and cleanup
 */
async function closeSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    try {
      await session.browser.close();
    } catch (e) {
      console.error('Error closing browser:', e);
    }
    activeSessions.delete(sessionId);
  }
}

/**
 * Get or create browser context for automation (after login)
 */
async function getAutomationContext(account, proxy = null) {
  const contextKey = `${account.userId}_${account._id}`;
  
  // Check if we have an active session for this account
  for (const [sessionId, session] of activeSessions.entries()) {
    if (session.accountId?.toString() === account._id.toString() && 
        session.status === 'logged_in') {
      return session.context;
    }
  }

  // If no active session, create new context with stored cookies
  // (This is fallback for cookie-based accounts)
  if (account.connectionMethod === 'cookies' && account.encryptedLiAt) {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const contextOptions = {
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    if (proxy) {
      contextOptions.proxy = {
        server: `${proxy.type}://${proxy.host}:${proxy.port}`,
        username: proxy.username,
        password: proxy.password
      };
    }

    const context = await browser.newContext(contextOptions);
    const cookies = account.getCookies();
    
    if (cookies && cookies.li_at && cookies.JSESSIONID) {
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
    }

    return context;
  }

  throw new Error('No active session or cookies available');
}

/**
 * Cleanup old sessions (older than 1 hour)
 */
function cleanupOldSessions() {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [sessionId, session] of activeSessions.entries()) {
    if (session.createdAt.getTime() < oneHourAgo) {
      closeSession(sessionId).catch(console.error);
    }
  }
}

// Cleanup old sessions every 30 minutes
setInterval(cleanupOldSessions, 30 * 60 * 1000);

module.exports = {
  createLoginSession,
  getSessionStatus,
  getSessionCookies,
  closeSession,
  getAutomationContext,
  activeSessions
};

