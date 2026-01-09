const Message = require('../models/Message');
const ChatSession = require('../models/ChatSession');
const User = require('../models/User');
const { generateAIResponse } = require('./openaiService');

const SAM_AI_SENDER = {
  _id: 'SAM_AI',
  name: 'SamAI',
  role: 'ai'
};

const formatGreeting = (customerName, serviceName) => {
  const safeCustomer = customerName || 'there';
  const safeService = serviceName || 'our support';
  return `Hi ${safeCustomer}! I'm SamAI from the ${safeService} team. Thanks for reaching out—I'll help gather details while I connect you with the right specialist. Could you share a bit more about what you need today?`;
};

const emitAIMessage = (io, chatSessionId, content, options = {}) => {
  if (!io) {
    return;
  }

  io.to(`chat_${chatSessionId}`).emit('newMessage', {
    _id: options._id || `samai_${Date.now()}`,
    chatSession: chatSessionId,
    sender: SAM_AI_SENDER,
    senderRole: 'ai',
    senderType: 'ai',
    content,
    messageType: 'text',
    isAIMessage: true,
    createdAt: options.createdAt || new Date()
  });
};

/**
 * Send initial AI greeting when customer first joins chat
 */
const sendInitialAIGreeting = async (chatSessionId, io) => {
  try {
    const chatSession = await ChatSession.findById(chatSessionId)
      .populate('service', 'name')
      .populate('customer', 'name');
    
    if (!chatSession || chatSession.aiMessagesSent) {
      return;
    }

    // Check if agent has already joined
    if (chatSession.agent) {
      return; // Agent already assigned, skip AI greeting
    }

    const serviceName = chatSession.service?.name || 'General Support';
    const customerName = chatSession.customer?.name || 'there';
    const greeting = formatGreeting(customerName, serviceName);

    // Create AI message
    const message = await Message.create({
      chatSession: chatSessionId,
      sender: chatSession.customer._id, // placeholder for schema requirement
      senderRole: 'ai',
      senderType: 'ai',
      content: greeting,
      messageType: 'text',
      isAIMessage: true
    });

    // Mark as sent
    chatSession.aiMessagesSent = true;
    await chatSession.save();

    // Emit to chat room
    emitAIMessage(io, chatSessionId, greeting, { _id: message._id, createdAt: message.createdAt });
  } catch (error) {
    console.error('Error sending initial AI greeting:', error);
  }
};

/**
 * Generate and send AI response to customer message
 * Only responds if no agent has joined the chat yet
 */
const respondToCustomerMessage = async (chatSessionId, customerMessage, io) => {
  try {
    const chatSession = await ChatSession.findById(chatSessionId)
      .populate('agent', 'name isOnline')
      .populate('service', 'name')
      .populate('customer', 'name');
    
    if (!chatSession) {
      return;
    }

    // Don't respond if agent is present and online
    if (chatSession.agent) {
      const agentUser = await User.findById(chatSession.agent._id || chatSession.agent);
      if (agentUser?.isOnline) {
        return;
      }
    }

    // Don't respond if this is not a customer message
    if (customerMessage.senderRole !== 'customer' && customerMessage.senderType !== 'customer') {
      return;
    }

    // Get recent chat history (last 10 messages for context)
    const recentMessages = await Message.find({
      chatSession: chatSessionId
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('content senderRole senderType')
      .lean();

    // Reverse to get chronological order
    const chatHistory = recentMessages.reverse();

    const serviceName = chatSession.service?.name || 'General Support';
    const userMessage = customerMessage.content || '';

    // Generate AI response
    const aiResponse = await generateAIResponse(
      userMessage,
      chatHistory,
      serviceName
    );

    // Create AI message
    const message = await Message.create({
      chatSession: chatSessionId,
      sender: chatSession.customer._id,
      senderRole: 'ai',
      senderType: 'ai',
      content: aiResponse,
      messageType: 'text',
      isAIMessage: true
    });

    emitAIMessage(io, chatSessionId, aiResponse, { _id: message._id, createdAt: message.createdAt });
  } catch (error) {
    console.error('Error generating AI response:', error);
  }
};

const sendAgentOnlineAnnouncement = async (chatSessionId, agentName, io) => {
  try {
    const chatSession = await ChatSession.findById(chatSessionId);
    if (!chatSession || chatSession.aiHandOffSent) {
      return;
    }

    const content = `Great news! Agent ${agentName} is online now and will take it from here. I'll stay close if you need anything else.`;

    const message = await Message.create({
      chatSession: chatSessionId,
      sender: chatSession.customer,
      senderRole: 'ai',
      senderType: 'ai',
      content,
      messageType: 'text',
      isAIMessage: true
    });

    chatSession.aiHandOffSent = true;
    await chatSession.save();

    emitAIMessage(io, chatSessionId, content, { _id: message._id, createdAt: message.createdAt });
  } catch (error) {
    console.error('Error sending AI hand-off announcement:', error);
  }
};

module.exports = {
  sendInitialAIGreeting,
  respondToCustomerMessage,
  sendAgentOnlineAnnouncement
};
