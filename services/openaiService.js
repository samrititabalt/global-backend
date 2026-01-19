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
  ,
  sam_reports: `You are SamAI, a market intelligence analyst for Sam Reports. Generate structured industry, sector, and company profile reports with concise, professional language. Provide clear sections, avoid hallucinating specific financials unless requested, and format outputs as requested (JSON when asked).`
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
  if (
    normalizedName.includes('sam reports') ||
    normalizedName.includes('sam report') ||
    normalizedName.includes('industry report') ||
    normalizedName.includes('sector report') ||
    normalizedName.includes('company profile')
  ) {
    return 'sam_reports';
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

const defaultSalaryComponents = [
  { key: 'basic_salary', label: 'Basic Salary', category: 'earning', description: 'Core salary component before allowances.' },
  { key: 'house_rent_allowance', label: 'House Rent Allowance (HRA)', category: 'earning', description: 'Housing support aligned to local norms.' },
  { key: 'bonus', label: 'Bonus', category: 'earning', description: 'Performance-linked variable pay.' },
  { key: 'provident_fund', label: 'Provident Fund (PF)', category: 'deduction', description: 'Retirement contribution or pension deductions.' },
  { key: 'gratuity', label: 'Gratuity', category: 'deduction', description: 'Statutory gratuity contribution.' },
  { key: 'special_allowance', label: 'Special Allowance', category: 'earning', description: 'Flexible allowance to balance total pay.' },
  { key: 'medical_allowance', label: 'Medical Allowance', category: 'earning', description: 'Healthcare or medical benefit allowance.' },
  { key: 'professional_tax', label: 'Professional Tax', category: 'deduction', description: 'Local professional or payroll tax deduction.' }
];

const buildSalaryTemplatePrompt = (currency) => `
You are generating a salary breakup template for hiring teams.
Return ONLY valid JSON with the following schema:
{
  "currency": "${currency}",
  "components": [
    {
      "key": "basic_salary",
      "label": "Basic Salary",
      "amount": 0,
      "description": "Short description",
      "category": "earning"
    }
  ],
  "totalCtc": 0,
  "netPay": 0
}

Rules:
- Use realistic salary values for ${currency} aligned to US, UK, and India norms.
- Include ALL of these components: Basic Salary, House Rent Allowance (HRA), Bonus, Provident Fund (PF), Gratuity, Special Allowance, Medical Allowance, Professional Tax.
- Use "earning" or "deduction" for category.
- totalCtc must equal the sum of earning components.
- netPay must equal totalCtc minus the sum of deduction components.
- Provide short, clear descriptions per component.
- Return JSON only, no markdown or extra text.
`.trim();

const parseJsonFromText = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
};

const buildFallbackSalaryTemplate = (currency = 'USD') => {
  const baseTotals = { USD: 90000, GBP: 65000, INR: 1800000 };
  const totalCtc = baseTotals[currency] || baseTotals.USD;
  const earnings = [
    { key: 'basic_salary', label: 'Basic Salary', percentage: 0.5 },
    { key: 'house_rent_allowance', label: 'House Rent Allowance (HRA)', percentage: 0.2 },
    { key: 'bonus', label: 'Bonus', percentage: 0.1 },
    { key: 'special_allowance', label: 'Special Allowance', percentage: 0.1 },
    { key: 'medical_allowance', label: 'Medical Allowance', percentage: 0.05 }
  ];
  const deductions = [
    { key: 'provident_fund', label: 'Provident Fund (PF)', percentage: 0.05 },
    { key: 'gratuity', label: 'Gratuity', percentage: 0.03 },
    { key: 'professional_tax', label: 'Professional Tax', percentage: 0.01 }
  ];

  const components = defaultSalaryComponents.map((component) => {
    const earningMatch = earnings.find((item) => item.key === component.key);
    const deductionMatch = deductions.find((item) => item.key === component.key);
    let amount = 0;
    if (earningMatch) amount = Math.round(totalCtc * earningMatch.percentage);
    if (deductionMatch) amount = Math.round(totalCtc * deductionMatch.percentage);
    return { ...component, amount };
  });

  const totalDeductions = components
    .filter((item) => item.category === 'deduction')
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  return {
    currency,
    components,
    totalCtc,
    netPay: totalCtc - totalDeductions
  };
};

