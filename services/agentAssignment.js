const User = require('../models/User');
const ChatSession = require('../models/ChatSession');

const assignAgent = async (serviceId, chatSessionId) => {
  try {
    // Find all agents for this service who are online and available
    const agents = await User.find({
      role: 'agent',
      serviceCategory: serviceId,
      isOnline: true,
      isAvailable: true,
      isActive: true
    }).sort({ activeChats: 1 }); // Sort by number of active chats (load balancing)

    if (agents.length === 0) {
      return null; // No available agents
    }

    // Assign to the first available agent
    const assignedAgent = agents[0];
    
    // Update chat session
    await ChatSession.findByIdAndUpdate(chatSessionId, {
      agent: assignedAgent._id,
      status: 'active',
      assignedAt: new Date()
    });

    // Add chat to agent's active chats
    await User.findByIdAndUpdate(assignedAgent._id, {
      $push: { activeChats: chatSessionId }
    });

    return assignedAgent;
  } catch (error) {
    console.error('Error assigning agent:', error);
    return null;
  }
};

const reassignAgent = async (chatSessionId, currentAgentId) => {
  try {
    const chatSession = await ChatSession.findById(chatSessionId).populate('service');
    
    if (!chatSession) {
      return null;
    }

    // Remove from current agent's active chats
    await User.findByIdAndUpdate(currentAgentId, {
      $pull: { activeChats: chatSessionId }
    });

    // Find new agent
    const newAgent = await assignAgent(chatSession.service._id, chatSessionId);
    
    return newAgent;
  } catch (error) {
    console.error('Error reassigning agent:', error);
    return null;
  }
};

module.exports = { assignAgent, reassignAgent };

