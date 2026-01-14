const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { PDFDocument: PDFLib, rgb } = require('pdf-lib');
const mammoth = require('mammoth');
const PDFDocument = require('pdfkit');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} = require('docx');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

/**
 * IMPORTANT:
 * - No GPT-based reconstruction is used for conversion.
 * - Conversion is deterministic and lightweight.
 * - Optional Python-based pdf2docx can be used if installed:
 *   pip install pdf2docx
 */

const commandExists = (cmd) => {
  const isWindows = process.platform === 'win32';
  const checkCmd = isWindows ? 'where' : 'which';
  const result = spawnSync(checkCmd, [cmd], { stdio: 'ignore' });
  return result.status === 0;
};

const runCommand = (cmd, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, options);
  let stderr = '';
  child.on('error', (error) => reject(error));
  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
  }
  child.on('close', (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(stderr || `${cmd} exited with code ${code}`));
    }
  });
});

const decodeHtml = (html) => html
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

const extractBlocksFromHtml = (html) => {
  const blocks = [];
  const normalized = html
    .replace(/\r/g, '')
    .replace(/<\/p>\s*<p>/g, '</p>\n<p>')
    .replace(/<\/li>\s*<li>/g, '</li>\n<li>');

  const blockRegex = /<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockRegex.exec(normalized))) {
    const tag = match[1].toLowerCase();
    const text = decodeHtml(match[2].replace(/<[^>]+>/g, '').trim());
    if (!text) continue;
    blocks.push({ type: tag, text });
  }
  return blocks;
};

const convertWithLibreOfficeCli = async (buffer, inputExt) => {
  const libreOfficeCmd = commandExists('soffice') ? 'soffice' : (commandExists('libreoffice') ? 'libreoffice' : null);
  if (!libreOfficeCmd) return null;

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'word2pdf-'));
  const inputPath = path.join(tmpDir, `input${inputExt}`);
  const outputPath = path.join(tmpDir, 'input.pdf');

  await fs.promises.writeFile(inputPath, buffer);
  await runCommand(libreOfficeCmd, ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, inputPath], {
    cwd: tmpDir,
    stdio: 'ignore'
  });

  try {
    const pdfBuffer = await fs.promises.readFile(outputPath);
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    return pdfBuffer;
  } catch (error) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    return null;
  }
};

const ocrPdfToText = async (buffer) => {
  const canOcr = process.env.ENABLE_OCR === 'true' && commandExists('tesseract') && commandExists('pdftoppm');
  if (!canOcr) return null;

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-ocr-'));
  const inputPath = path.join(tmpDir, 'input.pdf');
  const imagePrefix = path.join(tmpDir, 'page');

  await fs.promises.writeFile(inputPath, buffer);
  await runCommand('pdftoppm', ['-r', '200', '-png', inputPath, imagePrefix], { cwd: tmpDir, stdio: 'ignore' });

  const files = await fs.promises.readdir(tmpDir);
  const images = files.filter((file) => file.startsWith('page-') && file.endsWith('.png')).sort();

  let fullText = '';
  for (const image of images) {
    const imagePath = path.join(tmpDir, image);
    const outputBase = path.join(tmpDir, image.replace(/\.png$/, ''));
    const outputTxtPath = `${outputBase}.txt`;
    await runCommand('tesseract', [imagePath, outputBase], {
      cwd: tmpDir,
      stdio: 'ignore'
    });
    if (fs.existsSync(outputTxtPath)) {
      const text = await fs.promises.readFile(outputTxtPath, 'utf-8');
      fullText += `${text}\n`;
    }
  }

  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  return fullText.trim() ? fullText : null;
};

const buildDocxFromText = async (text) => {
  const paragraphs = [];
  const lines = text.split('\n');
  const blocks = [];

  let current = [];
  lines.forEach((line) => {
    if (!line.trim()) {
      if (current.length) {
        blocks.push(current.join('\n').trim());
        current = [];
      }
      return;
    }
    current.push(line.trim());
  });
  if (current.length) blocks.push(current.join('\n').trim());

  const isHeading = (line) => {
    if (line.length > 80) return false;
    const upper = line.toUpperCase();
    return line === upper && /[A-Z]/.test(line);
  };

  const isBullet = (line) => /^[\u2022\-*•–]\s+/.test(line);

  const parseTableRow = (line) => line.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);

  blocks.forEach((block) => {
    const blockLines = block.split('\n').map((part) => part.trim()).filter(Boolean);
    const tableRows = blockLines
      .map(parseTableRow)
      .filter((row) => row.length > 1);

    if (tableRows.length >= 2 && tableRows.every((row) => row.length === tableRows[0].length)) {
      const rows = tableRows.map((row) => new TableRow({
        children: row.map((cell) => new TableCell({
          width: { size: 100 / row.length, type: WidthType.PERCENTAGE },
          children: [new Paragraph(cell)]
        }))
      }));
      paragraphs.push(new Table({ rows }));
      return;
    }

    if (blockLines.length && blockLines.every(isBullet)) {
      blockLines.forEach((line) => {
        const clean = line.replace(/^[\u2022\-*•–]\s+/, '').trim();
        paragraphs.push(new Paragraph({
          text: clean,
          bullet: { level: 0 }
        }));
      });
      return;
    }

    if (isHeading(block)) {
      paragraphs.push(new Paragraph({
        text: block,
        heading: HeadingLevel.HEADING_1
      }));
      return;
    }

    paragraphs.push(new Paragraph({
      children: [new TextRun(block)]
    }));
  });

  const doc = new Document({
    sections: [{ children: paragraphs }]
  });

  return Packer.toBuffer(doc);
};

