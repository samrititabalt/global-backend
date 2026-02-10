const OpenAI = require('openai');

let client = null;
const getClient = () => {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined
    });
  }
  return client;
};

const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/** Use system date so GPT always bases prices and analysis on today, not training cut-off */
const getCurrentDate = () => new Date().toISOString().slice(0, 10);

const parseJson = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) try { return JSON.parse(m[0]); } catch (e2) {}
    return null;
  }
};

/** Suggest stock ticker/full name as user types (for autocomplete) */
exports.suggestStock = async (query) => {
  const c = getClient();
  if (!c) {
    return { symbol: query, name: query, suggestions: [] };
  }
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a stock identifier. Given a partial name or ticker, return JSON only: { "symbol": "primary ticker", "name": "full company name", "suggestions": [{"symbol":"...","name":"..."}] }. Focus on Nifty 50 / Indian and major US stocks if ambiguous.'
        },
        { role: 'user', content: `Identify this stock: "${query}". Reply with JSON only.` }
      ],
      temperature: 0.2,
      max_tokens: 300
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    return out || { symbol: query, name: query, suggestions: [] };
  } catch (err) {
    console.error('Ask Sandy suggestStock:', err?.message);
    return { symbol: query, name: query, suggestions: [] };
  }
};

/** Get current market price (GPT returns approximate; in production use Yahoo Finance etc.) */
exports.getStockPrice = async (symbolOrName) => {
  const c = getClient();
  const today = getCurrentDate();
  if (!c) {
    return { price: 0, date: today, source: 'unavailable' };
  }
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `IMPORTANT: Today's date is ${today}. You MUST use this date as the reference for "current" or "latest" price. Provide the most recent available market price for the stock as of or closest to ${today}. Do NOT use old dates (e.g. 2023). Your JSON "date" field MUST be "${today}" unless you have a specific different session date. Reply with JSON only: { "price": number, "date": "${today}", "currency": "INR or USD" }. If you cannot determine a current price, use a placeholder and set "note" to explain.`
        },
        { role: 'user', content: `Today is ${today}. Current market price for: ${symbolOrName}. JSON only.` }
      ],
      temperature: 0.1,
      max_tokens: 150
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    const date = out?.date || today;
    const price = typeof out?.price === 'number' ? out.price : (parseFloat(out?.price) || 0);
    return { price, date, currency: out?.currency || 'INR', note: out?.note };
  } catch (err) {
    console.error('Ask Sandy getStockPrice:', err?.message);
    return { price: 0, date: today, source: 'error' };
  }
};

/** Trade challenge: if user chose Sell, GPT may suggest Buy with reasons */
exports.tradeChallenge = async (stockName, userAction, timeframe, options = {}) => {
  const c = getClient();
  const today = getCurrentDate();
  const priceDate = options.priceAsOfDate || today;
  const currentPrice = options.currentPrice != null && Number.isFinite(Number(options.currentPrice)) ? Number(options.currentPrice) : null;
  if (!c) {
    return { suggestAction: userAction, reason: 'AI not configured.', shouldSwitch: false };
  }
  const priceContext = currentPrice != null
    ? ` The user's current market price for this stock (as of ${priceDate}) is ${currentPrice}. Use today's date (${today}) and this price level — do NOT use old data from 2023 or earlier.`
    : ` Use today's date ${today}. Do NOT use price levels or sentiment from 2023 or earlier.`;
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `IMPORTANT: Today's date is ${today}. Base all reasoning on market conditions, news, and sentiment as of THIS date. Do NOT use outdated dates (e.g. 2023).${priceContext}
You are a polite trading advisor. The user has chosen to ${userAction} for ${stockName} (timeframe: ${timeframe}). 
If they chose SELL but you believe the stock is likely to grow (fundamentals, sentiment, news as of ${today}), politely suggest they consider BUY instead and give 2-3 short reasons. Do NOT suggest Intraday vs Week vs Month - only Buy vs Sell.
If they chose BUY and you think it's reasonable, say "Your choice seems reasonable" and suggestAction: "buy".
Reply with JSON only: { "suggestAction": "buy" or "sell", "reason": "string", "shouldSwitch": boolean }.`
        },
        { role: 'user', content: `Today is ${today}. Stock: ${stockName}. Current price (reference): ${currentPrice != null ? currentPrice : 'not provided'}. User chose: ${userAction}. Timeframe: ${timeframe}.` }
      ],
      temperature: 0.5,
      max_tokens: 400
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    return out || { suggestAction: userAction, reason: '', shouldSwitch: false };
  } catch (err) {
    console.error('Ask Sandy tradeChallenge:', err?.message);
    return { suggestAction: userAction, reason: '', shouldSwitch: false };
  }
};

