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
  talent_advisor: `You are Tabalt's Talent Advisor for the public website. You help visitors with staffing guidance only across multi-platform IT hiring:
- Cloud engineering: AWS, Azure, GCP, Oracle Cloud, SAP cloud ecosystems
- Data engineering: Snowflake, Redshift, Databricks, modern data stack
- BI analytics: Tableau, Power BI, Looker
- Enterprise platforms: SAP, Oracle, Salesforce (Salesforce is one capability, not the primary focus)
- AI engineering: OpenAI (GPT-4, GPT-4o, GPT-mini), Anthropic Claude, Co-Work Developer, HuggingFace, LangChain, RAG engineers, AI automation specialists
- Engineering and operations: full-stack, backend, DevOps, SRE, QA automation
- Delivery models: staff augmentation, managed teams, project pods, onshore UK/offshore India
Be advisory, clear, and non-pushy. Give high-level rate card guidance only. Do not provide legal, tax, or financial advice.`,
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
  if (
    normalizedName.includes('talent advisor') ||
    normalizedName.includes('staffing') ||
    normalizedName.includes('salesforce') ||
    normalizedName.includes('sap') ||
    normalizedName.includes('oracle') ||
    normalizedName.includes('databricks') ||
    normalizedName.includes('snowflake') ||
    normalizedName.includes('openai') ||
    normalizedName.includes('claude') ||
    normalizedName.includes('cloud engineering') ||
    normalizedName.includes('managed pods')
  ) {
    return 'talent_advisor';
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
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  if (trimmed === '') return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Positive integer for max_tokens-style limits (avoids empty string env → 0 tokens). */
const positiveIntFromEnv = (value, fallback, min = 1) => {
  const n = numberFromEnv(value, fallback);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.floor(n);
};

const normalizeAssistantText = (content) => {
  if (content == null) return '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (part.type === 'text' && part.text) return part.text;
          if (part.text) return part.text;
        }
        return '';
      })
      .join('')
      .trim();
  }
  return String(content).trim();
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
    default: `Thanks for the details on ${topic}. I'll break it into goals, constraints, and next actions so you get an actionable plan right away. Share anything that's a must-have or blocker and I'll keep iterating with you.`,
    talent_advisor: `For ${topic}, I can suggest role mix, platform coverage (cloud/data/AI/enterprise), onshore-offshore split, and engagement options (staff augmentation or managed pods). Share your timeline, budget range, and priority skills and I will outline a practical hiring plan.`
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

const SOW_COLLECTION_SYSTEM = `You are a helpful assistant collecting details for a Statement of Work (SOW). Ask one short question at a time. Collect: (1) Short description of the request, (2) Expected budget in minutes or hours (required), (3) Expected deadline (date), (4) Deliverable format (Word/PDF/Excel/PowerPoint/Text), (5) Whether it is related to Suspense Tool or another tool (Yes/No), (6) Additional notes. Be concise and friendly. When the user has given at least a description and a valid budget (number), say you have enough to generate the SOW and ask if they want to add files or notes, or say "Ready to generate your SOW." Do not invent data. If the user's message contains multiple answers, extract what you can and ask for the rest. Reply with only the assistant message text, no JSON.`;

/**
 * Generate next AI message for Request a Service flow (SOW collection).
 * @param {Array<{role: string, content: string}>} messages - Conversation so far
 * @returns {{ aiMessage: string, collectedFields: object, readyForSow: boolean }}
 */
const generateRequestFlowResponse = async (messages = []) => {
  const client = getOpenAIClient();
  const fallback = {
    aiMessage: 'Please give a short description of your request.',
    collectedFields: {},
    readyForSow: false
  };
  if (!client) return fallback;

  try {
    const apiMessages = [
      { role: 'system', content: SOW_COLLECTION_SYSTEM },
      ...messages.slice(-14).map((m) => ({ role: m.role === 'bot' ? 'assistant' : m.role, content: m.content || m.text || '' }))
    ];

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: apiMessages,
      temperature: 0.5,
      max_tokens: 300
    });

    const content = (completion.choices?.[0]?.message?.content || '').trim();
    if (!content) return fallback;

    const readyForSow = /ready to generate|generate your sow|enough to generate/i.test(content);
    return {
      aiMessage: content,
      collectedFields: {},
      readyForSow
    };
  } catch (error) {
    console.error('Request flow OpenAI error:', error?.message);
    return fallback;
  }
};

