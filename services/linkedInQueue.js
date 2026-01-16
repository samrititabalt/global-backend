const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const LinkedInAccount = require('../models/LinkedInAccount');
const LinkedInTask = require('../models/LinkedInTask');
const LinkedInLog = require('../models/LinkedInLog');
const LinkedInMessage = require('../models/LinkedInMessage');
const LinkedInCampaign = require('../models/LinkedInCampaign');
const { syncInbox, sendMessage, sendConnectionRequest, detectCaptcha, detectWarning } = require('./linkedInAutomation');
const { generateAIResponse } = require('./openaiService');

// Redis connection
const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

// Create queues for different task types
const inboxSyncQueue = new Queue('linkedin-inbox-sync', { connection: redisConnection });
const messageQueue = new Queue('linkedin-messages', { connection: redisConnection });
const connectionQueue = new Queue('linkedin-connections', { connection: redisConnection });

/**
 * Add inbox sync task
 */
async function addInboxSyncTask(accountId, delay = 0) {
  const account = await LinkedInAccount.findById(accountId);
  if (!account) throw new Error('Account not found');

  // Check if sync is needed (not synced in last 5 minutes)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  if (account.lastSyncAt && account.lastSyncAt > fiveMinutesAgo) {
    return { skipped: true, reason: 'Recently synced' };
  }

  const task = await LinkedInTask.create({
    accountId,
    type: 'sync_inbox',
    status: 'pending',
    scheduledFor: new Date(Date.now() + delay)
  });

  await inboxSyncQueue.add(
    'sync-inbox',
    { accountId: accountId.toString(), taskId: task._id.toString() },
    {
      delay,
      jobId: task._id.toString(),
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000 // 1 minute
      }
    }
  );

  return { taskId: task._id };
}

/**
 * Add message send task
 */
async function addMessageTask(accountId, conversationId, messageText, delay = 0) {
  const account = await LinkedInAccount.findById(accountId);
  if (!account) throw new Error('Account not found');

  if (!account.canSendMessage()) {
    throw new Error('Daily message limit reached');
  }

  const task = await LinkedInTask.create({
    accountId,
    type: 'send_message',
    status: 'pending',
    data: {
      conversationId,
      messageText
    },
    scheduledFor: new Date(Date.now() + delay)
  });

  await messageQueue.add(
    'send-message',
    {
      accountId: accountId.toString(),
      taskId: task._id.toString(),
      conversationId,
      messageText
    },
    {
      delay,
      jobId: task._id.toString(),
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30000
      }
    }
  );

  return { taskId: task._id };
}

/**
 * Add connection request task
 */
async function addConnectionTask(accountId, profileUrl, message, delay = 0) {
  const account = await LinkedInAccount.findById(accountId);
  if (!account) throw new Error('Account not found');

  if (!account.canSendConnection()) {
    throw new Error('Daily connection limit reached');
  }

  const task = await LinkedInTask.create({
    accountId,
    type: 'send_connection',
    status: 'pending',
    data: {
      profileUrl,
      connectionMessage: message
    },
    scheduledFor: new Date(Date.now() + delay)
  });

  await connectionQueue.add(
    'send-connection',
    {
      accountId: accountId.toString(),
      taskId: task._id.toString(),
      profileUrl,
      message
    },
    {
      delay,
      jobId: task._id.toString(),
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000
      }
    }
  );

  return { taskId: task._id };
}

/**
 * Create workers to process tasks
 */
