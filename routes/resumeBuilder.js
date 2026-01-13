const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { generateAIResponse } = require('../services/openaiService');
const User = require('../models/User');
const ResumeBuilderUsage = require('../models/ResumeBuilderUsage');
const Activity = require('../models/Activity');

// Configure multer for temporary image storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = 'uploads/resume-images/';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Use user ID + timestamp for unique filename
    const userId = req.user._id.toString();
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${userId}-${timestamp}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPG, and JPEG images are allowed'), false);
    }
  }
});

// @route   GET /api/resume-builder/usage
// @desc    Get customer's remaining usage
// @access  Private (Customer)
router.get('/usage', protect, authorize('customer'), async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Count actual usage from ResumeBuilderUsage records
    const actualUsageCount = await ResumeBuilderUsage.countDocuments({ customer: user._id });
    
    // Calculate correct remaining: 100 - actualUsageCount
    const correctRemaining = 100 - actualUsageCount;
    
    // If the stored value doesn't match the calculated value, update it
    // This ensures existing customers get the updated limit automatically
    if (user.resumeBuilderUsageRemaining !== correctRemaining) {
      user.resumeBuilderUsageRemaining = correctRemaining;
      await user.save();
    }
    
    res.json({
      success: true,
      usageRemaining: user.resumeBuilderUsageRemaining
    });
  } catch (error) {
    console.error('Error fetching usage:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/resume-builder/generate
// @desc    Generate resume using GPT-4 Mini
// @access  Private (Customer)
router.post('/generate', protect, authorize('customer'), upload.single('profileImage'), async (req, res) => {
  let imagePath = null;
  
  try {
    const { jobDescription, resumeText, instructions } = req.body;
    const user = req.user;

    // Validate inputs
    if (!jobDescription || !resumeText) {
      return res.status(400).json({ message: 'Job description and resume text are required' });
    }

    // Check usage limit
    // Exception: Allow unlimited usage for spbajaj25@gmail.com
    const userDoc = await User.findById(user._id);
    const isOwnerEmail = userDoc.email && userDoc.email.toLowerCase() === 'spbajaj25@gmail.com';
    
    if (!isOwnerEmail && userDoc.resumeBuilderUsageRemaining <= 0) {
      return res.status(403).json({ message: 'Usage limit reached. Please contact support.' });
    }

    // Handle image upload
    if (req.file) {
      imagePath = req.file.path;
    }

    // Convert image to base64 if provided
    let imageBase64 = null;
    if (imagePath && fs.existsSync(imagePath)) {
      const imageBuffer = fs.readFileSync(imagePath);
      imageBase64 = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;
    }

    // Build GPT prompt for resume generation
    const defaultFormat = instructions || `Create a professional 2-page resume with:
- Page 1: Personal details with profile picture (if provided), clean modern fonts, charts/icons for visual elements, auto-extracted career journey map, and for sales roles include wins/revenue/accounts won section
- Page 2: Dedicated to Projects using STAR methodology (Situation, Task, Action, Result). Generate synthetic but realistic project descriptions if user provides limited info.
Use HTML/CSS for formatting. Make it visually appealing with modern design.`;

    const systemPrompt = `You are an expert resume writer. Generate a professional, ATS-friendly resume in complete HTML format.
The resume must be:
- Well-structured with proper HTML tags
- Include inline CSS for all styling
- Optimized for the job description
- Visually appealing with modern design
- Ready to be rendered directly in a browser
- Include proper page breaks for 2-page layout
${defaultFormat}
Return ONLY the complete HTML code without markdown formatting or code blocks. Start directly with <!DOCTYPE html> or <div> tags.`;

    const userPrompt = `Job Description:
${jobDescription}

User's Resume Text:
${resumeText}

${instructions ? `Additional Instructions:\n${instructions}` : 'Use the default 2-page format with career journey map and STAR methodology projects.'}

${imageBase64 ? 'A profile picture will be included separately in the header area.' : 'No profile picture provided.'}

Generate the complete resume HTML now. Make sure it's professional, well-formatted, and matches the job requirements.`;

    // Generate resume using GPT-4 Mini
    // Use OpenAI client directly with custom system prompt
    const OpenAI = require('openai');
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined
    });

    let resumeHTML = '';
    try {
      const completion = await openaiClient.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000
      });

      resumeHTML = completion.choices?.[0]?.message?.content?.trim() || '';
      
      if (!resumeHTML) {
        throw new Error('OpenAI returned empty response');
      }
      
      // Clean up the response (remove markdown code blocks if present)
      resumeHTML = resumeHTML.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
    } catch (openaiError) {
      console.error('OpenAI API error:', openaiError);
      throw new Error('Failed to generate resume. Please try again.');
    }

    // Track usage
    await ResumeBuilderUsage.create({
      customer: user._id,
      usedAt: new Date()
    });

    // Track activity
    Activity.create({
      type: 'resume_generated',
      description: `Resume generated by customer: ${userDoc.name} (${userDoc.email})`,
      user: user._id,
      metadata: { email: userDoc.email, name: userDoc.name }
    }).catch(err => console.error('Error creating activity:', err));

    // Decrement usage count (skip for owner email)
    if (!isOwnerEmail) {
      userDoc.resumeBuilderUsageRemaining = Math.max(0, userDoc.resumeBuilderUsageRemaining - 1);
      await userDoc.save();
    }

    // Delete uploaded image immediately after processing
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
      } catch (deleteError) {
        console.error('Error deleting image:', deleteError);
      }
    }

    // Inject image into HTML if provided (before deletion)
    let finalResumeHTML = resumeHTML;
    if (imageBase64) {
      // Try to inject image into the HTML
      finalResumeHTML = resumeHTML.replace(
        /<img[^>]*src=["'][^"']*["'][^>]*>/i,
        `<img src="${imageBase64}" alt="Profile Picture" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover;" />`
      );
      // If no img tag found, add it to the beginning
      if (!resumeHTML.includes('<img')) {
        finalResumeHTML = `<div style="text-align: center; margin-bottom: 20px;"><img src="${imageBase64}" alt="Profile Picture" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover;" /></div>${resumeHTML}`;
      }
    }

    res.json({
      success: true,
      resume: finalResumeHTML,
      usageRemaining: isOwnerEmail ? 'unlimited' : userDoc.resumeBuilderUsageRemaining
    });

  } catch (error) {
    console.error('Error generating resume:', error);
    
    // Clean up image if error occurred
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
      } catch (deleteError) {
        console.error('Error deleting image on error:', deleteError);
      }
    }
    
    res.status(500).json({ message: 'Failed to generate resume', error: error.message });
  }
});

// @route   DELETE /api/resume-builder/image
// @desc    Delete uploaded image (cleanup endpoint)
// @access  Private (Customer)
router.delete('/image', protect, authorize('customer'), async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const uploadPath = 'uploads/resume-images/';
    
    // Find and delete user's images
    if (fs.existsSync(uploadPath)) {
      const files = fs.readdirSync(uploadPath);
      files.forEach(file => {
        if (file.startsWith(userId)) {
          try {
            fs.unlinkSync(path.join(uploadPath, file));
          } catch (err) {
            console.error('Error deleting file:', err);
          }
        }
      });
    }
    
    res.json({ success: true, message: 'Image deleted' });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