/** Two methodologies for target profit */
exports.twoMethodologies = async (stockName, action, timeframe, targetProfitAmount) => {
  const c = getClient();
  const today = getCurrentDate();
  if (!c) {
    return {
      multipleSmall: { title: 'Multiple Small Trades', steps: ['AI not configured.'] },
      fewBig: { title: 'Few Big Trades', steps: ['AI not configured.'] }
    };
  }
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `Today's date is ${today}. Base your strategy on current market context.
You are a trading strategy advisor. For the given stock, action (buy/sell), timeframe, and target profit in money, propose two methodologies:
1) Multiple Small Trades: several smaller trades over the period to reach the target.
2) Few Big Trades: one or two larger trades to reach the target.
Reply with JSON only: { "multipleSmall": { "title": "Multiple Small Trades", "steps": ["step1","step2",...] }, "fewBig": { "title": "Few Big Trades", "steps": ["step1","step2",...] } }.`
        },
        {
          role: 'user',
          content: `Today is ${today}. Stock: ${stockName}. Action: ${action}. Timeframe: ${timeframe}. Target profit: ${targetProfitAmount} (money).`
        }
      ],
      temperature: 0.4,
      max_tokens: 600
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    return out || {
      multipleSmall: { title: 'Multiple Small Trades', steps: [] },
      fewBig: { title: 'Few Big Trades', steps: [] }
    };
  } catch (err) {
    console.error('Ask Sandy twoMethodologies:', err?.message);
    return {
      multipleSmall: { title: 'Multiple Small Trades', steps: [] },
      fewBig: { title: 'Few Big Trades', steps: [] }
    };
  }
};

/** Build Nifty 50 list via GPT for admin seed */
exports.getNifty50List = async () => {
  const c = getClient();
  const fallback = [
    { symbol: 'RELIANCE', name: 'Reliance Industries Ltd' },
    { symbol: 'TCS', name: 'Tata Consultancy Services Ltd' },
    { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd' }
  ];
  if (!c) return fallback;
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an Indian stock market expert. List the current Nifty 50 index constituents. Reply with JSON only: { "stocks": [ { "symbol": "NSE ticker symbol", "name": "Full company name" }, ... ] }. Include exactly 50 stocks. Use standard NSE symbols.'
        },
        { role: 'user', content: 'List all Nifty 50 stocks with symbol and full name. JSON only.' }
      ],
      temperature: 0.2,
      max_tokens: 4000
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    if (out?.stocks?.length) return out.stocks;
    return fallback;
  } catch (err) {
    console.error('Ask Sandy getNifty50List:', err?.message);
    return fallback;
  }
};

/** Get method explanation when user has chosen multiple_small or few_big */
exports.methodExplanation = async (stockName, action, timeframe, targetProfit, method, options = {}) => {
  const c = getClient();
  const today = getCurrentDate();
  const priceDate = options.priceAsOfDate || today;
  const currentPrice = options.currentPrice != null && Number.isFinite(Number(options.currentPrice)) ? Number(options.currentPrice) : null;
  if (!c) return { steps: [], explanation: 'AI not configured.' };
  const priceContext = currentPrice != null
    ? ` User's current price (as of ${priceDate}): ${currentPrice}. Base steps on this price and today (${today}), not old data.`
    : ` Use today (${today}). Do not reference 2023 or old prices.`;
  try {
    const methodLabel = method === 'multiple_small' ? 'Multiple Small Trades' : 'Few Big Trades';
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `Today's date is ${today}.${priceContext}
You are a trading advisor. Explain the entire process in clear, numbered steps for the chosen strategy. User wants to ${action} ${stockName} over ${timeframe} with target profit ${targetProfit}. Strategy: ${methodLabel}. Be concise and actionable. Reply with JSON: { "steps": ["step1","step2",...], "explanation": "short summary" }`
        },
        { role: 'user', content: `Today is ${today}. Current price: ${currentPrice != null ? currentPrice : 'N/A'}. Explain the full process.` }
      ],
      temperature: 0.4,
      max_tokens: 500
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    return { steps: out?.steps || [], explanation: out?.explanation || '' };
  } catch (err) {
    console.error('Ask Sandy methodExplanation:', err?.message);
    return { steps: [], explanation: '' };
  }
};

