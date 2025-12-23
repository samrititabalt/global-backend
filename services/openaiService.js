const axios = require('axios');

/**
 * Get service-specific system prompt for ChatGPT
 */
const getServicePrompt = (serviceName) => {
  const servicePrompts = {
    'medical': `You are ASKSAM AI, a helpful medical assistant. Provide professional, empathetic, and accurate medical guidance. Always remind users to consult with healthcare professionals for serious concerns. Be warm, supportive, and clear in your responses.`,
    'legal': `You are ASKSAM AI, a knowledgeable legal assistant. Provide general legal information and guidance. Always remind users that this is not legal advice and they should consult with a qualified attorney for specific legal matters. Be professional, clear, and helpful.`,
    'technical': `You are ASKSAM AI, a technical support specialist. Help users troubleshoot technical issues, explain concepts clearly, and provide step-by-step guidance. Be patient, detailed, and solution-oriented.`,
    'default': `You are ASKSAM AI, a helpful assistant. Provide friendly, professional, and contextual assistance based on the user's needs. Be clear, concise, and supportive.`
  };

  // Normalize service name (case-insensitive)
  const normalizedName = (serviceName || '').toLowerCase();
  
  // Check for keywords in service name
  if (normalizedName.includes('medical') || normalizedName.includes('health') || normalizedName.includes('doctor')) {
    return servicePrompts['medical'];
  } else if (normalizedName.includes('legal') || normalizedName.includes('law') || normalizedName.includes('attorney')) {
    return servicePrompts['legal'];
  } else if (normalizedName.includes('technical') || normalizedName.includes('tech') || normalizedName.includes('support')) {
    return servicePrompts['technical'];
  }
  
  return servicePrompts['default'];
};

/**
 * Generate AI response using OpenAI API
 */
const generateAIResponse = async (userMessage, chatHistory, serviceName) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.warn('OpenAI API key not found. Using fallback response.');
      return getFallbackResponse(userMessage, serviceName);
    }

    const systemPrompt = getServicePrompt(serviceName);
    
    // Build conversation history
    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map(msg => ({
        role: msg.senderType === 'customer' ? 'user' : 'assistant',
        content: msg.content || ''
      })),
      { role: 'user', content: userMessage }
    ];

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: messages,
        max_tokens: 500,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content.trim();
    }

    return getFallbackResponse(userMessage, serviceName);
  } catch (error) {
    console.error('OpenAI API error:', error.response?.data || error.message);
    return getFallbackResponse(userMessage, serviceName);
  }
};

/**
 * Fallback response when OpenAI is unavailable
 */
const getFallbackResponse = (userMessage, serviceName) => {
  const normalizedName = (serviceName || '').toLowerCase();
  
  if (normalizedName.includes('medical') || normalizedName.includes('health')) {
    return "Thank you for your message. I'm here to help with your medical inquiry. An agent will be with you shortly to provide personalized assistance.";
  } else if (normalizedName.includes('legal') || normalizedName.includes('law')) {
    return "Thank you for reaching out. I'm here to assist with your legal question. A qualified agent will review your request and respond soon.";
  } else if (normalizedName.includes('technical') || normalizedName.includes('tech')) {
    return "Thanks for contacting us! I'm here to help with your technical issue. An agent will assist you shortly.";
  }
  
  return "Thank you for your message! I'm ASKSAM AI, and I'm here to help. An agent will be with you shortly to provide personalized assistance.";
};

module.exports = {
  generateAIResponse,
  getServicePrompt
};

