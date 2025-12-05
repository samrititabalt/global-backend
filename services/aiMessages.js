const Message = require('../models/Message');
const ChatSession = require('../models/ChatSession');

const AIMessages = [
  "Hello! Thanks for reaching out.",
  "An agent is reviewing your request.",
  "An agent will contact you soon."
];

const sendAIMessages = async (chatSessionId, io) => {
  try {
    const chatSession = await ChatSession.findById(chatSessionId);
    
    if (!chatSession || chatSession.aiMessagesSent) {
      return;
    }

    // Send AI messages with delays
    for (let i = 0; i < AIMessages.length; i++) {
      setTimeout(async () => {
        // Check if agent has already sent a message
        const agentMessage = await Message.findOne({
          chatSession: chatSessionId,
          senderRole: 'agent',
          isAIMessage: false
        });

        if (agentMessage) {
          // Agent has responded, stop sending AI messages
          return;
        }

        const message = await Message.create({
          chatSession: chatSessionId,
          sender: chatSession.customer,
          senderRole: 'system',
          content: AIMessages[i],
          messageType: 'system',
          isAIMessage: true
        });

        // Emit to customer
        io.to(`chat_${chatSessionId}`).emit('newMessage', {
          _id: message._id,
          chatSession: chatSessionId,
          sender: chatSession.customer,
          senderRole: 'system',
          content: AIMessages[i],
          messageType: 'system',
          isAIMessage: true,
          createdAt: message.createdAt
        });
      }, (i + 1) * 2000); // 2 seconds delay between messages
    }

    // Mark as sent
    chatSession.aiMessagesSent = true;
    await chatSession.save();
  } catch (error) {
    console.error('Error sending AI messages:', error);
  }
};

module.exports = { sendAIMessages };

