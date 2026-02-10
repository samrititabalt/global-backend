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
  if (!c) {
    return { price: 0, date: new Date().toISOString().slice(0, 10), source: 'unavailable' };
  }
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You provide approximate current stock prices when possible. Reply with JSON only: { "price": number, "date": "YYYY-MM-DD", "currency": "INR or USD" }. If you cannot determine price, use a reasonable placeholder for that stock and say so in a "note" field. Be concise.'
        },
        { role: 'user', content: `Current market price for: ${symbolOrName}. JSON only.` }
      ],
      temperature: 0.1,
      max_tokens: 150
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    const date = out?.date || new Date().toISOString().slice(0, 10);
    const price = typeof out?.price === 'number' ? out.price : (parseFloat(out?.price) || 0);
    return { price, date, currency: out?.currency || 'INR', note: out?.note };
  } catch (err) {
    console.error('Ask Sandy getStockPrice:', err?.message);
    return { price: 0, date: new Date().toISOString().slice(0, 10), source: 'error' };
  }
};

/** Trade challenge: if user chose Sell, GPT may suggest Buy with reasons */
exports.tradeChallenge = async (stockName, userAction, timeframe) => {
  const c = getClient();
  if (!c) {
    return { suggestAction: userAction, reason: 'AI not configured.', shouldSwitch: false };
  }
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a polite trading advisor. The user has chosen to ${userAction} for ${stockName} (timeframe: ${timeframe}). 
If they chose SELL but you believe the stock is likely to grow (fundamentals, sentiment, news), politely suggest they consider BUY instead and give 2-3 short reasons. Do NOT suggest Intraday vs Week vs Month - only Buy vs Sell.
If they chose BUY and you think it's reasonable, say "Your choice seems reasonable" and suggestAction: "buy".
Reply with JSON only: { "suggestAction": "buy" or "sell", "reason": "string", "shouldSwitch": boolean }.`
        },
        { role: 'user', content: `Stock: ${stockName}. User chose: ${userAction}. Timeframe: ${timeframe}.` }
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
          content: `You are a trading strategy advisor. For the given stock, action (buy/sell), timeframe, and target profit in money, propose two methodologies:
1) Multiple Small Trades: several smaller trades over the period to reach the target.
2) Few Big Trades: one or two larger trades to reach the target.
Reply with JSON only: { "multipleSmall": { "title": "Multiple Small Trades", "steps": ["step1","step2",...] }, "fewBig": { "title": "Few Big Trades", "steps": ["step1","step2",...] } }.`
        },
        {
          role: 'user',
          content: `Stock: ${stockName}. Action: ${action}. Timeframe: ${timeframe}. Target profit: ${targetProfitAmount} (money).`
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
exports.methodExplanation = async (stockName, action, timeframe, targetProfit, method) => {
  const c = getClient();
  if (!c) return { steps: [], explanation: 'AI not configured.' };
  try {
    const methodLabel = method === 'multiple_small' ? 'Multiple Small Trades' : 'Few Big Trades';
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a trading advisor. Explain the entire process in clear, numbered steps for the chosen strategy. User wants to ${action} ${stockName} over ${timeframe} with target profit ${targetProfit}. Strategy: ${methodLabel}. Be concise and actionable. Reply with JSON: { "steps": ["step1","step2",...], "explanation": "short summary" }`
        },
        { role: 'user', content: 'Explain the full process.' }
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
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a stock analyst. Analyze the stock using these 4 levers (prioritize by the given weights):
1) Global market situation
2) Fundamentals of the stock
3) News & sentiment on the stock
4) Technical analysis (moving averages, volumes)

Admin-configured lever weights for this stock (use as prioritization): ${leverSummary}

Generate:
- 3 paragraphs: one for Intraday expectation, one for Weekly, one for Monthly.
- Entry price range and Exit price range (guidance only).
- Stop Loss price and Take Profit (Stop Profit) price.

Consider: last month intraday fluctuations, open/close for ~20 sessions, major news (US/India trade, geopolitics, Fed, employment, quarterly results, dividends), and overall sentiment for day/week/month.

Reply with JSON only: {
  "intradayParagraph": "...",
  "weeklyParagraph": "...",
  "monthlyParagraph": "...",
  "entryRange": "e.g. 2400-2420",
  "exitRange": "e.g. 2480-2500",
  "stopLoss": "e.g. 2350",
  "takeProfit": "e.g. 2520"
}`
        },
        { role: 'user', content: `Stock: ${stockName}. Action: ${action}. Timeframe: ${timeframe}.` }
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
        options.method
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