/** Full analysis: 4 levers, 3 paragraphs (intraday/week/month), entry/exit ranges, stop loss, take profit */
exports.fullAnalysis = async (stockName, action, timeframe, leversConfig, options = {}) => {
  const c = getClient();
  const today = getCurrentDate();
  const priceDate = options.priceAsOfDate || today;
  const currentPriceAnchor = options.currentPrice != null && Number.isFinite(Number(options.currentPrice))
    ? Number(options.currentPrice)
    : null;
  const leverSummary = leversConfig && leversConfig.length
    ? leversConfig.map((l) => `${l.leverName}: intraday buy ${l.intradayBuyPct}% sell ${l.intradaySellPct}%, week buy ${l.weekBuyPct}% sell ${l.weekSellPct}%, month buy ${l.monthBuyPct}% sell ${l.monthSellPct}%`).join('; ')
    : 'No lever weights configured.';
  const fallback = {
    intradayParagraph: 'Analysis unavailable.',
    weeklyParagraph: 'Analysis unavailable.',
    monthlyParagraph: 'Analysis unavailable.',
    entryRange: '-',
    exitRange: '-',
    stopLoss: '-',
    takeProfit: '-'
  };
  if (!c) return fallback;
  const priceAnchorBlock = currentPriceAnchor != null
    ? `ANCHOR PRICE (MANDATORY): The user has provided the CURRENT MARKET PRICE for ${stockName} as of ${priceDate}: ${currentPriceAnchor}. You MUST use this as the ONLY baseline. Do NOT use any price, resistance level, or target from your training data (your data may be from 2023 or earlier). All entry range, exit range, stop loss, and take profit MUST be calculated relative to this current price (${currentPriceAnchor}). For example, if current price is ${currentPriceAnchor}, suggest entry/exit/stop/target as small percentages or absolute levels around ${currentPriceAnchor}, not old historical levels. Today's date is ${today}; treat ${priceDate} as the reference date for this price.`
    : `Today's date is ${today}. You do not have a user-provided current price; still do NOT use specific price levels from old training data (e.g. 2023). Use relative terms (e.g. "above recent support") or ask the user to provide current price for precise levels.`;
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `${priceAnchorBlock}

You are a stock analyst. Analyze the stock using these 4 levers (prioritize by the given weights):
1) Global market situation (as of ${today} — today's sentiment, geopolitics, rates)
2) Fundamentals of the stock
3) News & sentiment on the stock (current/recent, not 2023)
4) Technical analysis (moving averages, volumes) — relative to the anchor price above if given

Admin-configured lever weights: ${leverSummary}

Generate:
- 3 paragraphs: Intraday, Weekly, Monthly expectations (all as of ${today}; do not cite 2023 or old dates).
- Entry range, Exit range, Stop Loss, Take Profit: these MUST be relative to the current price (${currentPriceAnchor != null ? currentPriceAnchor : 'use relative language if no anchor given'}). Do not output 2023 price levels.

Reply with JSON only: {
  "intradayParagraph": "...",
  "weeklyParagraph": "...",
  "monthlyParagraph": "...",
  "entryRange": "e.g. 640-655 (relative to current price)",
  "exitRange": "e.g. 670-680",
  "stopLoss": "e.g. 630",
  "takeProfit": "e.g. 685"
}`
        },
        { role: 'user', content: `Reference date: ${priceDate}. Today: ${today}. Stock: ${stockName}. Current price (use this): ${currentPriceAnchor != null ? currentPriceAnchor : 'not provided'}. Action: ${action}. Timeframe: ${timeframe}.` }
      ],
      temperature: 0.4,
      max_tokens: 1200
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    const result = {
      intradayParagraph: out?.intradayParagraph || fallback.intradayParagraph,
      weeklyParagraph: out?.weeklyParagraph || fallback.weeklyParagraph,
      monthlyParagraph: out?.monthlyParagraph || fallback.monthlyParagraph,
      entryRange: out?.entryRange || fallback.entryRange,
      exitRange: out?.exitRange || fallback.exitRange,
      stopLoss: out?.stopLoss || fallback.stopLoss,
      takeProfit: out?.takeProfit || fallback.takeProfit
    };
    if (options.method && options.targetProfit) {
      const methodExp = await exports.methodExplanation(
        stockName,
        action,
        timeframe,
        options.targetProfit,
        options.method,
        { currentPrice: options.currentPrice, priceAsOfDate: options.priceAsOfDate }
      );
      result.methodExplanation = methodExp.explanation;
      result.methodSteps = methodExp.steps;
    }
    return result;
  } catch (err) {
    console.error('Ask Sandy fullAnalysis:', err?.message);
    return fallback;
  }
};
