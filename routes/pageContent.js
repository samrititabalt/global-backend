const express = require('express');
const router = express.Router();
const PageContent = require('../models/PageContent');
const { protect } = require('../middleware/auth');

// Get all pages with content (admin only - for content management dashboard)
// IMPORTANT: This route must come BEFORE /:pagePath to avoid route conflicts
router.get('/admin/all', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only admins can access this endpoint' 
      });
    }
    
    const allPages = await PageContent.find({})
      .populate('updatedBy', 'name email')
      .sort({ lastUpdated: -1 });
    
    res.json({ 
      success: true, 
      pages: allPages 
    });
  } catch (error) {
    console.error('Error fetching all page content:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch page content' 
    });
  }
});

// Get content for a specific page (public - for rendering)
router.get('/:pagePath', async (req, res) => {
  try {
    const { pagePath } = req.params;
    const normalizedPath = pagePath === 'home' ? '/' : `/${pagePath}`;
    
    const pageContent = await PageContent.findOne({ 
      pagePath: normalizedPath 
    });
    
    if (!pageContent) {
      return res.json({ 
        success: true, 
        content: null,
        message: 'No custom content found, using defaults' 
      });
    }
    
    res.json({ 
      success: true, 
      content: pageContent 
    });
  } catch (error) {
    console.error('Error fetching page content:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch page content' 
    });
  }
});

// Update content for a page (admin only)
router.put('/:pagePath', protect, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only admins can edit page content' 
      });
    }
    
    const { pagePath } = req.params;
    const { contentBlocks } = req.body;
    const normalizedPath = pagePath === 'home' ? '/' : `/${pagePath}`;
    
    if (!contentBlocks || !Array.isArray(contentBlocks)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid content blocks format' 
      });
    }
    
    // Validate each content block
    for (const block of contentBlocks) {
      if (!block.blockId || !block.blockType || !block.content) {
        return res.status(400).json({ 
          success: false, 
          message: 'Each content block must have blockId, blockType, and content' 
        });
      }
    }
    
    const updateData = {
      contentBlocks,
      lastUpdated: new Date(),
      updatedBy: req.user._id,
    };
    
    const pageContent = await PageContent.findOneAndUpdate(
      { pagePath: normalizedPath },
      updateData,
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true,
      }
    );
    
    res.json({ 
      success: true, 
      message: 'Page content updated successfully',
      content: pageContent 
    });
  } catch (error) {
    console.error('Error updating page content:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update page content' 
    });
  }
});

module.exports = router;
