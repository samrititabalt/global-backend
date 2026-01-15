const OpenAI = require('openai');

const SERVICE_PROMPTS = {
  medical: `You are SamAI, a helpful medical assistant for UK Tabalt. Provide professional, empathetic, and accurate medical guidance while using a warm human tone. Always remind users to consult with healthcare professionals for serious concerns.`,
  legal: `You are SamAI, a knowledgeable legal assistant for UK Tabalt. Provide general legal information and guidance in plain English. Always remind users this isn't formal legal advice and to consult a qualified solicitor for specific matters.`,
  technical: `You are SamAI, a technical support specialist. Help users troubleshoot issues, explain concepts clearly, and provide step-by-step guidance. Be patient, friendly, and solution-oriented.`,
  chart_builder: `You are SamAI, a specialized Chart Builder Assistant for Sam's Smart Reports Pro. Your ONLY purpose is to help users:
1. Build charts from their data (drag dimensions/measures to X/Y/Z axes)
2. Format charts and dashboards (labels, colors, styling)
3. Export to PPT (PowerPoint presentation)
4. Navigate the tool step-by-step

IMPORTANT GUARDRAILS:
- You MUST stay focused ONLY on chart building, dashboard formatting, and PPT export
- If asked about general topics, weather, news, or anything unrelated to chart building, politely redirect: "I'm focused on helping you build charts and dashboards. How can I assist with your data visualization?"
- Guide users through the workflow: Step 1 (enter data) → Step 2 (drag to build charts) → Step 3 (arrange on dashboard) → Step 4 (export to PPT)
- Be concise, actionable, and solution-focused
- Reference the user's current data columns and chart configuration when providing guidance`,
  default: `You are SamAI, a friendly AI concierge for UK Tabalt. Respond like a caring teammate: warm, concise, proactive, and solution-focused. Reference the selected service category to keep the conversation contextual, and share actionable steps before a human specialist joins.`
  ,
  hiring: `You are SamAI, a professional HR document generator for Tabalt Hiring Pro. Generate structured offer letters, employment contracts, and salary explanations in a formal, compliant tone. Use the company and candidate details provided, avoid inventing facts, and format with clear headings.`
};

const detectServiceCategory = (serviceName = '') => {
  const normalizedName = serviceName.toLowerCase();

  // Check for chart builder context first
  if (
    normalizedName.includes('chart') ||
    normalizedName.includes('smart reports') ||
    normalizedName.includes('dashboard') ||
    normalizedName.includes('data visualization') ||
    normalizedName.includes('ppt') ||
    normalizedName.includes('powerpoint')
  ) {
    return 'chart_builder';
  }

  if (normalizedName.includes('medical') || normalizedName.includes('health') || normalizedName.includes('doctor')) {
    return 'medical';
  }
  if (normalizedName.includes('legal') || normalizedName.includes('law') || normalizedName.includes('attorney')) {
    return 'legal';
  }
  if (
    normalizedName.includes('technical') ||
    normalizedName.includes('tech') ||
    normalizedName.includes('support') ||
    normalizedName.includes('it')
  ) {
    return 'technical';
  }
  if (
    normalizedName.includes('hiring') ||
    normalizedName.includes('hr') ||
    normalizedName.includes('offer') ||
    normalizedName.includes('onboarding')
  ) {
    return 'hiring';
  }

  return 'default';
};

const getServicePrompt = (serviceName) => {
  const category = detectServiceCategory(serviceName);
  return SERVICE_PROMPTS[category];
};

const buildChatMessages = (systemPrompt, chatHistory = [], userMessage) => {
  const history = chatHistory
    .map((msg) => ({
      role: msg.senderType === 'customer' ? 'user' : 'assistant',
      content: msg.content || ''
    }))
    .filter((msg) => !!msg.content);

  return [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ];
};

const numberFromEnv = (value, fallback) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

let openAIClient = null;
const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  if (!openAIClient) {
    openAIClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      organization: process.env.OPENAI_ORG || process.env.OPENAI_ORGANIZATION || undefined,
      project: process.env.OPENAI_PROJECT || undefined
    });
  }

  return openAIClient;
};

const summarizeUserMessage = (message) => {
  if (!message || typeof message !== 'string') {
    return 'your request';
  }

  const condensed = message.replace(/\s+/g, ' ').trim();
  if (!condensed) {
    return 'your request';
  }

  return condensed.length > 220 ? `${condensed.slice(0, 220)}...` : condensed;
};

const getFallbackResponse = (userMessage, serviceName) => {
  const category = detectServiceCategory(serviceName);
  const topic = summarizeUserMessage(userMessage);

  const responses = {
    medical: `Let's get you answers around ${topic}. Start by sharing symptoms, duration, existing conditions, and medications. I can outline possible causes and steps to monitor while we connect you with a licensed clinician.`,
    legal: `Here's a smart way to tackle ${topic}: note the jurisdiction, parties involved, deadlines, and any paperwork you have. I can help you organize the facts and draft the next steps before a solicitor joins.`,
    technical: `For ${topic}, let's pin down the platform, hardware, software versions, and the exact behaviour you're seeing. I'll walk you through immediate troubleshooting and ensure a clean hand-off if we need a specialist.`,
    default: `Thanks for the details on ${topic}. I'll break it into goals, constraints, and next actions so you get an actionable plan right away. Share anything that's a must-have or blocker and I'll keep iterating with you.`
  };

  return responses[category] || responses.default;
};

const generateAIResponse = async (userMessage, chatHistory, serviceName) => {
  const client = getOpenAIClient();

  if (!client) {
    console.warn('SamAI warning: OPENAI_API_KEY is missing. Falling back to scripted response.');
    return getFallbackResponse(userMessage, serviceName);
  }

  // Check if API key is set but might be invalid
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === '') {
    console.warn('SamAI warning: OPENAI_API_KEY is empty or not set. Falling back to scripted response.');
    return getFallbackResponse(userMessage, serviceName);
  }

  try {
    const systemPrompt = getServicePrompt(serviceName);
    const messages = buildChatMessages(systemPrompt, chatHistory, userMessage);
    
    console.log('Calling OpenAI API with model:', process.env.OPENAI_MODEL || 'gpt-4o-mini');
    
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      temperature: numberFromEnv(process.env.OPENAI_TEMPERATURE, 0.7),
      top_p: numberFromEnv(process.env.OPENAI_TOP_P, 0.9),
      presence_penalty: numberFromEnv(process.env.OPENAI_PRESENCE_PENALTY, 0.1),
      frequency_penalty: numberFromEnv(process.env.OPENAI_FREQUENCY_PENALTY, 0),
      max_tokens: numberFromEnv(process.env.OPENAI_MAX_TOKENS, 500)
    });

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (content) {
      return content;
    }

    console.warn('SamAI warning: OpenAI returned an empty completion. Using fallback response.');
    return getFallbackResponse(userMessage, serviceName);
  } catch (error) {
    // Log detailed error information
    const errorDetails = {
      message: error?.message,
      status: error?.status,
      code: error?.code,
      response: error?.response?.data,
      type: error?.type
    };
    console.error('OpenAI API error details:', JSON.stringify(errorDetails, null, 2));
    
    // Check for specific API key errors
    if (error?.status === 401 || error?.code === 'invalid_api_key' || error?.message?.includes('api key')) {
      console.error('OpenAI API key appears to be invalid. Please check your OPENAI_API_KEY environment variable.');
    }
    
    // Always return fallback response on error
    return getFallbackResponse(userMessage, serviceName);
  }
};

module.exports = {
  generateAIResponse,
  getServicePrompt
};

