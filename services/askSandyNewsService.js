const OpenAI = require('openai');
const AskSandyNews = require('../models/AskSandyNews');
const AskSandyRating = require('../models/AskSandyRating');
const AskSandyVerdict = require('../models/AskSandyVerdict');
const AskSandyLever = require('../models/AskSandyLever');

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

const SECTORS = ['Metals', 'Energy', 'Banks', 'IT', 'FMCG', 'Pharma', 'Auto', 'Realty', 'Telecom', 'Media', 'Consumer', 'Industrials', 'Materials', 'Healthcare', 'Financials'];
const COMMODITIES = ['Gold', 'Silver', 'Crude Oil', 'Copper'];
const CURRENCIES = ['GBP/USD', 'USD/JPY'];

/** Assign AI rating 1-10 to a single news item (10=strongly bullish, 1=strongly bearish) */
exports.rateNewsItem = async (newsId) => {
  const c = getClient();
  const news = await AskSandyNews.findById(newsId).lean();
  if (!news || !c) return null;
  const manual = news.manualRating != null ? Number(news.manualRating) : null;
  if (manual >= 1 && manual <= 10) {
    await AskSandyNews.updateOne({ _id: newsId }, { aiRating: manual });
    return manual;
  }
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You rate news impact on markets. Reply with JSON only: { "rating": number 1-10 }. 10 = strongly bullish for relevant assets, 1 = strongly bearish. Base it on headline and summary only.'
        },
        {
          role: 'user',
          content: `Headline: ${news.headline}\nSummary: ${news.summary || 'N/A'}\nCategory: ${news.category}. Give rating 1-10. JSON only.`
        }
      ],
      temperature: 0.2,
      max_tokens: 50
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    const rating = Math.max(1, Math.min(10, Math.round(Number(out?.rating) || 5)));
    await AskSandyNews.updateOne({ _id: newsId }, { aiRating: rating });
    return rating;
  } catch (err) {
    console.error('Ask Sandy rateNewsItem:', err?.message);
    return null;
  }
};

/** Get all entities to rate: sectors, stocks (from AskSandyLever or Nifty), commodities, currencies */
async function getEntitiesToRate() {
  const stocks = await AskSandyLever.find({}).select('stockSymbol stockName').lean();
  return {
    sectors: SECTORS,
    stocks: stocks.map((s) => ({ id: s.stockSymbol, name: s.stockName || s.stockSymbol })),
    commodities: COMMODITIES.map((name) => ({ id: name, name })),
    currencies: CURRENCIES.map((name) => ({ id: name, name }))
  };
}

/** Compute daily ratings from aggregated news for current month; store in AskSandyRating */
exports.computeDailyRatings = async (year, month) => {
  const c = getClient();
  const entities = await getEntitiesToRate();
  const news = await AskSandyNews.find({ year, month }).lean();
  if (!news.length || !c) return { ok: false, message: 'No news or AI not configured.' };

  const newsSummary = news.map((n) => `[${n.category}] ${n.headline} (rating: ${n.aiRating ?? n.manualRating ?? '?'})`).join('\n');

  const today = new Date();
  const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  try {
    const allEntities = [
      ...entities.sectors.map((s) => ({ type: 'sector', id: s, name: s })),
      ...entities.stocks.map((s) => ({ type: 'stock', id: s.id, name: s.name })),
      ...entities.commodities.map((c) => ({ type: 'commodity', id: c.id, name: c.name })),
      ...entities.currencies.map((c) => ({ type: 'currency', id: c.id, name: c.name }))
    ].filter((e) => e.id);
    const batchSize = 30;
    for (let i = 0; i < allEntities.length; i += batchSize) {
      const batch = allEntities.slice(i, i + batchSize);
      const list = batch.map((e) => `${e.type}:${e.id}`).join(', ');
      const completion = await c.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `You assign a daily rating 1-10 for each entity based ONLY on the news provided. 10=strongly bullish, 1=strongly bearish. Reply with JSON only: { "ratings": { "entityType_entityId": number } } e.g. { "ratings": { "sector_Metals": 6, "stock_RELIANCE": 7 } }. Include exactly one entry per entity in the list.`
          },
          {
            role: 'user',
            content: `News:\n${newsSummary}\n\nEntities to rate: ${list}\n\nJSON only.`
          }
        ],
        temperature: 0.3,
        max_tokens: 800
      });
      const text = completion.choices?.[0]?.message?.content?.trim();
      const out = parseJson(text);
      const ratings = out?.ratings && typeof out.ratings === 'object' ? out.ratings : {};
      for (const e of batch) {
        const key = `${e.type}_${e.id}`;
        const val = ratings[key] ?? ratings[e.id] ?? 5;
        const rating = Math.max(1, Math.min(10, Math.round(Number(val) || 5)));
        await AskSandyRating.findOneAndUpdate(
          { entityType: e.type, entityId: e.id, date: dateOnly },
          { $set: { entityName: e.name, rating, month, year } },
          { upsert: true, new: true }
        );
      }
    }
    return { ok: true };
  } catch (err) {
    console.error('Ask Sandy computeDailyRatings:', err?.message);
    return { ok: false, error: err.message };
  }
};

