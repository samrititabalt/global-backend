const { mail } = require('./sendEmail');

/**
 * Send alert email to all agents when customer tries to chat but all agents are offline
 * @param {Array<string>} agentEmails - Array of agent email addresses
 * @param {Object} customerDetails - Customer information
 * @param {string} customerDetails.name - Customer name
 * @param {string} customerDetails.customerId - Customer ID
 * @param {Date} customerDetails.timestamp - Timestamp when customer tried to start chat
 * @returns {Promise<{success: boolean, sent: number, failed: number, errors?: Array}>}
 */
const sendAgentAlertEmail = async (agentEmails, customerDetails) => {
  if (!agentEmails || agentEmails.length === 0) {
    return { success: false, sent: 0, failed: 0, error: 'No agent emails provided' };
  }

  const { name, customerId, timestamp } = customerDetails;
  const formattedTimestamp = new Date(timestamp).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });

  const subject = 'Customer Waiting – Please Log In';
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Customer Waiting Alert</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #333333;
          background-color: #f4f4f4;
        }
        .email-container {
          max-width: 600px;
          margin: 0 auto;
          background-color: #ffffff;
        }
        .header {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: #ffffff;
          padding: 40px 20px;
          text-align: center;
        }
        .header h1 {
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 10px;
        }
        .content {
          padding: 40px 30px;
          background-color: #ffffff;
        }
        .alert-box {
          background-color: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 20px;
          margin: 20px 0;
          border-radius: 4px;
        }
        .alert-box h2 {
          color: #856404;
          font-size: 20px;
          margin-bottom: 15px;
        }
        .info-section {
          background-color: #f8f9fa;
          border-radius: 8px;
          padding: 25px;
          margin: 25px 0;
        }
        .info-item {
          margin-bottom: 15px;
          padding-bottom: 15px;
          border-bottom: 1px solid #dee2e6;
        }
        .info-item:last-child {
          border-bottom: none;
          margin-bottom: 0;
          padding-bottom: 0;
        }
        .info-label {
          font-weight: 600;
          color: #495057;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 5px;
        }
        .info-value {
          font-size: 18px;
          color: #212529;
          font-weight: 500;
        }
        .customer-id {
          font-family: 'Courier New', monospace;
          color: #007bff;
          font-weight: 600;
        }
        .message {
          font-size: 16px;
          color: #666666;
          margin: 25px 0;
          line-height: 1.8;
        }
        .button-container {
          text-align: center;
          margin: 35px 0;
        }
        .login-button {
          display: inline-block;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #ffffff;
          text-decoration: none;
          padding: 15px 40px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 16px;
          transition: transform 0.2s;
        }
        .login-button:hover {
          transform: translateY(-2px);
        }
        .footer {
          background-color: #f8f9fa;
          padding: 30px;
          text-align: center;
          color: #666666;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <h1>🚨 Customer Waiting Alert</h1>
          <p style="margin-top: 10px; opacity: 0.9;">Immediate Action Required</p>
        </div>
        <div class="content">
          <div class="alert-box">
            <h2>⚠️ All Agents Are Currently Offline</h2>
            <p style="color: #856404; margin: 0;">
              A customer is trying to start a chat. Please log in to respond immediately.
            </p>
          </div>

          <div class="info-section">
            <div class="info-item">
              <div class="info-label">Customer Name</div>
              <div class="info-value">${name || 'N/A'}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Customer ID</div>
              <div class="info-value customer-id">${customerId || 'N/A'}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Timestamp</div>
              <div class="info-value">${formattedTimestamp}</div>
            </div>
          </div>

          <p class="message">
            A customer has attempted to initiate a chat session, but no agents are currently online to assist them. 
            Please log in to your agent portal as soon as possible to provide support.
          </p>

          <div class="button-container">
            <a href="${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/agent/login" class="login-button">
              Log In to Agent Portal
            </a>
          </div>

          <p class="message" style="margin-top: 30px; font-size: 14px; color: #999;">
            This is an automated alert. Please ensure you are available to assist customers during your scheduled hours.
          </p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Tabalt Ltd. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  let sent = 0;
  let failed = 0;
  const errors = [];

  // Send email to all agents
  for (const email of agentEmails) {
    try {
      const result = await mail(email, subject, html);
      if (result.success) {
        sent++;
      } else {
        failed++;
        errors.push({ email, error: result.error || 'Unknown error' });
      }
    } catch (error) {
      failed++;
      errors.push({ email, error: error.message || 'Unknown error' });
    }
  }

  return {
    success: sent > 0,
    sent,
    failed,
    total: agentEmails.length,
    ...(errors.length > 0 && { errors })
  };
};

module.exports = { sendAgentAlertEmail };

