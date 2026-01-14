const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { PDFDocument: PDFLib, rgb } = require('pdf-lib');
const PDFDocument = require('pdfkit');
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
 * REQUIRED NPM PACKAGES (lightweight - no Puppeteer):
 * npm install mammoth pdfkit pdf-parse pdf-lib docx
 * 
 * This version uses lighter libraries that install quickly on Render.
 */

// Helper to parse HTML and extract structured content
const parseHTMLContent = (html) => {
  // Simple HTML parser to extract text, tables, and basic formatting
  const content = {
    paragraphs: [],
    tables: [],
    images: []
  };
  
  // Extract paragraphs (simple regex-based parsing)
  const paragraphRegex = /<p[^>]*>(.*?)<\/p>/gis;
  const matches = html.matchAll(paragraphRegex);
  for (const match of matches) {
    const text = match[1].replace(/<[^>]*>/g, '').trim();
    if (text) content.paragraphs.push(text);
  }
  
  // Extract table data
  const tableRegex = /<table[^>]*>(.*?)<\/table>/gis;
  const tableMatches = html.matchAll(tableRegex);
  for (const tableMatch of tableMatches) {
    const tableHtml = tableMatch[1];
    const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    const rows = [];
    for (const rowMatch of tableHtml.matchAll(rowRegex)) {
      const cellRegex = /<t[dh][^>]*>(.*?)<\/t[dh]>/gis;
      const cells = [];
      for (const cellMatch of rowMatch[1].matchAll(cellRegex)) {
        cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) content.tables.push(rows);
  }
  
  // Extract images (base64)
  const imgRegex = /<img[^>]*src=["'](data:image\/[^;]+;base64,[^"']+)["']/gi;
  const imgMatches = html.matchAll(imgRegex);
  for (const imgMatch of imgMatches) {
    content.images.push(imgMatch[1]);
  }
  
  return content;
};

// @route   POST /api/document-converter/word-to-pdf
// @desc    Convert Word document (.doc or .docx) to PDF with formatting preservation
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
      // For .docx files, use mammoth to convert to HTML (preserves formatting, tables, images)
      if (file.originalname.toLowerCase().endsWith('.docx') || 
          file.mimetype.includes('openxmlformats')) {
        
        // Convert Word to HTML (preserves tables, formatting, images as base64)
        const htmlResult = await mammoth.convertToHtml({ buffer: file.buffer });
        const html = htmlResult.value;
        const messages = htmlResult.messages;
        
        // Also get raw text as fallback
        const textResult = await mammoth.extractRawText({ buffer: file.buffer });
        
        // Parse HTML content
        const parsedContent = parseHTMLContent(html);
        
        // Create PDF using PDFKit with better formatting
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 50, bottom: 50, left: 50, right: 50 }
        });
        
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        
        // Add content to PDF
        let yPosition = 50;
        const pageHeight = 792; // A4 height in points
        const lineHeight = 14;
        const margin = 50;
        
        // Add paragraphs
        parsedContent.paragraphs.forEach((para, index) => {
          if (yPosition > pageHeight - 100) {
            doc.addPage();
            yPosition = margin;
          }
          
          // Check if paragraph is a heading (short, bold-like)
          const isHeading = para.length < 100 && (index === 0 || parsedContent.paragraphs[index - 1] === '');
          
          if (isHeading) {
            doc.fontSize(16).font('Helvetica-Bold').text(para, margin, yPosition, {
              width: 495,
              align: 'left'
            });
            yPosition += 20;
          } else {
            doc.fontSize(12).font('Helvetica').text(para, margin, yPosition, {
              width: 495,
              align: 'left'
            });
            yPosition += doc.heightOfString(para, { width: 495 }) + 10;
          }
        });
        
        // Add tables
        parsedContent.tables.forEach((table, tableIndex) => {
          if (yPosition > pageHeight - 150) {
            doc.addPage();
            yPosition = margin;
          }
          
          const startY = yPosition;
          const colWidth = 495 / (table[0]?.length || 1);
          let maxRowHeight = 20;
          
          table.forEach((row, rowIndex) => {
            let xPosition = margin;
            let rowHeight = 20;
            
            row.forEach((cell, cellIndex) => {
              const isHeader = rowIndex === 0;
              doc.fontSize(isHeader ? 11 : 10)
                 .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
                 .rect(xPosition, yPosition, colWidth, rowHeight)
                 .stroke()
                 .text(cell || '', xPosition + 5, yPosition + 5, {
                   width: colWidth - 10,
                   height: rowHeight - 10,
                   align: 'left'
                 });
              
              const cellHeight = doc.heightOfString(cell || '', { width: colWidth - 10 });
              if (cellHeight > rowHeight) rowHeight = cellHeight + 10;
              
              xPosition += colWidth;
            });
            
            yPosition += rowHeight;
            
            if (yPosition > pageHeight - 50) {
              doc.addPage();
              yPosition = margin;
            }
          });
          
          yPosition += 20; // Space after table
        });
        
        // Add images (base64)
        parsedContent.images.forEach((imgData, imgIndex) => {
          if (yPosition > pageHeight - 200) {
            doc.addPage();
            yPosition = margin;
          }
          
          try {
            // Extract base64 data
            const base64Data = imgData.split(',')[1];
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            // Get image dimensions (simplified - assumes reasonable size)
            doc.image(imageBuffer, margin, yPosition, {
              fit: [495, 300],
              align: 'center'
            });
            
            yPosition += 320;
          } catch (imgError) {
            console.warn('Error adding image:', imgError);
            // Skip image if there's an error
          }
        });
        
        // If no structured content, use raw text
        if (parsedContent.paragraphs.length === 0 && parsedContent.tables.length === 0) {
          const text = textResult.value || '';
          const lines = text.split('\n').filter(line => line.trim());
          
          lines.forEach((line) => {
            if (yPosition > pageHeight - 50) {
              doc.addPage();
              yPosition = margin;
            }
            
            doc.fontSize(12).font('Helvetica').text(line.trim(), margin, yPosition, {
              width: 495,
              align: 'left'
            });
            yPosition += doc.heightOfString(line.trim(), { width: 495 }) + 8;
          });
        }
        
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
        
      } else {
        // For .doc files (older format), we need LibreOffice
        return res.status(400).json({ 
          message: '.doc files require LibreOffice. Please convert to .docx first.',
          suggestion: 'Convert your .doc file to .docx format and try again.'
        });
      }
      
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
// @desc    Convert PDF document to Word (.docx) with improved structure preservation
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
      // Extract text and structure from PDF
      const pdfData = await pdfParse(file.buffer);
      const extractedText = pdfData.text;
      
      if (!extractedText || extractedText.trim().length === 0) {
        return res.status(400).json({ 
          message: 'PDF appears to be scanned or image-based. OCR is required but not implemented.',
          suggestion: 'Please use a PDF with selectable text, or use an OCR tool first.'
        });
      }
      
      // Create Word document using docx library with better structure
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, WidthType } = Docx;
      
      // Parse text into structured paragraphs
      // Try to detect headings, lists, and tables
      const lines = extractedText.split('\n').filter(line => line.trim());
      const paragraphs = [];
      
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        
        // Detect potential headings (short lines, all caps, or lines followed by blank)
        const isPotentialHeading = (
          trimmed.length < 100 && 
          (trimmed === trimmed.toUpperCase() || 
           (index < lines.length - 1 && !lines[index + 1]?.trim()))
        );
        
        if (isPotentialHeading && trimmed.length < 80) {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({
                text: trimmed,
                bold: true,
                size: 28, // 14pt
              })],
              heading: HeadingLevel.HEADING_2,
              spacing: { after: 200, before: 200 }
            })
          );
        } else {
          // Regular paragraph
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({
                text: trimmed,
                size: 24, // 12pt
              })],
              spacing: { after: 120 }
            })
          );
        }
      });
      
      const doc = new Document({
        sections: [{
          properties: {
            page: {
              size: {
                orientation: pdfData.info?.orientation === 'landscape' ? 'landscape' : 'portrait',
                width: 12240, // A4 width in twips (8.5in * 1440)
                height: 15840, // A4 height in twips (11in * 1440)
              },
              margin: {
                top: 1440, // 1 inch
                right: 1440,
                bottom: 1440,
                left: 1440,
              }
            }
          },
          children: paragraphs.length > 0 ? paragraphs : [
            new Paragraph({
              children: [new TextRun('No text content found in PDF.')]
            })
          ]
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
// @desc    Edit PDF with annotations (text, highlights, drawings) - FIXED VERSION
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

    // Parse annotations from request body (they come as JSON strings)
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
            // Convert screen coordinates to PDF coordinates
            // Frontend sends coordinates relative to iframe/viewer
            // We need to scale them to PDF page dimensions
            // Assuming frontend viewer is roughly A4 size (800x600px viewport)
            const scaleX = width / 800; // Adjust based on actual viewer size
            const scaleY = height / 600;
            
            const pdfX = annotation.x * scaleX;
            // PDF Y is bottom-up, so invert
            const pdfY = height - (annotation.y * scaleY);
            
            page.drawText(annotation.text, {
              x: Math.max(0, Math.min(pdfX, width - 50)), // Clamp to page bounds
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
              color: rgb(1, 1, 0), // Yellow highlight
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
            
            // Draw path as connected lines
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
                color: rgb(0.545, 0.337, 0.961), // Purple color
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