const generateSalaryTemplate = async (currency = 'USD') => {
  const client = getOpenAIClient();
  if (!client) {
    return buildFallbackSalaryTemplate(currency);
  }

  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a payroll analyst generating salary breakup templates.' },
        { role: 'user', content: buildSalaryTemplatePrompt(currency) }
      ],
      temperature: numberFromEnv(process.env.OPENAI_TEMPERATURE, 0.4),
      max_tokens: 700
    });

    const content = completion.choices?.[0]?.message?.content?.trim();
    const parsed = parseJsonFromText(content);
    if (parsed?.components?.length) {
      return parsed;
    }
    return buildFallbackSalaryTemplate(currency);
  } catch (error) {
    console.error('Salary template generation error:', error?.message);
    return buildFallbackSalaryTemplate(currency);
  }
};

const defaultExpenseTemplateFields = [
  { key: 'particulars', label: 'Particulars', required: true, order: 1 },
  { key: 'invoice_number', label: 'Invoice Number', required: true, order: 2 },
  { key: 'name', label: 'Name', required: true, order: 3 },
  { key: 'expense_type', label: 'Type of Expense', required: true, order: 4 },
  { key: 'amount', label: 'Amount', required: true, order: 5 },
  { key: 'date', label: 'Date', required: true, order: 6 },
  { key: 'remarks', label: 'Remarks', required: true, order: 7 }
];

const buildExpenseTemplatePrompt = () => `
You are generating a standard employee expense template.
Return ONLY valid JSON with this schema:
{
  "fields": [
    { "key": "particulars", "label": "Particulars", "required": true, "order": 1 }
  ]
}

Rules:
- Include these fixed fields in order: Particulars, Invoice Number, Name, Type of Expense, Amount, Date, Remarks.
- You may add optional fields if needed, but keep the fixed fields included.
- Keep keys in snake_case and stable.
- Return JSON only.
`.trim();

const parseJsonWithFallback = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
};

const generateExpenseTemplate = async () => {
  const client = getOpenAIClient();
  if (!client) {
    return { fields: defaultExpenseTemplateFields };
  }

  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You create structured templates for expense reporting.' },
        { role: 'user', content: buildExpenseTemplatePrompt() }
      ],
      temperature: numberFromEnv(process.env.OPENAI_TEMPERATURE, 0.2),
      max_tokens: 500
    });
    const content = completion.choices?.[0]?.message?.content?.trim();
    const parsed = parseJsonWithFallback(content);
    if (parsed?.fields?.length) {
      return parsed;
    }
    return { fields: defaultExpenseTemplateFields };
  } catch (error) {
    console.error('Expense template generation error:', error?.message);
    return { fields: defaultExpenseTemplateFields };
  }
};

const buildExpenseExtractionPrompt = (fields = []) => {
  const fieldKeys = fields.map((field) => field.key).filter(Boolean);
  return `
Extract the following fields from the invoice/receipt:
${fieldKeys.join(', ')}

Return ONLY valid JSON in this schema:
{
  "fields": {
    "particulars": "string or null",
    "invoice_number": "string or null",
    "name": "string or null",
    "expense_type": "string or null",
    "amount": "string or null",
    "date": "string or null",
    "remarks": "string or null"
  },
  "extraFields": [
    { "label": "GST", "value": "string" }
  ]
}

Rules:
- Use null for missing fields.
- Classify expense_type into one of: Travel, Food & Drinks, Internet/Phone, Visa, Others.
- Include any extra fields found in the document under extraFields.
- If nothing is found, return all fields as null.
  `.trim();
};

const extractExpenseFieldsFromImage = async (imageBase64, fields = []) => {
  const client = getOpenAIClient();
  if (!client) {
    return { fields: {}, extraFields: [] };
  }

  try {
    const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const requestConfig = {
      model,
      messages: [
        { role: 'system', content: buildExpenseExtractionPrompt(fields) },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract expense data and return JSON only.' },
            { type: 'image_url', image_url: { url: imageBase64, detail: 'high' } }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 700
    };

    if (model.includes('gpt-4o') || model.includes('gpt-4-turbo')) {
      requestConfig.response_format = { type: 'json_object' };
    }

    const completion = await client.chat.completions.create(requestConfig);
    const content = completion.choices?.[0]?.message?.content?.trim();
    const parsed = parseJsonWithFallback(content);
    if (parsed) {
      return parsed;
    }
    return { fields: {}, extraFields: [] };
  } catch (error) {
    console.error('Expense extraction error:', error?.message);
    return { fields: {}, extraFields: [] };
  }
};

module.exports = {
  generateAIResponse,
  getServicePrompt,
  generateSalaryTemplate,
  generateExpenseTemplate,
  extractExpenseFieldsFromImage
};

