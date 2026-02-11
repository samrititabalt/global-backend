const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const AskSandyUser = require('../models/AskSandyUser');
const AskSandyPortfolio = require('../models/AskSandyPortfolio');
const AskSandyTradeSession = require('../models/AskSandyTradeSession');
const AskSandyLever = require('../models/AskSandyLever');
const AskSandyInsight = require('../models/AskSandyInsight');
const AskSandyPendingApproval = require('../models/AskSandyPendingApproval');
const { protectAskSandy } = require('../middleware/askSandyAuth');
const generateAskSandyToken = require('../utils/askSandyJwt');
const askSandyService = require('../services/askSandyService');

const ASK_SANDY_APPROVER_EMAILS = ['tabaltllp@gmail.com', 'rainasarita72@gmail.com'];

function isAskSandyApprover(email) {
  return ASK_SANDY_APPROVER_EMAILS.includes((email || '').toLowerCase().trim());
}

// ---------- Auth ----------
// POST /api/ask-sandy/register (requires approval for non-approver emails)
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: errors.array().map((e) => e.msg).join('. '), errors: errors.array() });
      }
      const { name, email, password, approverEmail } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      const existing = await AskSandyUser.findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(400).json({ message: 'Email already registered.' });
      }

      if (isAskSandyApprover(normalizedEmail)) {
        const user = await AskSandyUser.create({ name, email: normalizedEmail, password });
        const token = generateAskSandyToken(user._id);
        return res.status(201).json({
          success: true,
          token,
          user: { id: user._id, name: user.name, email: user.email }
        });
      }

      const approvedPending = await AskSandyPendingApproval.findOne({
        requestedEmail: normalizedEmail,
        approved: true,
        used: false
      }).sort({ approvedAt: -1 });

      if (approvedPending) {
        const user = await AskSandyUser.create({ name, email: normalizedEmail, password });
        approvedPending.used = true;
        await approvedPending.save();
        const token = generateAskSandyToken(user._id);
        return res.status(201).json({
          success: true,
          token,
          user: { id: user._id, name: user.name, email: user.email }
        });
      }

      const pendingExists = await AskSandyPendingApproval.findOne({
        requestedEmail: normalizedEmail,
        approved: false
      });
      if (pendingExists) {
        return res.status(403).json({
          message: 'You have not been approved by the admin team yet. Reach out to the people who own these email addresses: tabaltllp@gmail.com, rainasarita72@gmail.com.'
        });
      }

      if (!approverEmail || !ASK_SANDY_APPROVER_EMAILS.includes((approverEmail || '').toLowerCase().trim())) {
        return res.status(403).json({
          message: 'To register with this email you need approval from one of the designated approvers. Please select which email is approving you (tabaltllp@gmail.com or rainasarita72@gmail.com) and submit the form. We will send an approval link to both; once one of them approves, you can complete registration here.'
        });
      }

      return res.status(403).json({
        message: 'Please use the form to request approval first. Select "Which email is approving you?", then submit. We will send an approval link to both approvers. After one of them approves, come back and register with the same email and password.'
      });
    } catch (err) {
      res.status(500).json({ message: 'Registration failed.', error: err.message });
    }
  }
);

// POST /api/ask-sandy/login
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: errors.array().map((e) => e.msg).join('. ') });
      }
      const { email, password } = req.body;
      const user = await AskSandyUser.findOne({ email: email.toLowerCase() }).select('+password');
      if (!user || !(await user.matchPassword(password))) {
        return res.status(401).json({ message: 'Invalid email or password.' });
      }
      const token = generateAskSandyToken(user._id);
      res.json({
        success: true,
        token,
        user: { id: user._id, name: user.name, email: user.email }
      });
    } catch (err) {
      res.status(500).json({ message: 'Login failed.', error: err.message });
    }
  }
);

// ---------- Portfolio (protected) ----------
// GET /api/ask-sandy/portfolio
router.get('/portfolio', protectAskSandy, async (req, res) => {
  try {
    const items = await AskSandyPortfolio.find({ userId: req.askSandyUser._id }).sort({ createdAt: -1 });
    res.json({ success: true, portfolio: items });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load portfolio.', error: err.message });
  }
});

