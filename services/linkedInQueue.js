const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const LinkedInTask = require('../models/LinkedInTask');
const LinkedInAccount = require('../models/LinkedInAccount');
const LinkedInCampaign = require('../models/LinkedInCampaign');
const LinkedInMessage = require('../models/LinkedInMessage');
const {
  syncInbox,
  sendMessageReply,
  sendConnectionRequest,
  checkCaptcha,
  checkWarning,
  humanDelay
} = require('./linkedInAutomation');

// TODO: Configure Redis connection
// Set REDIS_URL in .env or use default localhost
const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

// Create queues
const inboxQueue = new Queue('linkedin-inbox', { connection: redisConnection });
const messageQueue = new Queue('linkedin-messages', { connection: redisConnection });
const connectionQueue = new Queue('linkedin-connections', { connection: redisConnection });

// Worker for inbox sync
const inboxWorker = new Worker(
  'linkedin-inbox',
  async (job) => {
    const { accountId } = job.data;
    
    const task = await LinkedInTask.findById(job.data.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    task.status = 'processing';
    task.startedAt = new Date();
    await task.save();

    try {
      const result = await syncInbox(accountId);
      task.status = 'completed';
      task.completedAt = new Date();
      await task.save();
      return result;
    } catch (error) {
      task.status = 'failed';
      task.lastError = {
        message: error.message,
        timestamp: new Date(),
        code: error.code || 'UNKNOWN'
      };
      task.retryCount += 1;
      await task.save();
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // One inbox sync at a time per account
    limiter: {
      max: 1,
      duration: 300000 // Max 1 sync per 5 minutes
    }
  }
);

// Worker for message sending
const messageWorker = new Worker(
  'linkedin-messages',
  async (job) => {
    const { accountId, conversationId, messageText, taskId } = job.data;
    
    const task = await LinkedInTask.findById(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    task.status = 'processing';
    task.startedAt = new Date();
    await task.save();

    try {
      // Check if recipient has replied (stop condition)
      const account = await LinkedInAccount.findById(accountId);
      const latestMessage = await LinkedInMessage.findOne({
        linkedInAccount: accountId,
        conversationId,
        messageType: 'incoming'
      }).sort({ timestamp: -1 });

      if (latestMessage && latestMessage.timestamp > task.createdAt) {
        // Recipient replied, stop sending
        task.status = 'cancelled';
        task.completedAt = new Date();
        await task.save();
        return { cancelled: true, reason: 'Recipient replied' };
      }

      await sendMessageReply(accountId, conversationId, messageText);

      // Update message as replied
      await LinkedInMessage.updateMany(
        {
          linkedInAccount: accountId,
          conversationId,
          isReplied: false
        },
        {
          isReplied: true,
          replySentAt: new Date()
        }
      );

      task.status = 'completed';
      task.completedAt = new Date();
      await task.save();
      return { success: true };
    } catch (error) {
      task.status = 'failed';
      task.lastError = {
        message: error.message,
        timestamp: new Date(),
        code: error.code || 'UNKNOWN'
      };
      task.retryCount += 1;
      await task.save();
      
      // Retry logic
      if (task.retryCount < task.maxRetries && !error.message.includes('CAPTCHA') && !error.message.includes('warning')) {
        throw error; // Will retry
      }
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // One message at a time per account
    limiter: {
      max: 1,
      duration: 120000 // Max 1 message per 2 minutes
    }
  }
);

// Worker for connection requests
const connectionWorker = new Worker(
  'linkedin-connections',
  async (job) => {
    const { accountId, profileUrl, message, taskId } = job.data;
    
    const task = await LinkedInTask.findById(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    task.status = 'processing';
    task.startedAt = new Date();
    await task.save();

    try {
      await sendConnectionRequest(accountId, profileUrl, message);
      task.status = 'completed';
      task.completedAt = new Date();
      await task.save();
      return { success: true };
    } catch (error) {
      task.status = 'failed';
      task.lastError = {
        message: error.message,
        timestamp: new Date(),
        code: error.code || 'UNKNOWN'
      };
      task.retryCount += 1;
      await task.save();
      
      if (task.retryCount < task.maxRetries && !error.message.includes('CAPTCHA') && !error.message.includes('warning')) {
        throw error;
      }
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
    limiter: {
      max: 1,
      duration: 180000 // Max 1 connection per 3 minutes
    }
  }
);

// Add task to queue
const queueInboxSync = async (accountId, userId) => {
  const task = await LinkedInTask.create({
    user: userId,
    linkedInAccount: accountId,
    type: 'read_inbox',
    status: 'pending',
    scheduledFor: new Date()
  });

  await inboxQueue.add('sync-inbox', {
    accountId,
    taskId: task._id
  }, {
    jobId: task._id.toString(),
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000 // 1 minute
    }
  });

  task.jobId = task._id.toString();
  await task.save();

  return task;
};

const queueMessageReply = async (accountId, userId, conversationId, messageText, scheduledFor = null) => {
  const task = await LinkedInTask.create({
    user: userId,
    linkedInAccount: accountId,
    type: 'reply_message',
    status: 'pending',
    data: {
      conversationId,
      messageText
    },
    scheduledFor: scheduledFor || new Date()
  });

  const delay = scheduledFor ? scheduledFor.getTime() - Date.now() : 0;

  await messageQueue.add('send-message', {
    accountId,
    conversationId,
    messageText,
    taskId: task._id
  }, {
    jobId: task._id.toString(),
    delay: Math.max(0, delay),
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 120000 // 2 minutes
    }
  });

  task.jobId = task._id.toString();
  await task.save();

  return task;
};

const queueConnectionRequest = async (accountId, userId, profileUrl, message, scheduledFor = null) => {
  const task = await LinkedInTask.create({
    user: userId,
    linkedInAccount: accountId,
    type: 'send_connection',
    status: 'pending',
    data: {
      profileUrl,
      connectionMessage: message
    },
    scheduledFor: scheduledFor || new Date()
  });

  const delay = scheduledFor ? scheduledFor.getTime() - Date.now() : 0;

  await connectionQueue.add('send-connection', {
    accountId,
    profileUrl,
    message,
    taskId: task._id
  }, {
    jobId: task._id.toString(),
    delay: Math.max(0, delay),
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 180000 // 3 minutes
    }
  });

  task.jobId = task._id.toString();
  await task.save();

  return task;
};

// Queue bulk replies with delays
const queueBulkReplies = async (accountId, userId, conversations, messageTemplate, campaignId = null) => {
  const tasks = [];
  const delayRange = { min: 120000, max: 300000 }; // 2-5 minutes

  for (let i = 0; i < conversations.length; i++) {
    const delay = Math.floor(Math.random() * (delayRange.max - delayRange.min + 1)) + delayRange.min;
    const scheduledFor = new Date(Date.now() + (i * delayRange.min) + delay);

    const task = await queueMessageReply(
      accountId,
      userId,
      conversations[i].conversationId,
      messageTemplate,
      scheduledFor
    );

    if (campaignId) {
      task.campaign = campaignId;
      await task.save();
    }

    tasks.push(task);
  }

  return tasks;
};

// Queue connection campaign
const queueConnectionCampaign = async (accountId, userId, profileUrls, messageTemplate, campaignId, delayRange) => {
  const tasks = [];
  const account = await LinkedInAccount.findById(accountId);
  
  // Warm-up logic
  let dailyLimit = account.safety.dailyConnectionLimit;
  if (account.safety.warmupMode) {
    if (account.safety.warmupDay <= 3) {
      dailyLimit = Math.min(25, dailyLimit);
    } else if (account.safety.warmupDay <= 7) {
      dailyLimit = Math.min(40, dailyLimit);
    }
  }

  const urlsToProcess = profileUrls.slice(0, dailyLimit);

  for (let i = 0; i < urlsToProcess.length; i++) {
    const delay = Math.floor(Math.random() * (delayRange.max - delayRange.min + 1)) + delayRange.min;
    const scheduledFor = new Date(Date.now() + (i * delayRange.min) + delay);

    const task = await queueConnectionRequest(
      accountId,
      userId,
      urlsToProcess[i],
      messageTemplate,
      scheduledFor
    );

    task.campaign = campaignId;
    await task.save();

    tasks.push(task);
  }

  return tasks;
};

module.exports = {
  queueInboxSync,
  queueMessageReply,
  queueConnectionRequest,
  queueBulkReplies,
  queueConnectionCampaign,
  inboxQueue,
  messageQueue,
  connectionQueue
};

