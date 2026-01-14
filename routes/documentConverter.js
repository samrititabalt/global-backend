const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { PDFDocument: PDFLib, rgb } = require('pdf-lib');
const PDFDocument = require('pdfkit');

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

/**
 * MINIMAL DEPENDENCIES VERSION - Fast deployment on Render
 * Only uses: pdfkit, pdf-parse, pdf-lib (all lightweight)
 * 
 * Word to PDF: Simple text extraction and PDF creation
 * PDF to Word: Text extraction and simple Word-like output
 * PDF Editing: Full functionality with pdf-lib
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

    try {
      // Simple text extraction from Word files
      // For .docx files, extract text from XML structure
      let textContent = '';
      
      if (file.originalname.toLowerCase().endsWith('.docx') || 
          file.mimetype.includes('openxmlformats')) {
        // .docx is a ZIP file containing XML
        // Simple extraction: look for text in document.xml
        const zip = require('jszip');
        const zipFile = await zip.loadAsync(file.buffer);
        const documentXml = await zipFile.file('word/document.xml').async('string');
        
        // Extract text from XML (simple regex-based)
        const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/gi;
        const matches = documentXml.matchAll(textRegex);
        const textParts = [];
        for (const match of matches) {
          if (match[1]) textParts.push(match[1]);
        }
        textContent = textParts.join(' ');
        
        // Also extract paragraphs
        const paraRegex = /<w:p[^>]*>/gi;
        const paragraphs = textContent.split(/\s{2,}/).filter(p => p.trim());
        textContent = paragraphs.join('\n\n');
      } else {
        // For .doc files, we can't easily parse them
        return res.status(400).json({ 
          message: '.doc files require additional libraries. Please convert to .docx first.',
          suggestion: 'Convert your .doc file to .docx format and try again.'
        });
      }
      
      if (!textContent || textContent.trim().length === 0) {
        return res.status(400).json({ 
          message: 'Could not extract text from Word document. The file may be corrupted or contain only images.',
        });
      }
      
      // Create PDF using PDFKit
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });
      
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      
      // Add text content to PDF
      const lines = textContent.split('\n').filter(line => line.trim());
      const pageHeight = 792;
      let yPosition = 50;
      
      lines.forEach((line) => {
        if (yPosition > pageHeight - 50) {
          doc.addPage();
          yPosition = 50;
        }
        
        doc.fontSize(12)
           .font('Helvetica')
           .text(line.trim(), 50, yPosition, {
             width: 495,
             align: 'left'
           });
        
        yPosition += doc.heightOfString(line.trim(), { width: 495 }) + 8;
      });
      
      doc.end();
      
      // Wait for PDF to be generated
      await new Promise((resolve) => {
        doc.on('end', resolve);
      });
      
      const pdfBuffer = Buffer.concat(chunks);
      
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
// @desc    Convert PDF document to Word (.docx) - Returns plain text file
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
      
      // Create a simple text file (lightweight alternative to .docx)
      // Format as plain text with line breaks
      const formattedText = extractedText
        .split('\n')
        .filter(line => line.trim())
        .join('\n\n');
      
      // Create a simple .txt file (can be opened in Word)
      const textBuffer = Buffer.from(formattedText, 'utf-8');
      
      // Send as text file (Word can open .txt files)
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${file.originalname.replace(/\.pdf$/i, '.txt')}"`);
      res.send(textBuffer);
      
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
    let annotations = [];
    let highlights = [];
    let drawings = [];
    
    try {
      if (typeof req.body.annotations === 'string') {
        annotations = JSON.parse(req.body.annotations);
      } else if (Array.isArray(req.body.annotations)) {
        annotations = req.body.annotations;
      }
      
      if (typeof req.body.highlights === 'string') {
        highlights = JSON.parse(req.body.highlights);
      } else if (Array.isArray(req.body.highlights)) {
        highlights = req.body.highlights;
      }
      
      if (typeof req.body.drawings === 'string') {
        drawings = JSON.parse(req.body.drawings);
      } else if (Array.isArray(req.body.drawings)) {
        drawings = req.body.drawings;
      }
    } catch (parseError) {
      console.error('Error parsing annotations:', parseError);
      return res.status(400).json({ message: 'Invalid annotation format' });
    }
    
    try {
      // Load PDF using pdf-lib
      const pdfDoc = await PDFLib.load(file.buffer);
      const pages = pdfDoc.getPages();
      
      // Process each page
      pages.forEach((page, pageIndex) => {
        const { width, height } = page.getSize();
        
        // Add text annotations for this page
        const pageAnnotations = annotations.filter(a => 
          a.type === 'text' && 
          (a.pageIndex === undefined || a.pageIndex === pageIndex) &&
          a.x !== undefined && 
          a.y !== undefined &&
          a.text
        );
        
        pageAnnotations.forEach(annotation => {
          try {
            const scaleX = width / 800;
            const scaleY = height / 600;
            
            const pdfX = annotation.x * scaleX;
            const pdfY = height - (annotation.y * scaleY);
            
            page.drawText(annotation.text, {
              x: Math.max(0, Math.min(pdfX, width - 50)),
              y: Math.max(0, Math.min(pdfY, height - 10)),
              size: annotation.fontSize || 12,
              color: rgb(0, 0, 0),
            });
          } catch (err) {
            console.error('Error adding text annotation:', err);
          }
        });
        
        // Add highlights for this page
        const pageHighlights = highlights.filter(h => 
          (h.pageIndex === undefined || h.pageIndex === pageIndex) &&
          h.x !== undefined && 
          h.y !== undefined &&
          h.width > 0 &&
          h.height > 0
        );
        
        pageHighlights.forEach(highlight => {
          try {
            const scaleX = width / 800;
            const scaleY = height / 600;
            
            const pdfX = highlight.x * scaleX;
            const pdfY = height - (highlight.y * scaleY) - (highlight.height * scaleY);
            const pdfWidth = highlight.width * scaleX;
            const pdfHeight = highlight.height * scaleY;
            
            page.drawRectangle({
              x: Math.max(0, pdfX),
              y: Math.max(0, pdfY),
              width: Math.min(pdfWidth, width - pdfX),
              height: Math.min(pdfHeight, height - pdfY),
              color: rgb(1, 1, 0),
              opacity: 0.3,
            });
          } catch (err) {
            console.error('Error adding highlight:', err);
          }
        });
        
        // Add drawings for this page
        const pageDrawings = drawings.filter(d => 
          (d.pageIndex === undefined || d.pageIndex === pageIndex) &&
          d.path &&
          Array.isArray(d.path) &&
          d.path.length > 1
        );
        
        pageDrawings.forEach(drawing => {
          try {
            const scaleX = width / 800;
            const scaleY = height / 600;
            const path = drawing.path;
            
            for (let i = 0; i < path.length - 1; i++) {
              const startX = path[i].x * scaleX;
              const startY = height - (path[i].y * scaleY);
              const endX = path[i + 1].x * scaleX;
              const endY = height - (path[i + 1].y * scaleY);
              
              page.drawLine({
                start: { 
                  x: Math.max(0, Math.min(startX, width)), 
                  y: Math.max(0, Math.min(startY, height)) 
                },
                end: { 
                  x: Math.max(0, Math.min(endX, width)), 
                  y: Math.max(0, Math.min(endY, height)) 
                },
                thickness: 2,
                color: rgb(0.545, 0.337, 0.961),
              });
            }
          } catch (err) {
            console.error('Error adding drawing:', err);
          }
        });
      });
      
      // Save PDF with all annotations
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