function createWorkers() {
  // Inbox sync worker
  const inboxSyncWorker = new Worker(
    'linkedin-inbox-sync',
    async (job) => {
      const { accountId, taskId } = job.data;
      const account = await LinkedInAccount.findById(accountId);
      const task = await LinkedInTask.findById(taskId);

      if (!account || !task) {
        throw new Error('Account or task not found');
      }

      task.status = 'processing';
      task.startedAt = new Date();
      await task.save();

      try {
        const result = await syncInbox(account);

        if (result.success) {
          // Save messages to database
          for (const msg of result.data) {
            await LinkedInMessage.findOneAndUpdate(
              { accountId, messageId: msg.messageId },
              {
                accountId,
                conversationId: msg.conversationId,
                senderName: msg.senderName,
                messageText: msg.text,
                messageId: msg.messageId,
                timestamp: new Date(msg.timestamp),
                isRead: false
              },
              { upsert: true, new: true }
            );
          }

          account.lastSyncAt = new Date();
          await account.save();

          task.status = 'completed';
          task.completedAt = new Date();
          await task.save();

          await LinkedInLog.create({
            accountId,
            taskId,
            action: 'sync_inbox',
            status: 'success',
            message: `Synced ${result.conversations} conversations, ${result.messages} messages`,
            metadata: result
          });

          return result;
        } else {
          throw new Error(result.error || 'Sync failed');
        }
      } catch (error) {
        task.status = 'failed';
        task.lastError = error.message;
        task.retryCount += 1;
        await task.save();

        // Update account status if needed
        if (error.message.includes('CAPTCHA')) {
          account.status = 'captcha_required';
          await account.save();
        } else if (error.message.includes('WARNING')) {
          account.status = 'warning';
          await account.save();
        }

        await LinkedInLog.create({
          accountId,
          taskId,
          action: 'sync_inbox',
          status: 'failure',
          error: error.message
        });

        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 1, // Process one at a time per account
      limiter: {
        max: 10,
        duration: 60000 // Max 10 syncs per minute
      }
    }
  );

  // Message send worker
  const messageWorker = new Worker(
    'linkedin-messages',
    async (job) => {
      const { accountId, taskId, conversationId, messageText } = job.data;
      const account = await LinkedInAccount.findById(accountId);
      const task = await LinkedInTask.findById(taskId);

      if (!account || !task) {
        throw new Error('Account or task not found');
      }

      task.status = 'processing';
      task.startedAt = new Date();
      await task.save();

      try {
        const result = await sendMessage(account, conversationId, messageText);

        if (result.success) {
          account.stats.messagesToday += 1;
          account.stats.totalMessagesSent += 1;
          account.lastActivityAt = new Date();
          await account.save();

          task.status = 'completed';
          task.completedAt = new Date();
          await task.save();

          await LinkedInLog.create({
            accountId,
            taskId,
            action: 'send_message',
            status: 'success',
            message: `Message sent to conversation ${conversationId}`
          });

          return result;
        } else {
          throw new Error(result.error || 'Send failed');
        }
      } catch (error) {
        task.status = 'failed';
        task.lastError = error.message;
        task.retryCount += 1;
        await task.save();

        if (error.message.includes('CAPTCHA')) {
          account.status = 'captcha_required';
          await account.save();
        } else if (error.message.includes('WARNING')) {
          account.status = 'warning';
          await account.save();
        }

        await LinkedInLog.create({
          accountId,
          taskId,
          action: 'send_message',
          status: 'failure',
          error: error.message
        });

        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 1,
      limiter: {
        max: 5,
        duration: 60000 // Max 5 messages per minute
      }
    }
  );

  // Connection request worker
  const connectionWorker = new Worker(
    'linkedin-connections',
    async (job) => {
      const { accountId, taskId, profileUrl, message } = job.data;
      const account = await LinkedInAccount.findById(accountId);
      const task = await LinkedInTask.findById(taskId);

      if (!account || !task) {
        throw new Error('Account or task not found');
      }

      task.status = 'processing';
      task.startedAt = new Date();
      await task.save();

      try {
        const result = await sendConnectionRequest(account, profileUrl, message);

        if (result.success) {
          account.stats.connectionsToday += 1;
          account.stats.totalConnectionsSent += 1;
          account.lastActivityAt = new Date();
          await account.save();

          task.status = 'completed';
          task.completedAt = new Date();
          await task.save();

          await LinkedInLog.create({
            accountId,
            taskId,
            action: 'send_connection',
            status: 'success',
            message: `Connection request sent to ${profileUrl}`
          });

          return result;
        } else {
          throw new Error(result.error || 'Connection request failed');
        }
      } catch (error) {
        task.status = 'failed';
        task.lastError = error.message;
        task.retryCount += 1;
        await task.save();

        if (error.message.includes('CAPTCHA')) {
          account.status = 'captcha_required';
          await account.save();
        } else if (error.message.includes('WARNING')) {
          account.status = 'warning';
          await account.save();
        }

        await LinkedInLog.create({
          accountId,
          taskId,
          action: 'send_connection',
          status: 'failure',
          error: error.message
        });

        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 1,
      limiter: {
        max: 3,
        duration: 60000 // Max 3 connections per minute
      }
    }
  );

  return { inboxSyncWorker, messageWorker, connectionWorker };
}

module.exports = {
  addInboxSyncTask,
  addMessageTask,
  addConnectionTask,
  createWorkers,
  inboxSyncQueue,
  messageQueue,
  connectionQueue
};