/**
 * Long-form JSON generation for deck builders (uses same model as chat: gpt-4o-mini by default).
 * @returns {{ content: string|null, error: string|null, finishReason?: string }}
 */
const generateDeckJsonFromPrompt = async (userPrompt) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !String(key).trim()) {
    return { content: null, error: 'OPENAI_API_KEY is not set on the server.' };
  }
  const client = getOpenAIClient();
  if (!client) {
    return { content: null, error: 'OpenAI client could not be initialised (check OPENAI_API_KEY).' };
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const maxTokens = positiveIntFromEnv(process.env.OPENAI_DECK_MAX_TOKENS, 12000, 512);
  const useJsonObject =
    String(process.env.OPENAI_DECK_JSON_MODE || 'true').toLowerCase() !== 'false' &&
    !/^(gpt-3\.5|davinci)/i.test(model);

  try {
    const body = {
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a document engine for Tabalt Ltd. You must reply with a single valid JSON object only (no markdown fences, no text before or after). If you cannot comply, return {"error":"brief reason"}.'
        },
        {
          role: 'user',
          content: `${userPrompt}\n\nRespond with one JSON object only, matching the requested schema.`
        }
      ],
      temperature: numberFromEnv(process.env.OPENAI_DECK_TEMPERATURE, 0.35),
      max_tokens: maxTokens
    };
    if (useJsonObject) {
      body.response_format = { type: 'json_object' };
    }

    const completion = await client.chat.completions.create(body);
    const choice = completion.choices?.[0];
    const finishReason = choice?.finish_reason;
    const raw = normalizeAssistantText(choice?.message?.content);

    if (!raw) {
      const detail = finishReason ? `finish_reason=${finishReason}` : 'no choice content';
      console.error('generateDeckJsonFromPrompt empty content', { detail, model, maxTokens });
      return {
        content: null,
        error: `OpenAI returned an empty response (${detail}). If using a custom OPENAI_BASE_URL or model, try OPENAI_MODEL=gpt-4o-mini or set OPENAI_DECK_JSON_MODE=false.`,
        finishReason
      };
    }

    if (finishReason === 'length') {
      console.warn('generateDeckJsonFromPrompt: response may be truncated (length)');
    }

    return { content: raw, error: null, finishReason };
  } catch (error) {
    const msg = error?.message || 'OpenAI request failed';
    const status = error?.status || error?.response?.status;
    console.error('generateDeckJsonFromPrompt error:', msg, status, error?.code);
    return {
      content: null,
      error: status ? `${msg} (HTTP ${status})` : msg
    };
  }
};

/**
 * Deck AI edit with optional screenshots (vision) + long JSON output.
 */
