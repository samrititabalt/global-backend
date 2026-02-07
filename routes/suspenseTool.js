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
const SuspenseCustomerCorrection = require('../models/SuspenseCustomerCorrection');
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

// Parse Excel: single sheet
function parseSpreadsheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: true });
  const first = wb.SheetNames[0];
  const ws = wb.Sheets[first];
  const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  const columns = data.length ? Object.keys(data[0]) : [];
  return { columns, rows: data };
}

// Parse Excel: up to 3 sheets
function parseSpreadsheetMultiSheet(buffer, maxSheets = 3) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: true });
  const out = [];
  for (let i = 0; i < Math.min(wb.SheetNames.length, maxSheets); i++) {
    const name = wb.SheetNames[i];
    const ws = wb.Sheets[name];
    const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    const columns = data.length ? Object.keys(data[0]) : [];
    out.push({ sheetName: name, columns, rows: data });
  }
  return out;
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

// Get customer corrections for this user only (data isolation)
async function getCustomerCorrections(userId) {
  const list = await SuspenseCustomerCorrection.find({ user: userId }).sort({ createdAt: -1 }).limit(100).lean();
  return list.map((c) => `"${(c.originalEntrySnippet || '').slice(0, 100)}" → "${c.correctedCompany}"`).join('\n');
}

