const User = require('../models/User');
const Service = require('../models/Service');
const { mail } = require('../utils/sendEmail');

/**
 * Find agents registered for a specific service
 */
const findAgentsForService = async (serviceId) => {
  try {
    // Find agents with matching service category
    const agents = await User.find({
      role: 'agent',
      serviceCategory: serviceId,
      isActive: true
    }).select('name email phone serviceCategory');

    return agents;
  } catch (error) {
    console.error('Error finding agents for service:', error);
    return [];
  }
};

/**
 * Send email notification to agents
 */
const sendEmailNotification = async (agents, chatData) => {
  const { customerName, serviceName, chatSessionId, timestamp } = chatData;
  const frontendUrl = process.env.FRONTEND_URL || 'https://mainproduct.vercel.app';
  const chatLink = `${frontendUrl}/agent/chat/${chatSessionId}`;

  const emailPromises = agents.map(async (agent) => {
    if (!agent.email) return;

    const subject = `New Customer Request – ${serviceName}`;
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Customer Request</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f4f4f4;
          }
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #ffffff;
            padding: 30px 20px;
            text-align: center;
          }
          .header h1 {
            font-size: 24px;
            font-weight: 600;
          }
          .content {
            padding: 30px;
          }
          .alert-box {
            background-color: #e3f2fd;
            border-left: 4px solid #2196F3;
            padding: 20px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .info-row {
            margin: 15px 0;
            padding: 10px 0;
            border-bottom: 1px solid #e0e0e0;
          }
          .info-label {
            font-weight: 600;
            color: #666;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
          }
          .info-value {
            font-size: 16px;
            color: #333;
          }
          .button-container {
            text-align: center;
            margin: 30px 0;
          }
          .chat-button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #ffffff;
            text-decoration: none;
            padding: 15px 40px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 16px;
          }
          .footer {
            background-color: #f8f9fa;
            padding: 20px;
            text-align: center;
            color: #666;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>New Customer Request</h1>
          </div>
          <div class="content">
            <div class="alert-box">
              <p style="font-size: 16px; margin: 0;"><strong>A new customer needs assistance!</strong></p>
            </div>
            
            <div class="info-row">
              <div class="info-label">Customer Name</div>
              <div class="info-value">${customerName}</div>
            </div>
            
            <div class="info-row">
              <div class="info-label">Service</div>
              <div class="info-value">${serviceName}</div>
            </div>
            
            <div class="info-row">
              <div class="info-label">Request Time</div>
              <div class="info-value">${new Date(timestamp).toLocaleString()}</div>
            </div>

            <div class="button-container">
              <a href="${chatLink}" class="chat-button">Join Chat Now</a>
            </div>

            <p style="color: #666; font-size: 14px; margin-top: 20px;">
              Click the button above to join the chat and assist the customer. The customer is waiting for an agent to respond.
            </p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} GlobalCare Support System. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await mail(agent.email, subject, html);
      console.log(`Email notification sent to agent: ${agent.email}`);
    } catch (error) {
      console.error(`Error sending email to ${agent.email}:`, error);
    }
  });

  await Promise.all(emailPromises);
};


/**
 * Notify agents about new chat session
 */
const notifyAgentsForNewChat = async (chatSessionId, serviceId, customerName) => {
  try {
    // Get service details
    const service = await Service.findById(serviceId);
    if (!service) {
      console.error('Service not found for notification');
      return;
    }

    // Find agents for this service
    const agents = await findAgentsForService(serviceId);

    if (agents.length === 0) {
      console.log(`No agents found for service: ${service.name}`);
      return;
    }

    const chatData = {
      customerName: customerName || 'Customer',
      serviceName: service.name,
      chatSessionId: chatSessionId.toString(),
      timestamp: new Date()
    };

    // Send email notifications
    await sendEmailNotification(agents, chatData);

    console.log(`Email notifications sent to ${agents.length} agent(s) for service: ${service.name}`);
  } catch (error) {
    console.error('Error notifying agents:', error);
  }
};

/**
 * Notify all agents of a new AI-driven customer request (SOW)
 */
const notifyAllAgentsOfNewRequest = async (requestId, customerName, sow) => {
  try {
    const agents = await User.find({ role: 'agent', isActive: true }).select('name email');
    if (agents.length === 0) {
      console.log('No agents to notify for new request');
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://mainproduct.vercel.app';
    const dashboardLink = `${frontendUrl}/agent`;

    const title = (sow && sow.title) || 'Service Request';
    const summary = (sow && sow.summary) || '';
    const timeline = (sow && sow.timeline) || 'TBD';
    const budgetMinutes = (sow && sow.budgetMinutes) != null ? sow.budgetMinutes : '';

    const emailPromises = agents.map(async (agent) => {
      if (!agent.email) return;
      const subject = `New Request – ${title}`;
      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { padding: 20px; border: 1px solid #e0e0e0; border-top: none; }
          .row { margin: 12px 0; }
          .label { font-weight: 600; color: #666; font-size: 12px; text-transform: uppercase; }
          .value { margin-top: 4px; }
          .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px; }
        </style></head>
        <body>
          <div class="container">
            <div class="header"><h2 style="margin:0;">New Customer Request (SOW)</h2></div>
            <div class="content">
              <p><strong>Customer:</strong> ${customerName || 'Customer'}</p>
              <div class="row"><span class="label">Title</span><div class="value">${title}</div></div>
              <div class="row"><span class="label">Summary</span><div class="value">${summary || '—'}</div></div>
              <div class="row"><span class="label">Timeline</span><div class="value">${timeline}</div></div>
              <div class="row"><span class="label">Budget (minutes)</span><div class="value">${budgetMinutes}</div></div>
              <a href="${dashboardLink}" class="button">Open Agent Dashboard</a>
            </div>
          </div>
        </body>
        </html>
      `;
      try {
        await mail(agent.email, subject, html);
      } catch (err) {
        console.error(`Error emailing agent ${agent.email}:`, err);
      }
    });

    await Promise.all(emailPromises);
    console.log(`SOW notification sent to ${agents.length} agent(s) for request ${requestId}`);
  } catch (error) {
    console.error('Error notifying agents of new request:', error);
  }
};

module.exports = {
  notifyAgentsForNewChat,
  notifyAllAgentsOfNewRequest,
  findAgentsForService,
  sendEmailNotification
};