// POST /api/ask-sandy/portfolio
router.post(
  '/portfolio',
  protectAskSandy,
  [
    body('stockName').trim().notEmpty().withMessage('Stock name required'),
    body('quantity').isFloat({ min: 0.0001 }).withMessage('Quantity must be positive'),
    body('avgBuyPrice').isFloat({ min: 0 }).withMessage('Average buy price must be non-negative')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: errors.array().map((e) => e.msg).join('. ') });
      }
      const { stockName, symbol, quantity, avgBuyPrice, currentPrice: userPrice, priceAsOfDate: userPriceDate } = req.body;
      const sym = symbol || stockName;
      let currentPrice = null;
      let priceAsOfDate = null;
      if (userPrice != null && userPrice !== '' && Number.isFinite(Number(userPrice))) {
        currentPrice = Number(userPrice);
        priceAsOfDate = userPriceDate ? new Date(userPriceDate) : new Date();
      } else {
        const priceResult = await askSandyService.getStockPrice(sym);
        currentPrice = priceResult.price;
        priceAsOfDate = priceResult.date ? new Date(priceResult.date) : new Date();
      }
      const item = await AskSandyPortfolio.create({
        userId: req.askSandyUser._id,
        stockName: stockName.trim(),
        symbol: (sym || '').trim(),
        quantity: Number(quantity),
        avgBuyPrice: Number(avgBuyPrice),
        currentPrice,
        priceAsOfDate
      });
      res.status(201).json({ success: true, item });
    } catch (err) {
      res.status(500).json({ message: 'Failed to add holding.', error: err.message });
    }
  }
);

// PATCH /api/ask-sandy/portfolio/:id
router.patch('/portfolio/:id', protectAskSandy, async (req, res) => {
  try {
    const item = await AskSandyPortfolio.findOne({
      _id: req.params.id,
      userId: req.askSandyUser._id
    });
    if (!item) return res.status(404).json({ message: 'Holding not found.' });
    const { stockName, symbol, quantity, avgBuyPrice, currentPrice, priceAsOfDate } = req.body;
    if (stockName !== undefined) item.stockName = stockName.trim();
    if (symbol !== undefined) item.symbol = symbol.trim();
    if (quantity !== undefined) item.quantity = Number(quantity);
    if (avgBuyPrice !== undefined) item.avgBuyPrice = Number(avgBuyPrice);
    if (currentPrice !== undefined && currentPrice !== '' && Number.isFinite(Number(currentPrice))) {
      item.currentPrice = Number(currentPrice);
      item.priceAsOfDate = priceAsOfDate ? new Date(priceAsOfDate) : new Date();
    }
    await item.save();
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ message: 'Update failed.', error: err.message });
  }
});

// DELETE /api/ask-sandy/portfolio/:id
router.delete('/portfolio/:id', protectAskSandy, async (req, res) => {
  try {
    const item = await AskSandyPortfolio.findOneAndDelete({
      _id: req.params.id,
      userId: req.askSandyUser._id
    });
    if (!item) return res.status(404).json({ message: 'Holding not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Delete failed.', error: err.message });
  }
});

// POST /api/ask-sandy/portfolio/refresh-prices
router.post('/portfolio/refresh-prices', protectAskSandy, async (req, res) => {
  try {
    const items = await AskSandyPortfolio.find({ userId: req.askSandyUser._id });
    const today = new Date().toISOString().slice(0, 10);
    for (const item of items) {
      const sym = item.symbol || item.stockName;
      const result = await askSandyService.getStockPrice(sym);
      item.currentPrice = result.price;
      item.priceAsOfDate = result.date ? new Date(result.date) : new Date();
      await item.save();
    }
    const updated = await AskSandyPortfolio.find({ userId: req.askSandyUser._id }).sort({ createdAt: -1 });
    res.json({ success: true, portfolio: updated });
  } catch (err) {
    res.status(500).json({ message: 'Refresh failed.', error: err.message });
  }
});

// ---------- Stock suggest (protected optional; can be public for UX) ----------
// POST /api/ask-sandy/stock-suggest
router.post('/stock-suggest', async (req, res) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) return res.json({ success: true, symbol: '', name: '', suggestions: [] });
    const result = await askSandyService.suggestStock(query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, symbol: query, name: query, suggestions: [] });
  }
});

