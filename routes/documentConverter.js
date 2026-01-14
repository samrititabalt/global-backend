const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { PDFDocument: PDFLib, rgb } = require('pdf-lib');
const libre = require('libreoffice-convert');

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

/**
 * REQUIRED SYSTEM DEPENDENCY:
 * LibreOffice must be installed on the server for high-fidelity conversions.
 *
 * Render build command example:
 * apt-get update && apt-get install -y libreoffice && npm install
 *
 * REQUIRED NPM PACKAGE:
 * npm install libreoffice-convert pdf-parse pdf-lib
 */

const convertWithLibreOffice = (buffer, targetExt) => new Promise((resolve, reject) => {
  libre.convert(buffer, targetExt, undefined, (err, done) => {
    if (err) return reject(err);
    resolve(done);
  });
});

const isLibreOfficeMissing = (error) => {
  const message = (error && error.message) ? error.message.toLowerCase() : '';
  return (
    message.includes('soffice') ||
    message.includes('libreoffice') ||
    message.includes('not found') ||
    error?.code === 'ENOENT'
  );
};

// @route   POST /api/document-converter/word-to-pdf
// @desc    Convert Word document (.doc or .docx) to PDF (preserves formatting)
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
      const pdfBuffer = await convertWithLibreOffice(file.buffer, '.pdf');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${file.originalname.replace(/\.(doc|docx)$/i, '.pdf')}"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error('Word to PDF conversion error:', error);
      if (isLibreOfficeMissing(error)) {
        return res.status(500).json({
          message: 'LibreOffice is required for high-fidelity conversion. Please install LibreOffice on the server.',
          details: 'Render build command example: apt-get update && apt-get install -y libreoffice'
        });
      }
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
// @desc    Convert PDF document to Word (.docx) (preserves formatting when possible)
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
      // Detect scanned PDFs (no extractable text)
      const pdfData = await pdfParse(file.buffer);
      const extractedText = pdfData.text || '';
      if (!extractedText.trim()) {
        return res.status(400).json({
          message: 'PDF appears to be scanned or image-based. OCR is required for text extraction.',
          details: 'Install an OCR engine (e.g., Tesseract) or use an OCR-enabled conversion service.'
        });
      }

      const docxBuffer = await convertWithLibreOffice(file.buffer, '.docx');

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${file.originalname.replace(/\.pdf$/i, '.docx')}"`);
      res.send(docxBuffer);
    } catch (error) {
      console.error('PDF to Word conversion error:', error);
      if (isLibreOfficeMissing(error)) {
        return res.status(500).json({
          message: 'LibreOffice is required for high-fidelity conversion. Please install LibreOffice on the server.',
          details: 'Render build command example: apt-get update && apt-get install -y libreoffice'
        });
      }
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

    let annotations = [];
    let highlights = [];
    let drawings = [];
    let viewerWidth = 800;
    let viewerHeight = 600;

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

      if (req.body.viewerWidth) {
        const w = Number(req.body.viewerWidth);
        if (Number.isFinite(w) && w > 0) viewerWidth = w;
      }
      if (req.body.viewerHeight) {
        const h = Number(req.body.viewerHeight);
        if (Number.isFinite(h) && h > 0) viewerHeight = h;
      }
    } catch (parseError) {
      console.error('Error parsing annotations:', parseError);
      return res.status(400).json({ message: 'Invalid annotation format' });
    }

    try {
      const pdfDoc = await PDFLib.load(file.buffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();

      pages.forEach((page, pageIndex) => {
        const { width, height } = page.getSize();

        const scaleX = width / viewerWidth;
        const scaleY = height / viewerHeight;

        const pageAnnotations = annotations.filter(a =>
          a.type === 'text' &&
          (a.pageIndex === undefined || a.pageIndex === pageIndex) &&
          a.x !== undefined &&
          a.y !== undefined &&
          a.text
        );

        pageAnnotations.forEach((annotation) => {
          try {
            const pdfX = annotation.x * scaleX;
            const pdfY = height - (annotation.y * scaleY);

            page.drawText(annotation.text, {
              x: Math.max(0, Math.min(pdfX, width - 50)),
              y: Math.max(0, Math.min(pdfY, height - 10)),
              size: annotation.fontSize || 12,
              color: rgb(0, 0, 0)
            });
          } catch (err) {
            console.error('Error adding text annotation:', err);
          }
        });

        const pageHighlights = highlights.filter(h =>
          (h.pageIndex === undefined || h.pageIndex === pageIndex) &&
          h.x !== undefined &&
          h.y !== undefined &&
          h.width > 0 &&
          h.height > 0
        );

        pageHighlights.forEach((highlight) => {
          try {
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
              opacity: 0.3
            });
          } catch (err) {
            console.error('Error adding highlight:', err);
          }
        });

        const pageDrawings = drawings.filter(d =>
          (d.pageIndex === undefined || d.pageIndex === pageIndex) &&
          d.path &&
          Array.isArray(d.path) &&
          d.path.length > 1
        );

        pageDrawings.forEach((drawing) => {
          try {
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
                color: rgb(0.545, 0.337, 0.961)
              });
            }
          } catch (err) {
            console.error('Error adding drawing:', err);
          }
        });
      });

      const pdfBytes = await pdfDoc.save();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="edited_${file.originalname}"`);
      res.send(Buffer.from(pdfBytes));
    } catch (error) {
      console.error('PDF editing error:', error);
      return res.status(500).json({
        message: 'PDF editing failed',
        error: error.message,
        details: 'The PDF may be corrupted, encrypted, or in an unsupported format.'
      });
    }
  } catch (error) {
    console.error('Edit PDF route error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