const generateAgenciesDeckEditWithContext = async ({
  instruction,
  slidesJson,
  imageDataUrls = [],
  documentText = ''
}) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !String(key).trim()) {
    return { content: null, error: 'OPENAI_API_KEY is not set on the server.' };
  }
  const client = getOpenAIClient();
  if (!client) {
    return { content: null, error: 'OpenAI client could not be initialised.' };
  }
  const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const maxTokens = positiveIntFromEnv(process.env.OPENAI_DECK_MAX_TOKENS, 12000, 512);

  const textBlock = `Instruction:\n${instruction}\n\nCurrent slides JSON:\n${String(slidesJson).slice(0, 22000)}${
    documentText
      ? `\n\n---\nExtracted text from uploaded documents (may be partial):\n${String(documentText).slice(0, 14000)}`
      : ''
  }\n\nReturn JSON only: { "summary": string, "slides": [ full updated slides, same ids/types, all required fields per type ] }`;

  const userContent = [{ type: 'text', text: textBlock }];
  for (const url of imageDataUrls.slice(0, 8)) {
    if (url && typeof url === 'string') {
      userContent.push({ type: 'image_url', image_url: { url, detail: 'high' } });
    }
  }

  try {
    const body = {
      model,
      messages: [
        {
          role: 'system',
          content:
            'You edit Tabalt "First-Call Deck To Agencies" slides. Reply with ONE JSON object only: { "summary": string, "slides": array }. Each slide must keep valid "type" (agenda, companyProfile, portfolioGrid, askSamOverview, howWorks, caseStudies, serviceOptions, whyChoose, executivePage1, executivePage2). Include every slide from the input with the same ids; fill all fields so nothing renders blank. You may set image.url or heroImage.url to relevant https image URLs (e.g. Unsplash). No markdown.'
        },
        { role: 'user', content: userContent }
      ],
      temperature: numberFromEnv(process.env.OPENAI_DECK_TEMPERATURE, 0.35),
      max_tokens: maxTokens
    };
    if (String(process.env.OPENAI_DECK_JSON_MODE || 'true').toLowerCase() !== 'false') {
      body.response_format = { type: 'json_object' };
    }

    const completion = await client.chat.completions.create(body);
    const raw = normalizeAssistantText(completion.choices?.[0]?.message?.content);
    if (!raw) {
      return { content: null, error: 'OpenAI returned empty content for deck edit with context.' };
    }
    return { content: raw, error: null };
  } catch (error) {
    return { content: null, error: error?.message || 'OpenAI request failed' };
  }
};

const LIVE_PROMPTER_KNOWLEDGE_SYSTEM_INTERVIEW = `You consolidate candidate materials into ONE structured knowledge profile for a live job-interview prompter.
Rules:
- Use ONLY facts present in the supplied materials. Do not invent employers, dates, skills, certifications, or projects.
- If a section has no data, write "Not specified in provided materials."
- Output plain text with these section headings (exactly):
## Key skills
## Experience summary
## Projects
## Industries
## Strengths
## Career highlights
## Leadership / problem-solving examples
## LinkedIn reference
For LinkedIn: if only a URL was provided and no page text, write the URL and state that profile content was not fetched (reference only).`;

const LIVE_PROMPTER_KNOWLEDGE_SYSTEM_CLIENT = `You consolidate Tabalt sales and delivery materials into ONE structured knowledge profile for a live client-meeting prompter.
Rules:
- Use ONLY facts present in the supplied materials (deck, rate card, company profile, sales notes). Do not invent pricing, clients, or claims not stated.
- If a section has no data, write "Not specified in provided materials."
- Output plain text with these section headings (exactly):
## Tabalt positioning
## Services & staff augmentation
## Engagement models
## Pricing & value (value-based pricing if mentioned)
## Differentiators (boutique, flexible, high-trust; pre-trained workforce; free project coordinator; hire-to-payroll if mentioned)
## Credibility (BCG, Bain, McKinsey or other named clients only if present in materials)
## Client pain points & responses (budget, risk, training, trust)
## Key talking points`;

const LIVE_PROMPTER_ANSWER_INTERVIEW = `You are a live interview prompter helping the user answer job interview questions. Use the candidate's resume, experience documents, LinkedIn, and audio profile. Generate a concise, natural 1–2 line answer for each question. Do not invent experience. Apply the user's permanent training instructions.

Also: be professional and personal; highlight skills, achievements, experience, strengths, projects, domain knowledge, leadership, problem-solving, and clear communication — without sounding like a sales pitch. Only use what the knowledge repository supports.

You MUST follow the user's permanent training instructions below exactly when they are present.

Reply with ONLY numbered answers in plain text, one per line, in the form:
Answer 1: …
Answer 2: …
Use as many lines as there are questions. No preamble, no markdown, no extra commentary.`;

