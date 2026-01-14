const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const mammoth = require('mammoth');
const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');
const { PDFDocument: PDFLib } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const Docx = require('docx');

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

/**
 * REQUIRED NPM PACKAGES (install with: npm install mammoth pdfkit pdf-parse pdf-lib docx)
 * 
 * - mammoth: Converts .docx files to HTML/text
 * - pdfkit: Creates PDF files from scratch
 * - pdf-parse: Extracts text and data from PDF files
 * - pdf-lib: Edits existing PDF files (add text, annotations, etc.)
 * - docx: Creates .docx files programmatically
 */

// @route   POST /api/document-converter/word-to-pdf
// @desc    Convert Word document (.doc or .docx) to PDF
// @access  Private (Customer)
router.post('/word-to-pdf', protect, authorize('customer'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const file = req.file;
    const allowedTypes = [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-word.document.macroEnabled.12'
    ];

    if (!allowedTypes.includes(file.mimetype) && 
        !file.originalname.match(/\.(doc|docx)$/i)) {
      return res.status(400).json({ message: 'Invalid file type. Please upload a .doc or .docx file' });
    }

    // Convert Word to PDF
    let pdfBuffer;
    
    try {
      // For .docx files, use mammoth to extract content
      if (file.originalname.toLowerCase().endsWith('.docx') || 
          file.mimetype.includes('openxmlformats')) {
        // Extract text and HTML from Word document
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        const htmlResult = await mammoth.convertToHtml({ buffer: file.buffer });
        
        // Create PDF using PDFKit
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 50, bottom: 50, left: 50, right: 50 }
        });
        
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {});
        
        // Add text content to PDF
        const text = result.value || '';
        const lines = text.split('\n');
        
        lines.forEach((line, index) => {
          if (line.trim()) {
            doc.fontSize(12).text(line.trim(), {
              align: 'left',
              continued: false
            });
            doc.moveDown(0.5);
          } else {
            doc.moveDown(1);
          }
        });
        
        doc.end();
        
        // Wait for PDF to be generated
        await new Promise((resolve) => {
          doc.on('end', resolve);
        });
        
        pdfBuffer = Buffer.concat(chunks);
      } else {
        // For .doc files (older format), we need a different approach
        // Note: .doc files require LibreOffice or similar tool
        // For now, return an error suggesting conversion to .docx
        return res.status(400).json({ 
          message: '.doc files require LibreOffice. Please convert to .docx first or use an online converter.',
          suggestion: 'Convert your .doc file to .docx format and try again.'
        });
      }
      
      // Send PDF as response
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${file.originalname.replace(/\.(doc|docx)$/i, '.pdf')}"`);
      res.send(pdfBuffer);
      
    } catch (error) {
      console.error('Word to PDF conversion error:', error);
      return res.status(500).json({ 
        message: 'Conversion failed', 
        error: error.message,
        details: 'The Word document may be corrupted or in an unsupported format.'
      });
    }
  } catch (error) {
    console.error('Word to PDF route error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/document-converter/pdf-to-word
// @desc    Convert PDF document to Word (.docx)
// @access  Private (Customer)
router.post('/pdf-to-word', protect, authorize('customer'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const file = req.file;
    
    if (file.mimetype !== 'application/pdf' && !file.originalname.match(/\.pdf$/i)) {
      return res.status(400).json({ message: 'Invalid file type. Please upload a PDF file' });
    }

    try {
      // Extract text from PDF
      const pdfData = await pdfParse(file.buffer);
      const extractedText = pdfData.text;
      
      if (!extractedText || extractedText.trim().length === 0) {
        return res.status(400).json({ 
          message: 'PDF appears to be scanned or image-based. OCR is required but not implemented.',
          suggestion: 'Please use a PDF with selectable text, or use an OCR tool first.'
        });
      }
      
      // Create Word document using docx library
      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = Docx;
      
      // Split text into paragraphs
      const paragraphs = extractedText.split('\n').filter(line => line.trim());
      
      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs.map(text => 
            new Paragraph({
              children: [new TextRun(text.trim())],
              spacing: { after: 200 }
            })
          )
        }]
      });
      
      // Generate Word document buffer
      const docxBuffer = await Packer.toBuffer(doc);
      
      // Send Word document as response
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${file.originalname.replace(/\.pdf$/i, '.docx')}"`);
      res.send(docxBuffer);
      
    } catch (error) {
      console.error('PDF to Word conversion error:', error);
      return res.status(500).json({ 
        message: 'Conversion failed', 
        error: error.message,
        details: 'The PDF may be corrupted, password-protected, or in an unsupported format.'
      });
    }
  } catch (error) {
    console.error('PDF to Word route error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/document-converter/edit-pdf
// @desc    Edit PDF with annotations (text, highlights, drawings)
// @access  Private (Customer)
router.post('/edit-pdf', protect, authorize('customer'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const file = req.file;
    
    if (file.mimetype !== 'application/pdf' && !file.originalname.match(/\.pdf$/i)) {
      return res.status(400).json({ message: 'Invalid file type. Please upload a PDF file' });
    }

    // Parse annotations from request body
    const { annotations = [], highlights = [], drawings = [] } = req.body;
    
    try {
      // Load PDF using pdf-lib
      const pdfDoc = await PDFLib.load(file.buffer);
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();
      
      // Add text annotations
      if (annotations && annotations.length > 0) {
        annotations.forEach(annotation => {
          if (annotation.type === 'text' && annotation.x !== undefined && annotation.y !== undefined) {
            const page = pages[annotation.pageIndex || 0] || firstPage;
            page.drawText(annotation.text || '', {
              x: annotation.x,
              y: height - annotation.y, // PDF coordinates are bottom-up
              size: annotation.fontSize || 12,
              color: PDFLib.rgb(0, 0, 0),
            });
          }
        });
      }
      
      // Add highlights
      if (highlights && highlights.length > 0) {
        highlights.forEach(highlight => {
          if (highlight.x !== undefined && highlight.y !== undefined) {
            const page = pages[highlight.pageIndex || 0] || firstPage;
            page.drawRectangle({
              x: highlight.x,
              y: height - highlight.y - highlight.height,
              width: highlight.width,
              height: highlight.height,
              color: PDFLib.rgb(1, 1, 0), // Yellow highlight
              opacity: 0.3,
            });
          }
        });
      }
      
      // Add drawings (paths)
      if (drawings && drawings.length > 0) {
        drawings.forEach(drawing => {
          if (drawing.path && drawing.path.length > 1) {
            const page = pages[drawing.pageIndex || 0] || firstPage;
            const path = drawing.path;
            
            // Draw path as connected lines
            for (let i = 0; i < path.length - 1; i++) {
              page.drawLine({
                start: { x: path[i].x, y: height - path[i].y },
                end: { x: path[i + 1].x, y: height - path[i + 1].y },
                thickness: 2,
                color: PDFLib.rgb(0.545, 0.337, 0.961), // Purple color
              });
            }
          }
        });
      }
      
      // Save PDF
      const pdfBytes = await pdfDoc.save();
      
      // Send edited PDF as response
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="edited_${file.originalname}"`);
      res.send(Buffer.from(pdfBytes));
      
    } catch (error) {
      console.error('PDF editing error:', error);
      return res.status(500).json({ 
        message: 'PDF editing failed', 
        error: error.message,
        details: 'The PDF may be corrupted, password-protected, or in an unsupported format.'
      });
    }
  } catch (error) {
    console.error('Edit PDF route error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
