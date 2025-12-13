const express = require('express');
const router = express.Router();
const Plan = require('../models/Plan');
const { ensureDefaultPlans, formatPlanForResponse } = require('../utils/planDefaults');

router.get('/plans', async (req, res) => {
  try {
    await ensureDefaultPlans();
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    res.json({
      success: true,
      plans: plans.map(formatPlanForResponse),
    });
  } catch (error) {
    console.error('Public plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to load plans at this time.',
    });
  }
});

module.exports = router;
