const express = require('express');
const router = express.Router();
const TextContent = require('../models/TextContent');
const { protect } = require('../middleware/auth');

// Get content for a specific page (public - for rendering)
router.get('/page/:page', async (req, res) => {
  try {
    const page = req.params.page;
    if (page === 'home' || page === 'common') {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Surrogate-Control', 'no-store');
    }
    const content = await TextContent.find({ page }).sort({ contentKey: 1 });
    res.json({ success: true, content });
  } catch (error) {
    console.error('Error fetching text content:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch text content' });
  }
});

// Get content for a list of keys (public - for rendering)
router.get('/keys', async (req, res) => {
  try {
    const keysParam = req.query.keys || '';
    const keys = keysParam.split(',').map((key) => key.trim()).filter(Boolean);
    if (!keys.length) {
      return res.json({ success: true, content: [] });
    }

    const content = await TextContent.find({ contentKey: { $in: keys } });
    res.json({ success: true, content });
  } catch (error) {
    console.error('Error fetching text content by keys:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch text content' });
  }
});

// Update content (admin only)
router.put('/', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can edit content' });
    }

    const { contentKey, page, section, textValue } = req.body;
    if (!contentKey || !page || typeof textValue !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'contentKey, page, and textValue are required',
      });
    }

    const update = {
      contentKey,
      page,
      section: section || '',
      textValue: textValue.trim(),
      lastUpdated: new Date(),
      updatedBy: req.user._id,
    };

    const content = await TextContent.findOneAndUpdate(
      { contentKey },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, content });
  } catch (error) {
    console.error('Error updating text content:', error);
    res.status(500).json({ success: false, message: 'Failed to update text content' });
  }
});

module.exports = router;
