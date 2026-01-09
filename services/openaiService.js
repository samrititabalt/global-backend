const axios = require('axios');

const SERVICE_PROMPTS = {
  medical: `You are SamAI, a helpful medical assistant for UK Tabalt. Provide professional, empathetic, and accurate medical guidance while using a warm human tone. Always remind users to consult with healthcare professionals for serious concerns.`,
  legal: `You are SamAI, a knowledgeable legal assistant for UK Tabalt. Provide general legal information and guidance in plain English. Always remind users this isn't formal legal advice and to consult a qualified solicitor for specific matters.`,
  technical: `You are SamAI, a technical support specialist. Help users troubleshoot issues, explain concepts clearly, and provide step-by-step guidance. Be patient, friendly, and solution-oriented.`,
  default: `You are SamAI, a friendly AI concierge for UK Tabalt. Respond like a caring teammate: warm, concise, and proactive. Reference the selected service category to keep the conversation contextual, and let users know a human agent will join shortly.`
};

const detectServiceCategory = (serviceName = '') => {
  const normalizedName = serviceName.toLowerCase();

  if (normalizedName.includes('medical') || normalizedName.includes('health') || normalizedName.includes('doctor')) {
    return 'medical';
  }
  if (normalizedName.includes('legal') || normalizedName.includes('law') || normalizedName.includes('attorney')) {
    return 'legal';
  }
  if (normalizedName.includes('technical') || normalizedName.includes('tech') || normalizedName.includes('support') || normalizedName.includes('it')) {
    return 'technical';
  }

  return 'default';
};

/**
 * Get service-specific system prompt for ChatGPT
 */
const getServicePrompt = (serviceName) => {
  const category = detectServiceCategory(serviceName);
  return SERVICE_PROMPTS[category];
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
 * Condense a user message so fallback replies feel contextual.
 */
const summarizeUserMessage = (message) => {
  if (!message || typeof message !== 'string') {
    return 'this request';
  }

  const condensed = message.replace(/\s+/g, ' ').trim();
  if (!condensed) {
    return 'this request';
  }

  return condensed.length > 200 ? `${condensed.slice(0, 200)}...` : condensed;
};

/**
 * Fallback response when OpenAI is unavailable
 */
const getFallbackResponse = (userMessage, serviceName) => {
  const category = detectServiceCategory(serviceName);
  const topic = summarizeUserMessage(userMessage);
  const quotedTopic = topic === 'this request' ? topic : `“${topic}”`;

  const responses = {
    medical: `I understand you're dealing with ${quotedTopic}. Here's an immediate plan: I'll capture key symptoms, duration, and any medications so our healthcare specialist can step in with precise guidance. Please let me know anything that feels urgent, plus any red-flag symptoms you're experiencing. A licensed clinician will join shortly, but I'm staying with you meanwhile.`,
    legal: `Thanks for outlining ${quotedTopic}. I'll organize the important facts—jurisdiction, deadlines, paperwork on hand, and desired outcomes—so our legal specialist can respond efficiently. Could you share any relevant contracts or previous correspondence while I keep the conversation moving?`,
    technical: `Got it—you're working on ${quotedTopic}. Here's how we can move fast: I'll log your current setup, desired result, constraints, and what you've tried so far. If you can add details like budget, hardware, or error codes, I can prepare troubleshooting steps before the technical agent joins.`,
    default: `Appreciate the detail about ${quotedTopic}. I'll map out the goal, timeline, and success criteria so the right teammate can jump in ready with next steps. Feel free to add any must-haves or blockers—I'll keep everything organized until the specialist arrives.`
  };

  return responses[category] || responses.default;
};

module.exports = {
  generateAIResponse,
  getServicePrompt
};

