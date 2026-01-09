const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getFacebookAuthUrl,
  handleFacebookCallback,
  launchQuickCampaign,
  getConnectionStatus,
  FRONTEND_URL,
} = require('../services/facebookAdsService');

router.get('/status', protect, async (req, res) => {
  try {
    const status = await getConnectionStatus(req.user._id);
    res.json(status);
  } catch (error) {
    console.error('Facebook status error:', error);
    res.status(500).json({ message: 'Unable to load Facebook status', error: error.message });
  }
});

router.get('/oauth-url', protect, async (req, res) => {
  try {
    const url = getFacebookAuthUrl(req.user);
    res.json({ url });
  } catch (error) {
    console.error('Facebook OAuth URL error:', error);
    res.status(500).json({ message: 'Unable to generate OAuth URL', error: error.message });
  }
});

router.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).json({ message: 'Missing code or state' });
  }

  try {
    await handleFacebookCallback({ code, state });
    return res.redirect(
      `${FRONTEND_URL.replace(/\/$/, '')}/solutions/facebook-ads?fb_connected=1`
    );
  } catch (error) {
    console.error('Facebook OAuth callback error:', error);
    return res.redirect(
      `${FRONTEND_URL.replace(/\/$/, '')}/solutions/facebook-ads?fb_error=1`
    );
  }
});

router.post('/launch', protect, async (req, res) => {
  const { goal, dailyBudget, destinationUrl, businessCategory } = req.body;

  if (!goal || !dailyBudget || !destinationUrl || !businessCategory) {
    return res.status(400).json({ message: 'Missing campaign parameters' });
  }

  try {
    const result = await launchQuickCampaign({
      userId: req.user._id,
      goal,
      dailyBudget,
      destinationUrl,
      businessCategory,
    });

    res.json({
      message: 'Campaign launched successfully',
      ...result,
    });
  } catch (error) {
    if (error.code === 'FACEBOOK_NOT_CONNECTED') {
      return res.status(409).json({ message: 'Facebook account not connected' });
    }

    console.error('Facebook launch error:', error?.response?.data || error);
    res.status(500).json({
      message: 'Unable to launch campaign',
      error: error?.response?.data || error.message,
    });
  }
});

module.exports = router;