// ---------- Trade flow ----------
// POST /api/ask-sandy/trade-challenge
router.post('/trade-challenge', protectAskSandy, async (req, res) => {
  try {
    const { stockName, action, timeframe, portfolioId, currentPrice: bodyPrice, priceAsOfDate: bodyDate } = req.body;
    if (!stockName || !action || !timeframe) {
      return res.status(400).json({ message: 'stockName, action, and timeframe required.' });
    }
    let currentPrice = bodyPrice != null ? Number(bodyPrice) : null;
    let priceAsOfDate = bodyDate || null;
    if (currentPrice == null && portfolioId) {
      const holding = await AskSandyPortfolio.findOne({
        _id: portfolioId,
        userId: req.askSandyUser._id
      });
      if (holding && holding.currentPrice != null) {
        currentPrice = Number(holding.currentPrice);
        priceAsOfDate = holding.priceAsOfDate ? new Date(holding.priceAsOfDate).toISOString().slice(0, 10) : null;
      }
    }
    const result = await askSandyService.tradeChallenge(stockName, action, timeframe, { currentPrice, priceAsOfDate });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ message: 'Challenge failed.', error: err.message });
  }
});

// POST /api/ask-sandy/trade-methodologies
router.post('/trade-methodologies', protectAskSandy, async (req, res) => {
  try {
    const { stockName, action, timeframe, targetProfit } = req.body;
    if (!stockName || !action || !timeframe || targetProfit == null) {
      return res.status(400).json({ message: 'stockName, action, timeframe, and targetProfit required.' });
    }
    const result = await askSandyService.twoMethodologies(
      stockName,
      action,
      timeframe,
      Number(targetProfit)
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get methodologies.', error: err.message });
  }
});

// POST /api/ask-sandy/trade-analysis
router.post('/trade-analysis', protectAskSandy, async (req, res) => {
  try {
    const { portfolioId, stockName, action, timeframe, targetProfit, method } = req.body;
    if (!stockName || !action || !timeframe) {
      return res.status(400).json({ message: 'stockName, action, and timeframe required.' });
    }
    let currentPrice = null;
    let priceAsOfDate = null;
    if (portfolioId) {
      const holding = await AskSandyPortfolio.findOne({
        _id: portfolioId,
        userId: req.askSandyUser._id
      });
      if (holding && holding.currentPrice != null) {
        currentPrice = Number(holding.currentPrice);
        priceAsOfDate = holding.priceAsOfDate ? new Date(holding.priceAsOfDate).toISOString().slice(0, 10) : null;
      }
    }
    if (currentPrice == null) {
      const holding = await AskSandyPortfolio.findOne({
        userId: req.askSandyUser._id,
        $or: [
          { stockName: new RegExp(stockName.trim(), 'i') },
          { symbol: new RegExp(stockName.trim(), 'i') }
        ]
      }).sort({ updatedAt: -1 });
      if (holding && holding.currentPrice != null) {
        currentPrice = Number(holding.currentPrice);
        priceAsOfDate = holding.priceAsOfDate ? new Date(holding.priceAsOfDate).toISOString().slice(0, 10) : null;
      }
    }
    const leverDoc = await AskSandyLever.findOne({
      $or: [
        { stockSymbol: stockName.trim() },
        { stockName: new RegExp(stockName.trim(), 'i') }
      ]
    });
    const leversConfig = leverDoc?.levers || [];
    const analysis = await askSandyService.fullAnalysis(stockName, action, timeframe, leversConfig, {
      targetProfit: targetProfit != null ? Number(targetProfit) : undefined,
      method: method || undefined,
      currentPrice: currentPrice != null ? currentPrice : undefined,
      priceAsOfDate: priceAsOfDate || undefined
    });
    const session = await AskSandyTradeSession.create({
      userId: req.askSandyUser._id,
      portfolioId: portfolioId || null,
      stockName,
      action,
      timeframe,
      targetProfit: targetProfit != null ? Number(targetProfit) : null,
      method: method || null,
      finalAction: action,
      analysis
    });
    res.json({ success: true, session, analysis });
  } catch (err) {
    res.status(500).json({ message: 'Analysis failed.', error: err.message });
  }
});

// GET /api/ask-sandy/trade-sessions
router.get('/trade-sessions', protectAskSandy, async (req, res) => {
  try {
    const sessions = await AskSandyTradeSession.find({ userId: req.askSandyUser._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load sessions.', error: err.message });
  }
});

// GET /api/ask-sandy/levers/:stockSymbol (for frontend to show lever config for a stock)
router.get('/levers/:stockSymbol', protectAskSandy, async (req, res) => {
  try {
    const doc = await AskSandyLever.findOne({
      $or: [
        { stockSymbol: req.params.stockSymbol },
        { stockName: new RegExp(req.params.stockSymbol, 'i') }
      ]
    });
    res.json({ success: true, levers: doc || null });
  } catch (err) {
    res.status(500).json({ success: false, levers: null });
  }
});

// POST /api/ask-sandy/question-analysis — user questions/challenges the analysis; GPT may revise
router.post('/question-analysis', protectAskSandy, async (req, res) => {
  try {
    const { stockName, action, timeframe, currentAnalysis, userQuestion } = req.body;
    if (!stockName || !action || !timeframe || !currentAnalysis || !userQuestion || typeof userQuestion !== 'string') {
      return res.status(400).json({ message: 'stockName, action, timeframe, currentAnalysis, and userQuestion (non-empty string) required.' });
    }
    const result = await askSandyService.questionAnalysis(
      stockName,
      action,
      timeframe,
      currentAnalysis,
      userQuestion.trim()
    );
    const insight = await AskSandyInsight.create({
      userId: req.askSandyUser._id,
      stockName,
      action,
      timeframe,
      userInput: userQuestion.trim(),
      gptResponse: result.explanation + (result.revisedAnalysis ? '\n[Revised analysis applied.]' : ''),
      fruitful: false,
      revisedAnalysis: result.revisedAnalysis || undefined
    });
    res.json({
      success: true,
      revisedAnalysis: result.revisedAnalysis,
      explanation: result.explanation,
      agreed: result.agreed,
      insightId: insight._id.toString()
    });
  } catch (err) {
    res.status(500).json({ message: 'Question analysis failed.', error: err.message });
  }
});

// POST /api/ask-sandy/portfolio-health — analyze portfolio and suggest reallocation (temperament, time horizon, reallocation preference)
router.post('/portfolio-health', protectAskSandy, async (req, res) => {
  try {
    const { userTemperament, timeHorizon, reallocationPreference } = req.body;
    if (!userTemperament || !timeHorizon || !reallocationPreference) {
      return res.status(400).json({ message: 'userTemperament, timeHorizon, and reallocationPreference are required.' });
    }
    const portfolioItems = await AskSandyPortfolio.find({ userId: req.askSandyUser._id }).sort({ createdAt: -1 }).lean();
    const symbols = [...new Set(portfolioItems.map((p) => (p.symbol || p.stockName || '').trim()).filter(Boolean))];
    const leverDocs = await AskSandyLever.find({
      $or: [
        { stockSymbol: { $in: symbols } },
        ...symbols.map((s) => ({ stockName: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }))
      ]
    }).lean();
    const leversBySymbol = {};
    leverDocs.forEach((doc) => {
      const key = doc.stockSymbol || doc.stockName || '';
      if (key) leversBySymbol[key] = doc;
    });
    portfolioItems.forEach((p) => {
      const sym = (p.symbol || p.stockName || '').trim();
      if (sym && !leversBySymbol[sym]) {
        const found = leverDocs.find((d) => d.stockName && String(d.stockName).toLowerCase().includes(sym.toLowerCase()));
        if (found) leversBySymbol[sym] = found;
      }
    });
    const result = await askSandyService.portfolioHealthAnalysis(
      portfolioItems,
      userTemperament,
      timeHorizon,
      reallocationPreference,
      leversBySymbol
    );
    res.json({ success: true, summary: result.summary, actions: result.actions });
  } catch (err) {
    res.status(500).json({ message: 'Portfolio health analysis failed.', error: err.message });
  }
});

// POST /api/ask-sandy/insight-mark-fruitful — mark a user insight as helpful so it improves future analyses
router.post('/insight-mark-fruitful', protectAskSandy, async (req, res) => {
  try {
    const { insightId } = req.body;
    if (!insightId) {
      return res.status(400).json({ message: 'insightId required.' });
    }
    const insight = await AskSandyInsight.findOne({
      _id: insightId,
      userId: req.askSandyUser._id
    });
    if (!insight) {
      return res.status(404).json({ message: 'Insight not found.' });
    }
    insight.fruitful = true;
    await insight.save();
    res.json({ success: true, message: 'Marked as helpful; this insight will improve future analyses.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark insight.', error: err.message });
  }
});

module.exports = router;