/** Compute monthly verdicts from ratings/news for each entity */
exports.computeMonthlyVerdicts = async (year, month) => {
  const c = getClient();
  const entities = await getEntitiesToRate();
  const news = await AskSandyNews.find({ year, month }).lean();
  const ratings = await AskSandyRating.find({ year, month }).lean();
  if (!c) return { ok: false, message: 'AI not configured.' };

  const newsText = news.map((n) => `${n.headline} (${n.aiRating ?? n.manualRating ?? '?'}/10)`).join('\n');
  const ratingText = ratings.map((r) => `${r.entityType} ${r.entityId}: ${r.rating}/10`).join('\n');

  const allEntities = [
    ...entities.sectors.map((s) => ({ type: 'sector', id: s, name: s })),
    ...entities.stocks.map((s) => ({ type: 'stock', id: s.id, name: s.name })),
    ...entities.commodities.map((c) => ({ type: 'commodity', id: c.id, name: c.name })),
    ...entities.currencies.map((c) => ({ type: 'currency', id: c.id, name: c.name }))
  ];
  const verdicts = ['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'];

  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You produce a final monthly verdict for each entity based ONLY on news and daily ratings. Reply with JSON: { "verdicts": [ { "entityType": "sector|stock|commodity|currency", "entityId": "id", "entityName": "name", "finalRating": 1-10, "verdict": "Strong Buy|Buy|Hold|Sell|Strong Sell", "explanation": "short reason" } ] }. Use only news and aggregated impact; no technical/fundamental analysis.`
        },
        {
          role: 'user',
          content: `News:\n${newsText}\n\nDaily ratings:\n${ratingText}\n\nEntities: ${JSON.stringify(allEntities)}\n\nOutput verdicts for each entity. JSON only.`
        }
      ],
      temperature: 0.3,
      max_tokens: 4000
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    const list = Array.isArray(out?.verdicts) ? out.verdicts : [];
    for (const v of list) {
      if (!v.entityType || !v.entityId || !verdicts.includes(v.verdict)) continue;
      await AskSandyVerdict.findOneAndUpdate(
        { entityType: v.entityType, entityId: v.entityId, year, month },
        {
          $set: {
            entityName: v.entityName || v.entityId,
            finalRating: Math.max(1, Math.min(10, Math.round(Number(v.finalRating) || 5))),
            verdict: v.verdict,
            explanation: v.explanation || ''
          }
        },
        { upsert: true, new: true }
      );
    }
    return { ok: true };
  } catch (err) {
    console.error('Ask Sandy computeMonthlyVerdicts:', err?.message);
    return { ok: false, error: err.message };
  }
};

/** Get rating and verdict for an entity (stock/sector/commodity/currency) for display on user dashboard */
exports.getRatingAndVerdictForEntity = async (entityType, entityId, currentPrice) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const rating = await AskSandyRating.findOne({ entityType, entityId, year, month }).sort({ date: -1 }).lean();
  const verdict = await AskSandyVerdict.findOne({ entityType, entityId, year, month }).lean();
  const news = await AskSandyNews.find({ year, month }).lean();
  const c = getClient();
  let explanation = verdict?.explanation || '';
  let whyCorrect = '';

  if (c && (rating || verdict)) {
    try {
      const completion = await c.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You explain the rating and verdict in 2-3 short sentences for a retail user. Base ONLY on news. Reply JSON: { "explanation": "why this rating", "whyCorrect": "why this rating is correct", "influentialNews": "which news influenced" }.'
          },
          {
            role: 'user',
            content: `Entity: ${entityType} ${entityId}. Current rating: ${rating?.rating ?? verdict?.finalRating ?? 'N/A'}/10. Verdict: ${verdict?.verdict || 'N/A'}. News this month: ${news.slice(0, 15).map((n) => n.headline).join('; ')}. Write short explanation and why this rating is correct.`
          }
        ],
        temperature: 0.3,
        max_tokens: 400
      });
      const text = completion.choices?.[0]?.message?.content?.trim();
      const out = parseJson(text);
      if (out?.explanation) explanation = out.explanation;
      if (out?.whyCorrect) whyCorrect = out.whyCorrect;
    } catch (e) {
      console.error('Ask Sandy getRatingAndVerdictForEntity:', e?.message);
    }
  }

  return {
    rating: rating?.rating ?? verdict?.finalRating ?? null,
    verdict: verdict?.verdict ?? null,
    explanation,
    whyCorrect,
    entityType,
    entityId
  };
};

/** Generate buy/sell strategy from news only (short-term 1-3 months): entry, exit, stop-loss, take-profit, few vs many trades */
exports.getNewsBasedStrategy = async (stockName, currentPrice) => {
  const c = getClient();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const news = await AskSandyNews.find({ year, month }).lean();
  const lever = await AskSandyLever.findOne({
    $or: [
      { stockSymbol: new RegExp(`^${String(stockName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      { stockName: new RegExp(String(stockName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    ]
  }).lean();
  const entityId = lever?.stockSymbol || stockName;
  const verdict = await AskSandyVerdict.findOne({ entityType: 'stock', entityId, year, month }).lean();
  const fallback = {
    entryRange: '-',
    exitRange: '-',
    stopLoss: '-',
    takeProfit: '-',
    tradeStyle: 'Multiple small trades',
    explanation: 'Strategy unavailable.'
  };
  if (!c) return fallback;

  const newsText = news.map((n) => `${n.headline} (${n.aiRating ?? n.manualRating ?? '?'}/10)`).join('\n');
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You suggest a SHORT-TERM (1-3 months) buy/sell strategy based ONLY on news and sentiment. No technical/fundamental analysis. Assume time horizon is 1-3 months only. Reply JSON: { "entryRange": "e.g. 640-655", "exitRange": "e.g. 670-680", "stopLoss": "e.g. 630", "takeProfit": "e.g. 685", "tradeStyle": "Few large trades" or "Multiple small trades", "explanation": "short reason" }. All levels must be relative to current price if provided.`
        },
        {
          role: 'user',
          content: `Stock: ${stockName}. Current price: ${currentPrice != null ? currentPrice : 'unknown'}. News: ${newsText}. Verdict: ${verdict?.verdict || 'N/A'}. Give short-term strategy. JSON only.`
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    const out = parseJson(text);
    return {
      entryRange: out?.entryRange || fallback.entryRange,
      exitRange: out?.exitRange || fallback.exitRange,
      stopLoss: out?.stopLoss || fallback.stopLoss,
      takeProfit: out?.takeProfit || fallback.takeProfit,
      tradeStyle: out?.tradeStyle || fallback.tradeStyle,
      explanation: out?.explanation || fallback.explanation
    };
  } catch (err) {
    console.error('Ask Sandy getNewsBasedStrategy:', err?.message);
    return fallback;
  }
};

/** User challenges or questions the news-based rating; GPT responds conversationally and defends/updates reasoning */
exports.challengeRating = async (stockName, rating, verdict, explanation, userQuestion) => {
  const c = getClient();
  const fallback = { explanation: 'AI is not available to respond.' };
  if (!c) return fallback;
  try {
    const completion = await c.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are Sandy, a news-driven stock analyst. The user is challenging or questioning your analysis for ${stockName}. Your current view: Rating ${rating}/10, Verdict: ${verdict}. Explanation: ${explanation || 'N/A'}. Respond conversationally: defend your analysis when appropriate, and if the user provides new information you agree with, acknowledge it and update your reasoning. Do not make up facts. Reply in plain text (no JSON). Keep the response concise (2-5 sentences).`
        },
        {
          role: 'user',
          content: userQuestion
        }
      ],
      temperature: 0.4,
      max_tokens: 500
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    return { explanation: text || fallback.explanation };
  } catch (err) {
    console.error('Ask Sandy challengeRating:', err?.message);
    return fallback;
  }
};

module.exports.SECTORS = SECTORS;
module.exports.COMMODITIES = COMMODITIES;
module.exports.CURRENCIES = CURRENCIES;
