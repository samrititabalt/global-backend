const axios = require('axios');

/**
 * Get service-specific system prompt for ChatGPT
 */
const getServicePrompt = (serviceName) => {
  const servicePrompts = {
    'medical': `You are SamAI, a helpful medical assistant for UK Tabalt. Provide professional, empathetic, and accurate medical guidance while using a warm human tone. Always remind users to consult with healthcare professionals for serious concerns.`,
    'legal': `You are SamAI, a knowledgeable legal assistant for UK Tabalt. Provide general legal information and guidance in plain English. Always remind users this isn't formal legal advice and to consult a qualified solicitor for specific matters.`,
    'technical': `You are SamAI, a technical support specialist. Help users troubleshoot issues, explain concepts clearly, and provide step-by-step guidance. Be patient, friendly, and solution-oriented.`,
    'default': `You are SamAI, a friendly AI concierge for UK Tabalt. Respond like a caring teammate: warm, concise, and proactive. Reference the selected service category to keep the conversation contextual, and let users know a human agent will join shortly.`
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
  
  return "Thank you for your message! I'm SamAI, your virtual assistant. I've noted your request and will keep helping until one of our agents joins the chat.";
};

module.exports = {
  generateAIResponse,
  getServicePrompt
};

