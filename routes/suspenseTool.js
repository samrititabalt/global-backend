/**
 * Suspense Tool API
 * Upload → AI analysis → Human review → Excel/PDF export → Dashboard PDF
 * Uses: GPT-4o-mini, Cloudinary, MongoDB, Brevo
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const PDFDocument = require('pdfkit');
const { protect, authorize } = require('../middleware/auth');
const SuspenseJob = require('../models/SuspenseJob');
const { uploadFile } = require('../services/cloudinary');
const OpenAI = require('openai');
const { mailWithAttachment } = require('../utils/sendEmail');

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/pdf'
    ];
    const ext = (file.originalname || '').toLowerCase();
    if (allowed.includes(file.mimetype) || /\.(xlsx|xls|csv|pdf)$/.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls), CSV, and PDF are allowed'), false);
    }
  }
});

function getFileType(fileName, mimetype) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (ext === 'pdf' || mimetype === 'application/pdf') return 'pdf';
  if (ext === 'csv' || mimetype === 'text/csv') return 'csv';
  return 'excel';
}

// Parse Excel/CSV buffer to rows (array of objects)
function parseSpreadsheet(buffer, fileType) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: true });
  const first = wb.SheetNames[0];
  const ws = wb.Sheets[first];
  const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  const columns = data.length ? Object.keys(data[0]) : [];
  return { columns, rows: data };
}

// Parse CSV buffer (simple)
function parseCSV(buffer) {
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { columns: [], rows: [] };
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    header.forEach((col, i) => { obj[col] = values[i] || ''; });
    return obj;
  });
  return { columns: header, rows };
}

// Build a single "entry" string from a row for AI (e.g. description column or concatenation)
function rowToEntry(row, columns) {
  const descCol = columns.find((c) => /description|detail|memo|narration|text|entry/i.test(c));
  if (descCol && row[descCol]) return String(row[descCol]).slice(0, 500);
  return Object.values(row).filter(Boolean).join(' | ').slice(0, 500);
}

// Call GPT to predict company and confidence (0-80)
async function predictCompanyWithGPT(entryText) {
  if (!openaiClient) {
    return { predictedCompany: 'N/A', confidence: 0 };
  }
  try {
    const completion = await openaiClient.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert at classifying unclear bank/expense entries into company or vendor names. For each entry, respond with ONLY valid JSON: {"company": "Predicted Company or Vendor Name", "confidence": number 0-80}. Never use confidence above 80. Use 0-30 for very unclear, 31-50 for guess, 51-80 for likely. No other text.`
        },
        {
          role: 'user',
          content: `Classify this entry: "${(entryText || '').slice(0, 400)}"`
        }
      ],
      max_tokens: 100,
      temperature: 0.2
    });
    const content = completion.choices?.[0]?.message?.content?.trim() || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      let conf = Number(parsed.confidence);
      if (Number.isNaN(conf) || conf > 80) conf = 80;
      if (conf < 0) conf = 0;
      return {
        predictedCompany: String(parsed.company || parsed.companyName || 'N/A').slice(0, 200),
        confidence: conf
      };
    }
  } catch (e) {
    console.error('GPT suspense classification error:', e.message);
  }
  return { predictedCompany: 'N/A', confidence: 0 };
}

// POST /api/suspense-tool/upload
router.post('/upload', protect, authorize('customer', 'admin', 'agent', 'employee'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const fileType = getFileType(req.file.originalname, req.file.mimetype);
    const folder = `suspense-tool/${req.user._id}`;
    const result = await uploadFile(req.file.buffer, folder, req.file.mimetype);
    const job = await SuspenseJob.create({
      user: req.user._id,
      fileName: req.file.originalname,
      fileType,
      fileUrl: result.url,
      cloudinaryPublicId: result.publicId,
      status: 'uploaded'
    });
    res.json({ success: true, job: { _id: job._id, fileName: job.fileName, fileType: job.fileType, status: job.status } });
  } catch (err) {
    console.error('Suspense upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
});

// POST /api/suspense-tool/analyze/:jobId
router.post('/analyze/:jobId', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.jobId, user: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.status !== 'uploaded') {
      return res.status(400).json({ success: false, message: 'Job already analyzed or invalid state' });
    }

    job.status = 'analyzing';
    await job.save();

    const response = await axios.get(job.fileUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    let columns = [];
    let rows = [];

    if (job.fileType === 'pdf') {
      const pdfData = await pdfParse(buffer);
      const text = (pdfData.text || '').trim();
      const lines = text.split(/\r?\n/).filter(Boolean);
      columns = ['Entry'];
      rows = lines.slice(0, 5000).map((line) => ({ Entry: line }));
    } else if (job.fileType === 'csv') {
      const parsed = parseCSV(buffer);
      columns = parsed.columns;
      rows = parsed.rows;
    } else {
      const parsed = parseSpreadsheet(buffer, job.fileType);
      columns = parsed.columns;
      rows = parsed.rows;
    }

    job.originalColumns = columns;
    job.rawRows = rows.slice(0, 10000);
    await job.save();

    const BATCH = 20;
    const analysisResult = [];
    for (let i = 0; i < job.rawRows.length; i += BATCH) {
      const chunk = job.rawRows.slice(i, i + BATCH);
      const promises = chunk.map((row, idx) => {
        const entry = rowToEntry(row, columns);
        return predictCompanyWithGPT(entry).then((r) => ({
          rowIndex: i + idx,
          originalEntry: entry,
          predictedCompany: r.predictedCompany,
          confidence: r.confidence,
          humanCorrection: null
        }));
      });
      const results = await Promise.all(promises);
      analysisResult.push(...results);
    }

    job.analysisResult = analysisResult;
    job.status = 'ready';
    job.updatedAt = new Date();
    await job.save();

    res.json({
      success: true,
      job: {
        _id: job._id,
        status: job.status,
        originalColumns: job.originalColumns,
        rowCount: job.rawRows.length,
        analysisResult: job.analysisResult
      }
    });
  } catch (err) {
    console.error('Suspense analyze error:', err);
    await SuspenseJob.updateOne(
      { _id: req.params.jobId, user: req.user._id },
      { status: 'uploaded', updatedAt: new Date() }
    ).catch(() => {});
    res.status(500).json({ success: false, message: err.message || 'Analysis failed' });
  }
});

// GET /api/suspense-tool/jobs
router.get('/jobs', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const jobs = await SuspenseJob.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/suspense-tool/job/:id
router.get('/job/:id', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/suspense-tool/job/:id/correction
router.put('/job/:id/correction', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const { rowIndex, humanCorrection } = req.body;
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    const entry = job.analysisResult.find((r) => r.rowIndex === rowIndex);
    if (entry) {
      entry.humanCorrection = humanCorrection != null ? String(humanCorrection) : null;
      entry.correctedAt = new Date();
    }
    job.updatedAt = new Date();
    await job.save();
    res.json({ success: true, job: job.toObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/suspense-tool/job/:id/review-complete
router.post('/job/:id/review-complete', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    job.status = 'review_complete';
    job.reviewCompletedAt = new Date();
    job.updatedAt = new Date();
    await job.save();
    res.json({ success: true, job: { _id: job._id, status: job.status } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/suspense-tool/job/:id/export-excel
router.get('/job/:id/export-excel', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const headers = [...job.originalColumns, 'Predicted Company', 'Confidence %', 'Human Correction'];
    const rows = job.rawRows.map((row, i) => {
      const analysis = job.analysisResult.find((a) => a.rowIndex === i) || {};
      const displayCompany = analysis.humanCorrection != null ? analysis.humanCorrection : analysis.predictedCompany;
      return [
        ...job.originalColumns.map((col) => row[col] ?? ''),
        displayCompany || '',
        analysis.confidence != null ? analysis.confidence : '',
        analysis.humanCorrection != null ? analysis.humanCorrection : ''
      ];
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Suspense Analysis');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="suspense-${job.fileName.replace(/\.[a-z]+$/i, '')}-analyzed.xlsx"`);
    res.send(buf);
  } catch (err) {
    console.error('Export excel error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/suspense-tool/job/:id/send-email
router.post('/job/:id/send-email', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const headers = [...job.originalColumns, 'Predicted Company', 'Confidence %', 'Human Correction'];
    const rows = job.rawRows.map((row, i) => {
      const analysis = job.analysisResult.find((a) => a.rowIndex === i) || {};
      const displayCompany = analysis.humanCorrection != null ? analysis.humanCorrection : analysis.predictedCompany;
      return [
        ...job.originalColumns.map((col) => row[col] ?? ''),
        displayCompany || '',
        analysis.confidence != null ? analysis.confidence : '',
        analysis.humanCorrection != null ? analysis.humanCorrection : ''
      ];
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Suspense Analysis');
    const excelBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const excelBase64 = excelBuf.toString('base64');

    const toEmail = req.user.email || req.body.email;
    if (!toEmail) return res.status(400).json({ success: false, message: 'No email address' });

    const attachments = [
      { content: excelBase64, name: `suspense-${job.fileName.replace(/\.[a-z]+$/i, '')}-analyzed.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    ];

    await mailWithAttachment(
      toEmail,
      'Your Suspense Tool analysis – Excel attachment',
      `<p>Please find your analyzed suspense data attached.</p><p>File: ${job.fileName}</p>`,
      attachments
    );

    res.json({ success: true, message: 'Email sent' });
  } catch (err) {
    console.error('Send email error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/suspense-tool/job/:id/dashboard
router.get('/job/:id/dashboard', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const byCompany = {};
    job.analysisResult.forEach((a) => {
      const name = (a.humanCorrection != null ? a.humanCorrection : a.predictedCompany) || 'Unclassified';
      byCompany[name] = (byCompany[name] || 0) + 1;
    });
    const companyData = Object.entries(byCompany).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 15);
    const total = job.analysisResult.length;
    const pieData = companyData.map((c) => ({ label: c.name, value: c.count }));
    const barData = companyData;

    res.json({
      success: true,
      charts: [
        { type: 'pie', title: 'By company/vendor', data: pieData },
        { type: 'bar', title: 'Top vendors', data: barData }
      ],
      summary: { totalEntries: total, uniqueVendors: Object.keys(byCompany).length }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/suspense-tool/job/:id/dashboard-pdf
router.get('/job/:id/dashboard-pdf', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const byCompany = {};
    job.analysisResult.forEach((a) => {
      const name = (a.humanCorrection != null ? a.humanCorrection : a.predictedCompany) || 'Unclassified';
      byCompany[name] = (byCompany[name] || 0) + 1;
    });
    const companyData = Object.entries(byCompany).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="suspense-dashboard-${job._id}.pdf"`);
    doc.pipe(res);
    doc.fontSize(18).text('Suspense Analysis Dashboard', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`File: ${job.fileName} | Total entries: ${job.analysisResult.length}`, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(14).text('Summary by company/vendor', { underline: true });
    doc.moveDown();
    companyData.forEach((c) => {
      doc.fontSize(10).text(`${c.name}: ${c.count}`);
    });
    doc.end();
  } catch (err) {
    console.error('Dashboard PDF error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
