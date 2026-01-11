const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// Configure multer for temporary image storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = 'uploads/expenses/';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'expense-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Initialize OpenAI client
const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    organization: process.env.OPENAI_ORG || process.env.OPENAI_ORGANIZATION || undefined,
    project: process.env.OPENAI_PROJECT || undefined
  });
};

// @route   POST /api/expense-monitor/extract
// @desc    Extract expense data from uploaded image using GPT-4 vision
// @access  Public (can be protected later if needed)
router.post('/extract', upload.single('image'), async (req, res) => {
  let imagePath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    imagePath = req.file.path;

    // Convert image to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;

    // Initialize OpenAI client
    const openaiClient = getOpenAIClient();

    // System prompt for expense extraction
    const systemPrompt = `You are an expert expense data extractor. Analyze expense images (receipts, invoices, bills) and extract the following fields:
- Invoice Number (if available)
- Amount (total amount, including currency)
- Company Name (vendor/merchant name)
- Date (transaction date, if visible)
- Description (brief description of the expense)
- Category (if identifiable: Travel, Food, Office Supplies, Utilities, etc.)

Return the extracted data as a JSON object with these exact field names (use null for missing fields):
{
  "invoiceNumber": "string or null",
  "amount": "string or null (include currency symbol)",
  "companyName": "string or null",
  "date": "string or null (YYYY-MM-DD format if possible)",
  "description": "string or null",
  "category": "string or null"
}

If the image is unclear, unreadable, or not an expense document, return all fields as null and include an "error" field with a brief explanation.`;

    // Call GPT-4 Vision API (gpt-4o-mini supports vision)
    const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
    const requestConfig = {
      model: model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract expense data from this image. Return only valid JSON without any markdown formatting or code blocks. The response must be a valid JSON object.'
            },
            {
              type: 'image_url',
              image_url: {
                url: imageBase64,
                detail: 'high' // Use high detail for better OCR accuracy
              }
            }
          ]
        }
      ],
      temperature: 0.1, // Low temperature for accurate extraction
      max_tokens: 500
    };

    // Add JSON mode if model supports it (gpt-4o-mini and newer models)
    if (model.includes('gpt-4o') || model.includes('gpt-4-turbo')) {
      requestConfig.response_format = { type: 'json_object' };
    }

    const completion = await openaiClient.chat.completions.create(requestConfig);

    const responseText = completion.choices?.[0]?.message?.content?.trim() || '';
    
    // Parse JSON response
    let extractedData;
    try {
      // Clean response (remove markdown code blocks if present)
      let cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      // Try to extract JSON object if wrapped in text
      const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedResponse = jsonMatch[0];
      }
      extractedData = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('Error parsing GPT response:', parseError);
      console.error('Response text:', responseText);
      // Return structure with null values if parsing fails
      extractedData = {
        invoiceNumber: null,
        amount: null,
        companyName: null,
        date: null,
        description: null,
        category: null,
        error: 'Failed to parse extraction results. Please try again or enter data manually.'
      };
    }

    // Ensure all required fields exist
    const result = {
      invoiceNumber: extractedData.invoiceNumber || null,
      amount: extractedData.amount || null,
      companyName: extractedData.companyName || null,
      date: extractedData.date || null,
      description: extractedData.description || null,
      category: extractedData.category || null,
      error: extractedData.error || null
    };

    res.json({
      success: true,
      data: result,
      imageUrl: `/uploads/expenses/${path.basename(imagePath)}`
    });

  } catch (error) {
    console.error('Expense extraction error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to extract expense data',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    // Clean up uploaded image file after processing
    if (imagePath && fs.existsSync(imagePath)) {
      fs.unlink(imagePath, (err) => {
        if (err) console.error('Error deleting temporary expense image:', err);
      });
    }
  }
});

module.exports = router;