const LIVE_PROMPTER_ANSWER_CLIENT = `You are a live sales prompter helping the user represent Tabalt in a client meeting. Use the Tabalt PPT/PDF deck, rate card, company profile, and sales documents. Generate a concise, persuasive 1–2 line answer for each question that positions Tabalt as a boutique, flexible, high-trust staffing partner. Apply the user's permanent training instructions.

Emphasize value-based pricing, pre-trained workforce, free project coordinator, hire-to-payroll, speed, trust, and differentiation from typical agencies only when supported by the materials. Mention BCG, Bain, McKinsey only if they appear in the materials. Address client pain points (budget, risk, training, trust) when relevant.

You MUST follow the user's permanent training instructions below exactly when they are present.

Reply with ONLY numbered answers in plain text, one per line, in the form:
Answer 1: …
Answer 2: …
Use as many lines as there are questions. No preamble, no markdown, no extra commentary.`;

/**
 * Build structured knowledge profile from raw materials (GPT-4o-mini).
 * @param {string} rawBundle
 * @param {'interview'|'clientMeeting'} [knowledgeMode]
 * @returns {Promise<string>}
 */
const livePrompterSummarizeKnowledge = async (rawBundle, knowledgeMode = 'interview') => {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OpenAI is not configured (OPENAI_API_KEY).');
  }
  const system =
    knowledgeMode === 'clientMeeting' ? LIVE_PROMPTER_KNOWLEDGE_SYSTEM_CLIENT : LIVE_PROMPTER_KNOWLEDGE_SYSTEM_INTERVIEW;
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Materials to consolidate:\n\n${rawBundle.slice(0, 100000)}`
      }
    ],
    temperature: 0.25,
    max_tokens: positiveIntFromEnv(process.env.OPENAI_LIVE_PROMPTER_MAX_TOKENS, 2000, 200)
  });
  const out = normalizeAssistantText(completion.choices?.[0]?.message?.content);
  if (!out) throw new Error('OpenAI returned an empty knowledge profile.');
  return out;
};

/**
 * @param {{ questions: string[], structuredProfile: string, trainingInstructions?: string, prompterMode?: 'interview'|'clientMeeting' }} params
 * @returns {Promise<string>}
 */
const livePrompterSuggestAnswer = async ({
  questions,
  structuredProfile,
  trainingInstructions,
  prompterMode = 'interview'
}) => {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OpenAI is not configured (OPENAI_API_KEY).');
  }
  const qs = (questions || []).map((q) => String(q).trim()).filter(Boolean);
  if (!qs.length) {
    throw new Error('At least one question is required.');
  }
  const train = (trainingInstructions || '').trim();
  const base =
    prompterMode === 'clientMeeting' ? LIVE_PROMPTER_ANSWER_CLIENT : LIVE_PROMPTER_ANSWER_INTERVIEW;
  let systemContent = base;
  if (train) {
    systemContent += `\n\n--- User's permanent training instructions (apply to every answer) ---\n${train.slice(0, 8000)}`;
  }
  const numbered = qs.map((q, i) => `${i + 1}. ${q}`).join('\n');
  const profile = (structuredProfile || 'Empty.').slice(0, 60000);
  const repoLabel =
    prompterMode === 'clientMeeting' ? 'Tabalt knowledge repository' : 'Candidate profile (knowledge repository)';
  const userContent = `Detected question(s):
${numbered}

${repoLabel}: ${profile}

Respond with Answer 1, Answer 2, etc. — one concise natural 1–2 line answer per question, matching the numbering above.`;
  const maxTokens = Math.min(900, 140 + qs.length * 160);
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent }
    ],
    temperature: 0.4,
    max_tokens: maxTokens
  });
  const out = normalizeAssistantText(completion.choices?.[0]?.message?.content);
  if (!out) throw new Error('OpenAI returned an empty suggestion.');
  return out;
};

module.exports = {
  generateAIResponse,
  generateDeckJsonFromPrompt,
  generateAgenciesDeckEditWithContext,
  getServicePrompt,
  generateSalaryTemplate,
  generateExpenseTemplate,
  extractExpenseFieldsFromImage,
  generateRequestFlowResponse,
  getOpenAIClient,
  livePrompterSummarizeKnowledge,
  livePrompterSuggestAnswer
};

