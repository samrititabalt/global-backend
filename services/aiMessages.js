const Message = require('../models/Message');
const ChatSession = require('../models/ChatSession');
const { generateAIResponse } = require('./openaiService');

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
    
    // Generate contextual greeting
    const greeting = await generateAIResponse(
      `Hello, I'm a new customer named ${customerName} and I need help with ${serviceName}.`,
      [],
      serviceName
    );

    // Create AI message
    const message = await Message.create({
      chatSession: chatSessionId,
      sender: chatSession.customer._id, // Use customer ID as placeholder
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
    const messageData = {
      _id: message._id,
      chatSession: chatSessionId,
      sender: {
        _id: 'ASKSAM_AI',
        name: 'ASKSAM AI',
        role: 'ai'
      },
      senderRole: 'ai',
      senderType: 'ai',
      content: greeting,
      messageType: 'text',
      isAIMessage: true,
      createdAt: message.createdAt
    };

    io.to(`chat_${chatSessionId}`).emit('newMessage', messageData);
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
      .populate('service', 'name')
      .populate('customer', 'name');
    
    if (!chatSession) {
      return;
    }

    // Don't respond if agent has already joined
    if (chatSession.agent) {
      return;
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
      sender: chatSession.customer._id, // Use customer ID as placeholder
      senderRole: 'ai',
      senderType: 'ai',
      content: aiResponse,
      messageType: 'text',
      isAIMessage: true
    });

    // Emit to chat room
    const messageData = {
      _id: message._id,
      chatSession: chatSessionId,
      sender: {
        _id: 'ASKSAM_AI',
        name: 'ASKSAM AI',
        role: 'ai'
      },
      senderRole: 'ai',
      senderType: 'ai',
      content: aiResponse,
      messageType: 'text',
      isAIMessage: true,
      createdAt: message.createdAt
    };

    io.to(`chat_${chatSessionId}`).emit('newMessage', messageData);
  } catch (error) {
    console.error('Error generating AI response:', error);
  }
};

module.exports = {
  sendInitialAIGreeting,
  respondToCustomerMessage
};
