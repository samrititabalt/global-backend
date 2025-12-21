const User = require('../models/User');

const addAgentMinutes = async (agentId, amount, reason, performedBy = null) => {
  try {
    const agent = await User.findById(agentId);
    
    if (!agent || agent.role !== 'agent') {
      return { success: false, message: 'Agent not found' };
    }

    agent.agentMinutes = (agent.agentMinutes || 0) + amount;
    agent.totalMinutesEarned = (agent.totalMinutesEarned || 0) + (amount > 0 ? amount : 0);
    await agent.save();

    return { success: true, minutes: agent.agentMinutes, totalEarned: agent.totalMinutesEarned };
  } catch (error) {
    console.error('Error adding agent minutes:', error);
    return { success: false, message: 'Error processing agent minutes addition' };
  }
};

const incrementAgentMinutesForMessage = async (agentId) => {
  try {
    const agent = await User.findById(agentId);
    
    if (!agent || agent.role !== 'agent') {
      return { success: false, message: 'Agent not found' };
    }

    // Increment by 1 minute for each message sent
    agent.agentMinutes = (agent.agentMinutes || 0) + 1;
    agent.totalMinutesEarned = (agent.totalMinutesEarned || 0) + 1;
    await agent.save();

    return { success: true, minutes: agent.agentMinutes, totalEarned: agent.totalMinutesEarned };
  } catch (error) {
    console.error('Error incrementing agent minutes:', error);
    return { success: false, message: 'Error processing agent minutes increment' };
  }
};

const checkAgentMinutes = async (agentId) => {
  try {
    const agent = await User.findById(agentId);
    return agent && agent.role === 'agent' ? (agent.agentMinutes || 0) : 0;
  } catch (error) {
    console.error('Error checking agent minutes:', error);
    return 0;
  }
};

module.exports = { addAgentMinutes, incrementAgentMinutesForMessage, checkAgentMinutes };