// Call GPT: company, confidence (0-80), vendorCategory, remarks (when conf < 80)
async function predictCompanyWithGPT(entryText, country, customerCorrectionsText) {
  if (!openaiClient) {
    return { predictedCompany: 'N/A', confidence: 0, vendorCategory: 'Others', remarks: 'Analysis unavailable.' };
  }
  const countryContext = country ? ` Data is from: ${country}. Prioritize ${country}-specific vendors and categories.` : '';
  const correctionsContext = customerCorrectionsText ? `\nApply these past human corrections for this customer when the entry is similar:\n${customerCorrectionsText}` : '';
  const systemPrompt = `You are an expert at classifying unclear bank/expense entries into company/vendor names and categories.${countryContext}${correctionsContext}
Respond with ONLY valid JSON (no markdown): {
  "company": "Predicted Company or Vendor Name",
  "confidence": number 0-80 (never above 80),
  "vendorCategory": "One of: Food & Beverage, Travel, SaaS, Retail, Utilities, Professional Services, Banking, Others",
  "remarks": "Brief note on analysis effort; if confidence < 80% suggest 1-3 alternative vendor names and explain uncertainty (e.g. 'I am only 51% confident. This might be X or Y. If the human reviewer corrects this, I will remember for future reports.')"
}.
Use 0-30 for very unclear, 31-50 for guess, 51-80 for likely.`;
  try {
    const completion = await openaiClient.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Classify this entry: "${(entryText || '').slice(0, 400)}"` }
      ],
      max_tokens: 220,
      temperature: 0.2
    });
    const content = completion.choices?.[0]?.message?.content?.trim() || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      let conf = Number(parsed.confidence);
      if (Number.isNaN(conf) || conf > 80) conf = 80;
      if (conf < 0) conf = 0;
      let remarks = String(parsed.remarks || '').slice(0, 500);
      if (parsed.humanCorrection) remarks = `This entry was corrected by a human reviewer. I will apply this correction logic to future suspense reports for this customer. ${remarks}`;
      return {
        predictedCompany: String(parsed.company || parsed.companyName || 'N/A').slice(0, 200),
        confidence: conf,
        vendorCategory: String(parsed.vendorCategory || 'Others').slice(0, 80),
        remarks: remarks || (conf < 80 ? 'Low confidence; please review.' : '')
      };
    }
  } catch (e) {
    console.error('GPT suspense classification error:', e.message);
  }
  return { predictedCompany: 'N/A', confidence: 0, vendorCategory: 'Others', remarks: 'Analysis failed.' };
}

// Cross-sheet summary via GPT
async function buildCrossSheetSummary(job, allResultsFlat) {
  if (!openaiClient || !allResultsFlat.length) return '';
  const vendorCounts = {};
  const categoryCounts = {};
  allResultsFlat.forEach((a) => {
    const v = (a.humanCorrection != null ? a.humanCorrection : a.predictedCompany) || 'Unclassified';
    vendorCounts[v] = (vendorCounts[v] || 0) + 1;
    const cat = a.vendorCategory || 'Others';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  const summary = `Vendors: ${JSON.stringify(vendorCounts)}. Categories: ${JSON.stringify(categoryCounts)}. Total entries: ${allResultsFlat.length}.`;
  try {
    const completion = await openaiClient.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a financial analyst. Given aggregated suspense data (vendors, categories, counts), produce a concise Summary Report: total spend context, spend by vendor, by category, cross-sheet comparisons, repeated vendors, anomalies, and month-over-month patterns if evident. Be specific and use the numbers provided.'
        },
        { role: 'user', content: summary }
      ],
      max_tokens: 800,
      temperature: 0.3
    });
    return (completion.choices?.[0]?.message?.content || '').trim().slice(0, 4000);
  } catch (e) {
    console.error('Cross-sheet summary error:', e.message);
    return '';
  }
}

// Get flat analysis for a job (supports legacy single-sheet or multi-sheet)
function getJobAnalysisFlat(job) {
  if (job.sheets && job.sheets.length > 0) {
    const out = [];
    job.sheets.forEach((sh) => {
      (sh.analysisResult || []).forEach((a) => out.push({ ...a, sheetName: sh.sheetName, workbookName: sh.workbookName }));
    });
    return out;
  }
  return job.analysisResult || [];
}

// Get rows for a job (legacy or from sheets)
function getJobRows(job, sheetIndex = 0) {
  if (job.sheets && job.sheets[sheetIndex]) return job.sheets[sheetIndex].rawRows || [];
  return job.rawRows || [];
}

function getJobColumns(job, sheetIndex = 0) {
  if (job.sheets && job.sheets[sheetIndex]) return job.sheets[sheetIndex].originalColumns || [];
  return job.originalColumns || [];
}

function getJobAnalysisResult(job, sheetIndex = 0) {
  if (job.sheets && job.sheets[sheetIndex]) return job.sheets[sheetIndex].analysisResult || [];
  return job.analysisResult || [];
}

// POST /api/suspense-tool/upload — single file (field "file") or multiple (field "files", max 3); body: country, multiSheet, multiWorkbook
router.post('/upload', protect, authorize('customer', 'admin', 'agent', 'employee'), upload.fields([{ name: 'file', maxCount: 1 }, { name: 'files', maxCount: 3 }]), async (req, res) => {
  try {
    const country = (req.body?.country || '').trim().slice(0, 100);
    const multiSheet = req.body?.multiSheet === 'true' || req.body?.multiSheet === true;
    const multiWorkbook = req.body?.multiWorkbook === 'true' || req.body?.multiWorkbook === true;
    const folder = `suspense-tool/${req.user._id}`;

    const multiFiles = req.files?.files ? (Array.isArray(req.files.files) ? req.files.files : [req.files.files]) : [];
    if (multiWorkbook && multiFiles.length > 0) {
      const files = multiFiles.slice(0, 3);
      const sheets = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const type = getFileType(f.originalname, f.mimetype);
        const result = await uploadFile(f.buffer, folder, f.mimetype);
        if (type === 'pdf') {
          const pdfData = await pdfParse(f.buffer);
          const text = (pdfData.text || '').trim();
          const lines = text.split(/\r?\n/).filter(Boolean);
          const rows = lines.slice(0, 5000).map((line) => ({ Entry: line }));
          sheets.push({ sheetId: `wb-${i}-0`, sheetName: 'PDF', workbookName: f.originalname, fileUrl: result.url, originalColumns: ['Entry'], rawRows: rows, analysisResult: [] });
        } else if (type === 'csv') {
          const parsed = parseCSV(f.buffer);
          sheets.push({ sheetId: `wb-${i}-0`, sheetName: 'Sheet1', workbookName: f.originalname, fileUrl: result.url, originalColumns: parsed.columns, rawRows: parsed.rows.slice(0, 10000), analysisResult: [] });
        } else {
          const sheetList = multiSheet ? parseSpreadsheetMultiSheet(f.buffer, 3) : [parseSpreadsheet(f.buffer)];
          sheetList.forEach((s, j) => {
            sheets.push({ sheetId: `wb-${i}-${j}`, sheetName: s.sheetName || `Sheet${j + 1}`, workbookName: f.originalname, fileUrl: result.url, originalColumns: s.columns, rawRows: (s.rows || []).slice(0, 10000), analysisResult: [] });
          });
        }
      }
      const job = await SuspenseJob.create({
        user: req.user._id,
        fileName: files.map((f) => f.originalname).join(', '),
        fileType: 'multi',
        country,
        multiSheet,
        multiWorkbook: true,
        hasPdfUpload: files.some((f) => getFileType(f.originalname, f.mimetype) === 'pdf'),
        status: 'uploaded',
        sheets
      });
      return res.json({ success: true, job: { _id: job._id, fileName: job.fileName, fileType: job.fileType, status: job.status, sheets: job.sheets, country: job.country } });
    }

    const singleFile = req.file || req.files?.file?.[0];
    if (!singleFile) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const fileType = getFileType(singleFile.originalname, singleFile.mimetype);
    const isPdf = fileType === 'pdf';
    const result = await uploadFile(singleFile.buffer, folder, singleFile.mimetype);

    if (multiSheet && (fileType === 'excel' || fileType === 'xlsx')) {
      const sheetList = parseSpreadsheetMultiSheet(singleFile.buffer, 3);
      const sheets = sheetList.map((s, i) => ({
        sheetId: `s-${i}`,
        sheetName: s.sheetName || `Sheet${i + 1}`,
        workbookName: req.file.originalname,
        fileUrl: result.url,
        originalColumns: s.columns,
        rawRows: (s.rows || []).slice(0, 10000),
        analysisResult: []
      }));
      const job = await SuspenseJob.create({
        user: req.user._id,
        fileName: singleFile.originalname,
        fileType: 'excel',
        fileUrl: result.url,
        cloudinaryPublicId: result.publicId,
        country,
        multiSheet: true,
        multiWorkbook: false,
        hasPdfUpload: false,
        status: 'uploaded',
        sheets
      });
      return res.json({ success: true, job: { _id: job._id, fileName: job.fileName, fileType: job.fileType, status: job.status, sheets: job.sheets, country: job.country } });
    }

    const job = await SuspenseJob.create({
      user: req.user._id,
      fileName: singleFile.originalname,
      fileType,
      fileUrl: result.url,
      cloudinaryPublicId: result.publicId,
      country,
      multiSheet: false,
      multiWorkbook: false,
      hasPdfUpload: isPdf,
      status: 'uploaded'
    });
    return res.json({ success: true, job: { _id: job._id, fileName: job.fileName, fileType: job.fileType, status: job.status, country: job.country } });
  } catch (err) {
    console.error('Suspense upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
});

// POST /api/suspense-tool/analyze/:jobId — body: { country }
router.post('/analyze/:jobId', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.jobId, user: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.status !== 'uploaded') {
      return res.status(400).json({ success: false, message: 'Job already analyzed or invalid state' });
    }

    const country = (req.body.country || job.country || '').trim().slice(0, 100);
    if (country) job.country = country;
    job.status = 'analyzing';
    await job.save();

    const customerCorrectionsText = await getCustomerCorrections(req.user._id);

    const runAnalysisOnRows = async (columns, rows, sheetIndex) => {
      const analysisResult = [];
      const BATCH = 15;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const promises = chunk.map((row, idx) => {
          const entry = rowToEntry(row, columns);
          return predictCompanyWithGPT(entry, country, customerCorrectionsText).then((r) => ({
            rowIndex: i + idx,
            originalEntry: entry,
            predictedCompany: r.predictedCompany,
            confidence: r.confidence,
            humanCorrection: null,
            vendorCategory: r.vendorCategory,
            remarks: r.remarks
          }));
        });
        const results = await Promise.all(promises);
        analysisResult.push(...results);
      }
      return analysisResult;
    };

    if (job.sheets && job.sheets.length > 0) {
      for (let s = 0; s < job.sheets.length; s++) {
        const sheet = job.sheets[s];
        let rows = sheet.rawRows || [];
        let columns = sheet.originalColumns || [];
        if (rows.length === 0 && sheet.fileUrl) {
          const response = await axios.get(sheet.fileUrl, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(response.data);
          if (sheet.sheetName === 'PDF') {
            const pdfData = await pdfParse(buffer);
            const text = (pdfData.text || '').trim();
            const lines = text.split(/\r?\n/).filter(Boolean);
            columns = ['Entry'];
            rows = lines.slice(0, 5000).map((line) => ({ Entry: line }));
          } else {
            const parsed = parseSpreadsheet(buffer);
            columns = parsed.columns;
            rows = parsed.rows.slice(0, 10000);
          }
          sheet.originalColumns = columns;
          sheet.rawRows = rows;
        }
        sheet.analysisResult = await runAnalysisOnRows(columns, rows, s);
      }
      const allFlat = getJobAnalysisFlat(job);
      job.summaryReport = await buildCrossSheetSummary(job, allFlat);
    } else {
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
        const parsed = parseSpreadsheet(buffer);
        columns = parsed.columns;
        rows = parsed.rows;
      }
      job.originalColumns = columns;
      job.rawRows = rows.slice(0, 10000);
      job.analysisResult = await runAnalysisOnRows(columns, job.rawRows, 0);
      job.summaryReport = await buildCrossSheetSummary(job, job.analysisResult);
    }

    job.status = 'ready';
    job.updatedAt = new Date();
    await job.save();

    const outJob = job.toObject ? job.toObject() : job;
    res.json({
      success: true,
      job: {
        _id: outJob._id,
        status: outJob.status,
        originalColumns: outJob.originalColumns,
        rawRows: outJob.rawRows,
        sheets: outJob.sheets,
        rowCount: outJob.sheets?.reduce((n, sh) => n + (sh.rawRows?.length || 0), 0) || outJob.rawRows?.length,
        analysisResult: outJob.analysisResult,
        summaryReport: outJob.summaryReport
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

// PUT /api/suspense-tool/job/:id/correction — save to job and to customer corrections (AI learning)
router.put('/job/:id/correction', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const { rowIndex, humanCorrection, sheetIndex, originalEntry } = req.body;
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    const si = sheetIndex != null ? Number(sheetIndex) : 0;
    const resultList = getJobAnalysisResult(job, si);
    const entry = resultList.find((r) => r.rowIndex === rowIndex);
    if (entry) {
      entry.humanCorrection = humanCorrection != null ? String(humanCorrection) : null;
      entry.correctedAt = new Date();
      if (entry.remarks) entry.remarks = `This entry was corrected by a human reviewer. I will apply this correction logic to future suspense reports for this customer. ${entry.remarks}`;
      if (humanCorrection && (entry.originalEntry || originalEntry)) {
        await SuspenseCustomerCorrection.create({
          user: req.user._id,
          originalEntrySnippet: (entry.originalEntry || originalEntry || '').slice(0, 300),
          correctedCompany: String(humanCorrection).slice(0, 200)
        });
      }
    }
    job.updatedAt = new Date();
    if (job.sheets && job.sheets.length) job.markModified('sheets');
    else if (job.analysisResult) job.markModified('analysisResult');
    await job.save();
    res.json({ success: true, job: job.toObject ? job.toObject() : job });
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

// GET /api/suspense-tool/job/:id/export-excel — adds Predicted Company, Confidence, Human Correction, Remarks, Vendor Category
function buildExcelBuffer(job) {
  const wb = XLSX.utils.book_new();
  const baseHeaders = ['Predicted Company', 'Confidence %', 'Human Correction', 'Vendor Category', 'Remarks / Suggestions'];

  if (job.sheets && job.sheets.length > 0) {
    job.sheets.forEach((sh, idx) => {
      const cols = sh.originalColumns || [];
      const headers = [...cols, ...baseHeaders];
      const rows = (sh.rawRows || []).map((row, i) => {
        const analysis = (sh.analysisResult || []).find((a) => a.rowIndex === i) || {};
        const displayCompany = analysis.humanCorrection != null ? analysis.humanCorrection : analysis.predictedCompany;
        return [
          ...cols.map((col) => row[col] ?? ''),
          displayCompany || '',
          analysis.confidence != null ? analysis.confidence : '',
          analysis.humanCorrection != null ? analysis.humanCorrection : '',
          analysis.vendorCategory != null ? analysis.vendorCategory : '',
          analysis.remarks != null ? analysis.remarks : ''
        ];
      });
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const sheetName = (sh.sheetName || sh.workbookName || `Sheet${idx + 1}`).slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
  } else {
    const cols = job.originalColumns || [];
    const headers = [...cols, ...baseHeaders];
    const rows = (job.rawRows || []).map((row, i) => {
      const analysis = (job.analysisResult || []).find((a) => a.rowIndex === i) || {};
      const displayCompany = analysis.humanCorrection != null ? analysis.humanCorrection : analysis.predictedCompany;
      return [
        ...cols.map((col) => row[col] ?? ''),
        displayCompany || '',
        analysis.confidence != null ? analysis.confidence : '',
        analysis.humanCorrection != null ? analysis.humanCorrection : '',
        analysis.vendorCategory != null ? analysis.vendorCategory : '',
        analysis.remarks != null ? analysis.remarks : ''
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Suspense Analysis');
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

router.get('/job/:id/export-excel', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    const buf = buildExcelBuffer(job);
    const name = (job.fileName || 'suspense').replace(/\.[a-z]+$/i, '') + '-analyzed.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buf);
  } catch (err) {
    console.error('Export excel error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/suspense-tool/job/:id/export-pdf — analyzed data as PDF (when user uploaded PDF)
router.get('/job/:id/export-pdf', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (!job.hasPdfUpload) return res.status(400).json({ success: false, message: 'PDF export only for PDF uploads' });

    const flat = getJobAnalysisFlat(job);
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="suspense-${(job.fileName || 'data').replace(/\.[a-z]+$/i, '')}-analyzed.pdf"`);
    doc.pipe(res);
    doc.fontSize(14).text('Suspense Analysis Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10);
    flat.slice(0, 200).forEach((a, i) => {
      const company = a.humanCorrection != null ? a.humanCorrection : a.predictedCompany;
      doc.text(`${i + 1}. ${(a.originalEntry || '').slice(0, 60)}... → ${company} (${a.confidence || 0}%) ${a.vendorCategory || ''}`);
      doc.moveDown(0.3);
    });
    if (flat.length > 200) doc.text(`... and ${flat.length - 200} more entries. Download Excel for full data.`);
    doc.end();
  } catch (err) {
    console.error('Export PDF error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

function buildAnalyzedPdfBuffer(job) {
  return new Promise((resolve, reject) => {
    const flat = getJobAnalysisFlat(job);
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(14).text('Suspense Analysis Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10);
    flat.slice(0, 200).forEach((a, i) => {
      const company = a.humanCorrection != null ? a.humanCorrection : a.predictedCompany;
      doc.text(`${i + 1}. ${(a.originalEntry || '').slice(0, 60)}... → ${company} (${a.confidence || 0}%)`);
      doc.moveDown(0.3);
    });
    doc.end();
  });
}

// POST /api/suspense-tool/job/:id/send-email — Excel + PDF (if hasPdfUpload)
router.post('/job/:id/send-email', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const excelBuf = buildExcelBuffer(job);
    const attachments = [
      { content: excelBuf.toString('base64'), name: `suspense-${(job.fileName || 'data').replace(/\.[a-z]+$/i, '')}-analyzed.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    ];
    if (job.hasPdfUpload) {
      const pdfBuf = await buildAnalyzedPdfBuffer(job);
      attachments.push({ content: pdfBuf.toString('base64'), name: `suspense-${(job.fileName || 'data').replace(/\.[a-z]+$/i, '')}-analyzed.pdf`, contentType: 'application/pdf' });
    }

    const toEmail = req.user.email || req.body.email;
    if (!toEmail) return res.status(400).json({ success: false, message: 'No email address' });
    await mailWithAttachment(toEmail, 'Your Suspense Tool analysis', `<p>Attached: Excel${job.hasPdfUpload ? ' and PDF' : ''} of your analyzed data.</p><p>File(s): ${job.fileName}</p>`, attachments);
    res.json({ success: true, message: 'Email sent' });
  } catch (err) {
    console.error('Send email error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/suspense-tool/job/:id/dashboard — 8-10 charts for large dataset, 1-2 for small
router.get('/job/:id/dashboard', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const flat = getJobAnalysisFlat(job);
    const total = flat.length;
    const isLarge = total > 100;

    const byCompany = {};
    const byCategory = {};
    flat.forEach((a) => {
      const name = (a.humanCorrection != null ? a.humanCorrection : a.predictedCompany) || 'Unclassified';
      byCompany[name] = (byCompany[name] || 0) + 1;
      const cat = a.vendorCategory || 'Others';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    const companyData = Object.entries(byCompany).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20);
    const categoryData = Object.entries(byCategory).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    const charts = [
      { type: 'pie', title: 'By company/vendor', data: companyData.map((c) => ({ label: c.name, value: c.count })) },
      { type: 'bar', title: 'Top vendors', data: companyData },
      { type: 'pie', title: 'By vendor category', data: categoryData.map((c) => ({ label: c.name, value: c.count })) },
      { type: 'bar', title: 'By category', data: categoryData }
    ];
    if (isLarge) {
      charts.push({ type: 'stackedBar', title: 'Vendor vs category (top 10)', data: companyData.slice(0, 10) });
      charts.push({ type: 'trend', title: 'Vendor distribution', data: companyData.slice(0, 15) });
      charts.push({ type: 'line', title: 'Category spread', data: categoryData });
    }

    res.json({
      success: true,
      charts: charts.slice(0, isLarge ? 10 : 2),
      summary: { totalEntries: total, uniqueVendors: Object.keys(byCompany).length, uniqueCategories: Object.keys(byCategory).length },
      summaryReport: job.summaryReport || ''
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/suspense-tool/job/:id/dashboard-pdf — dashboard export ONLY as PDF
router.get('/job/:id/dashboard-pdf', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const flat = getJobAnalysisFlat(job);
    const byCompany = {};
    const byCategory = {};
    flat.forEach((a) => {
      const name = (a.humanCorrection != null ? a.humanCorrection : a.predictedCompany) || 'Unclassified';
      byCompany[name] = (byCompany[name] || 0) + 1;
      const cat = a.vendorCategory || 'Others';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    const companyData = Object.entries(byCompany).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 25);
    const categoryData = Object.entries(byCategory).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 15);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="suspense-dashboard-${job._id}.pdf"`);
    doc.pipe(res);
    doc.fontSize(18).text('Suspense Analysis Dashboard', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`File: ${job.fileName} | Total entries: ${flat.length}`, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(14).text('Summary by company/vendor', { underline: true });
    doc.moveDown();
    companyData.forEach((c) => { doc.fontSize(10).text(`${c.name}: ${c.count}`); });
    doc.moveDown();
    doc.fontSize(14).text('Summary by category', { underline: true });
    doc.moveDown();
    categoryData.forEach((c) => { doc.fontSize(10).text(`${c.name}: ${c.count}`); });
    if (job.summaryReport) {
      doc.moveDown();
      doc.fontSize(14).text('Cross-sheet summary', { underline: true });
      doc.moveDown();
      doc.fontSize(9).text(job.summaryReport.slice(0, 2000), { align: 'left' });
    }
    doc.end();
  } catch (err) {
    console.error('Dashboard PDF error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/suspense-tool/job/:id/qa — GPT Q&A about this job's data only (strict user isolation)
router.post('/job/:id/qa', protect, authorize('customer', 'admin', 'agent', 'employee'), async (req, res) => {
  try {
    const job = await SuspenseJob.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const question = (req.body.question || '').trim().slice(0, 1000);
    if (!question) return res.status(400).json({ success: false, message: 'Question required' });

    const flat = getJobAnalysisFlat(job);
    const byCompany = {};
    const byCategory = {};
    flat.forEach((a) => {
      const name = (a.humanCorrection != null ? a.humanCorrection : a.predictedCompany) || 'Unclassified';
      byCompany[name] = (byCompany[name] || 0) + 1;
      const cat = a.vendorCategory || 'Others';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    const context = `Summary: ${job.summaryReport || 'N/A'}. Total entries: ${flat.length}. Vendors: ${JSON.stringify(byCompany)}. Categories: ${JSON.stringify(byCategory)}. Country: ${job.country || 'Not specified'}.`;

    if (!openaiClient) {
      return res.json({ success: true, answer: 'Q&A is not available. Please configure OpenAI.' });
    }
    const completion = await openaiClient.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a helpful analyst for this customer's suspense data. Answer only from the provided context. Provide predictive analytics when asked (e.g. which category may increase, which vendor is trending, expected spend). Use trend analysis, category patterns, vendor frequency, and country context. Be conversational and specific. If the data does not support an answer, say so. Context:\n${context}`
        },
        { role: 'user', content: question }
      ],
      max_tokens: 600,
      temperature: 0.4
    });
    const answer = (completion.choices?.[0]?.message?.content || '').trim();
    res.json({ success: true, answer });
  } catch (err) {
    console.error('Suspense Q&A error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