const convertPdfToDocxWithPdf2Docx = async (buffer) => {
  const pythonCandidates = ['python3', 'python'].filter(commandExists);
  if (!pythonCandidates.length) return null;

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf2docx-'));
  const inputPath = path.join(tmpDir, 'input.pdf');
  const outputPath = path.join(tmpDir, 'output.docx');

  await fs.promises.writeFile(inputPath, buffer);

  for (const pythonCmd of pythonCandidates) {
    try {
      await runCommand(pythonCmd, ['-m', 'pdf2docx', 'convert', inputPath, outputPath], {
        cwd: tmpDir,
        stdio: 'ignore'
      });
      const docxBuffer = await fs.promises.readFile(outputPath);
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      return docxBuffer;
    } catch (error) {
      // Try next python candidate
    }
  }

  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  return null;
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
      const fileExt = file.originalname.toLowerCase().endsWith('.doc') ? '.doc' : '.docx';
      const libreOfficePdf = await convertWithLibreOfficeCli(file.buffer, fileExt);
      if (libreOfficePdf) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${file.originalname.replace(/\.(doc|docx)$/i, '.pdf')}"`);
        return res.send(libreOfficePdf);
      }

      if (fileExt === '.doc') {
        return res.status(400).json({
          message: 'This server cannot convert .doc files without LibreOffice.',
          details: 'Install LibreOffice or upload a .docx file for lightweight conversion.'
        });
      }

      const { value: html } = await mammoth.convertToHtml({ buffer: file.buffer });
      const blocks = extractBlocksFromHtml(html);

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));

      if (!blocks.length) {
        const rawText = (await mammoth.extractRawText({ buffer: file.buffer })).value || '';
        doc.font('Helvetica').fontSize(12).text(rawText.trim());
      } else {
        blocks.forEach((block) => {
          if (block.type === 'h1') {
            doc.font('Helvetica-Bold').fontSize(18).text(block.text, { align: 'left' });
            doc.moveDown(0.5);
          } else if (block.type === 'h2') {
            doc.font('Helvetica-Bold').fontSize(16).text(block.text, { align: 'left' });
            doc.moveDown(0.4);
          } else if (block.type === 'h3') {
            doc.font('Helvetica-Bold').fontSize(14).text(block.text, { align: 'left' });
            doc.moveDown(0.3);
          } else if (block.type === 'li') {
            doc.font('Helvetica').fontSize(12).text(`• ${block.text}`, { indent: 20 });
          } else {
            doc.font('Helvetica').fontSize(12).text(block.text, { align: 'left' });
            doc.moveDown(0.2);
          }
        });
      }

      doc.end();
      await new Promise((resolve) => doc.on('end', resolve));

      const pdfBuffer = Buffer.concat(chunks);
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
      const pdfData = await pdfParse(file.buffer);
      let extractedText = (pdfData.text || '').trim();

      if (!extractedText) {
        const ocrText = await ocrPdfToText(file.buffer);
        if (ocrText) {
          extractedText = ocrText;
        }
      }

      if (!extractedText) {
        return res.status(400).json({
          message: 'PDF appears to be scanned or image-based. OCR is required for text extraction.',
          details: 'Optional OCR: set ENABLE_OCR=true and install tesseract + poppler (pdftoppm).'
        });
      }

      const docxBuffer = await convertPdfToDocxWithPdf2Docx(file.buffer);
      if (docxBuffer) {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${file.originalname.replace(/\.pdf$/i, '.docx')}"`);
        return res.send(docxBuffer);
      }

      const lightweightDocx = await buildDocxFromText(extractedText);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${file.originalname.replace(/\.pdf$/i, '.docx')}"`);
      res.send(lightweightDocx);
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
