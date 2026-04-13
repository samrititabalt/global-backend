/**
 * Live Prompter — admin-only knowledge repo + live suggestions (interview + client meeting modes).
 * Mounted at /api/admin/live-prompter
 */

const express = require('express');
const multer = require('multer');
const { protect, authorize } = require('../middleware/auth');
const LivePrompterRepository = require('../models/LivePrompterRepository');
const { uploadFile, uploadAudio, deleteFromCloudinary } = require('../services/cloudinary');
const { extractDocumentText, transcribeAudioBuffer } = require('../services/livePrompterContent');
const { applyFuzzyGlossary } = require('../utils/livePrompterGlossary');
const { extractQuestionsFromPausedTranscript } = require('../utils/livePrompterQuestionSplit');
const {
  livePrompterSummarizeKnowledge,
  livePrompterSuggestAnswer,
  livePrompterCleanQuestion
} = require('../services/openaiService');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/msword' ||
      file.mimetype === 'text/plain' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      file.mimetype === 'application/vnd.ms-powerpoint';
    if (ok) cb(null, true);
    else cb(new Error('Allowed: PDF, DOCX, DOC, TXT, PPTX, PPT'), false);
  }
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const m = file.mimetype || '';
    if (
      m.startsWith('audio/') ||
      m === 'video/webm' ||
      m === 'application/ogg' ||
      m === 'audio/webm'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

const MODES = ['interview', 'clientMeeting'];

function parseMode(value, fallback = 'interview') {
  return value === 'clientMeeting' ? 'clientMeeting' : fallback === 'clientMeeting' ? 'clientMeeting' : 'interview';
}

async function migrateLegacyKnowledge(repo) {
  if (!repo) return false;
  const hasLegacy =
    (repo.documents && repo.documents.length > 0) ||
    (repo.linkedInUrl && String(repo.linkedInUrl).trim()) ||
    (repo.audioIntroduction &&
      (repo.audioIntroduction.cloudinaryUrl || (repo.audioIntroduction.transcript && repo.audioIntroduction.transcript.trim()))) ||
    (repo.structuredProfile && String(repo.structuredProfile).trim());

  if (!repo.interviewKnowledge || typeof repo.interviewKnowledge !== 'object') {
    repo.interviewKnowledge = { documents: [] };
  }
  const ik = repo.interviewKnowledge;
  const interviewEmpty =
    (!ik.documents || ik.documents.length === 0) &&
    !(ik.linkedInUrl && String(ik.linkedInUrl).trim()) &&
    !(
      ik.audioIntroduction &&
      (ik.audioIntroduction.cloudinaryUrl || (ik.audioIntroduction.transcript && ik.audioIntroduction.transcript.trim()))
    ) &&
    !(ik.structuredProfile && String(ik.structuredProfile).trim());

  let dirty = false;
  if (hasLegacy && interviewEmpty) {
    ik.documents = repo.documents && repo.documents.length ? [...repo.documents] : [];
    ik.linkedInUrl = repo.linkedInUrl || '';
    ik.audioIntroduction = repo.audioIntroduction;
    ik.structuredProfile = repo.structuredProfile || '';
    ik.knowledgeSummaryUpdatedAt = repo.knowledgeSummaryUpdatedAt;
    repo.set('documents', []);
    repo.set('linkedInUrl', '');
    repo.set('audioIntroduction', undefined);
    repo.set('structuredProfile', '');
    repo.set('knowledgeSummaryUpdatedAt', undefined);
    dirty = true;
  }

  if (!repo.clientMeetingKnowledge || typeof repo.clientMeetingKnowledge !== 'object') {
    repo.clientMeetingKnowledge = { documents: [] };
    dirty = true;
  }

  if (dirty) {
    await repo.save();
  }
  return dirty;
}

async function getOrCreateRepo(userId) {
  let repo = await LivePrompterRepository.findOne({ userId });
  if (!repo) {
    repo = await LivePrompterRepository.create({ userId });
  }
  await migrateLegacyKnowledge(repo);
  return LivePrompterRepository.findOne({ userId });
}

function getBank(repo, mode) {
  const m = parseMode(mode);
  return m === 'clientMeeting' ? repo.clientMeetingKnowledge : repo.interviewKnowledge;
}

function buildRawBundleFromBank(bank) {
  const b = bank || {};
  const parts = [];
  for (const d of b.documents || []) {
    parts.push(`--- DOCUMENT: ${d.fileName} ---\n${d.extractedText || '[No extracted text]'}`);
  }
  parts.push(
    `--- LINKEDIN / REFERENCE URL ---\n${b.linkedInUrl || '(none)'}\nNote: Public pages are not scraped; URL is for your reference unless you pasted text in documents.`
  );
  if (b.audioIntroduction?.transcript) {
    parts.push(`--- AUDIO INTRO TRANSCRIPT ---\n${b.audioIntroduction.transcript}`);
  } else if (b.audioIntroduction?.cloudinaryUrl) {
    parts.push('--- AUDIO INTRO ---\n[Uploaded; no transcript available — re-upload or add summary manually in documents.]');
  }
  return parts.join('\n\n');
}

function serializeDocList(docs) {
  return (docs || []).map((d) => ({
    _id: d._id,
    fileName: d.fileName,
    mimeType: d.mimeType,
    cloudinaryUrl: d.cloudinaryUrl,
    uploadedAt: d.uploadedAt,
    hasExtractedText: !!(d.extractedText && d.extractedText.length)
  }));
}

function serializeBank(bank) {
  const b = bank || {};
  return {
    documents: serializeDocList(b.documents),
    linkedInUrl: b.linkedInUrl || '',
    audioIntroduction: b.audioIntroduction
      ? {
          cloudinaryUrl: b.audioIntroduction.cloudinaryUrl,
          uploadedAt: b.audioIntroduction.uploadedAt,
          hasTranscript: !!(b.audioIntroduction.transcript && b.audioIntroduction.transcript.length)
        }
      : null,
    structuredProfile: b.structuredProfile || '',
    knowledgeSummaryUpdatedAt: b.knowledgeSummaryUpdatedAt || null
  };
}

function serializeRepo(repo) {
  const o = repo.toObject ? repo.toObject() : repo;
  return {
    activeMode: o.activeMode === 'clientMeeting' ? 'clientMeeting' : 'interview',
    interview: serializeBank(o.interviewKnowledge),
    clientMeeting: serializeBank(o.clientMeetingKnowledge),
    trainingInstructions: o.trainingInstructions || '',
    trainingInstructionsUpdatedAt: o.trainingInstructionsUpdatedAt || null,
    glossaryTerms: Array.isArray(o.glossaryTerms) ? o.glossaryTerms.filter(Boolean) : [],
    updatedAt: o.updatedAt
  };
}

// @route   GET /api/admin/live-prompter/repository
router.get('/repository', protect, authorize('admin'), async (req, res) => {
  try {
    const repo = await getOrCreateRepo(req.user._id);
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   PUT /api/admin/live-prompter/active-mode
router.put('/active-mode', protect, authorize('admin'), async (req, res) => {
  try {
    const mode = parseMode(req.body?.activeMode);
    const repo = await getOrCreateRepo(req.user._id);
    repo.activeMode = mode;
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   POST /api/admin/live-prompter/documents  (multipart: document, mode=interview|clientMeeting)
router.post('/documents', protect, authorize('admin'), (req, res, next) => {
  upload.single('document')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload error' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: 'document file is required (field name: document)' });
    }
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      return res.status(500).json({ message: 'Cloudinary is not configured.' });
    }

    const mode = parseMode(req.body?.mode);
    const repo = await getOrCreateRepo(req.user._id);
    const bank = getBank(repo, mode);
    if (!bank.documents) bank.documents = [];

    const folder = `live-prompter/${req.user._id}/${mode}`;
    const up = await uploadFile(req.file.buffer, folder, req.file.mimetype);
    const extractedText = await extractDocumentText(req.file.buffer, req.file.mimetype);

    bank.documents.push({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      cloudinaryUrl: up.url,
      cloudinaryPublicId: up.publicId,
      extractedText
    });
    await repo.save();
    res.status(201).json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   DELETE /api/admin/live-prompter/documents/:id?mode=interview|clientMeeting
router.delete('/documents/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const mode = parseMode(req.query?.mode);
    const repo = await LivePrompterRepository.findOne({ userId: req.user._id });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });
    await migrateLegacyKnowledge(repo);

    const bank = getBank(repo, mode);
    const doc = bank.documents.id(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    if (doc.cloudinaryPublicId) {
      await deleteFromCloudinary(doc.cloudinaryPublicId, 'raw').catch(() => {});
    }
    bank.documents.pull({ _id: req.params.id });
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

const MAX_TRAINING_CHARS = 8000;
const MAX_GLOSSARY_TERMS = 200;
const MAX_GLOSSARY_TERM_LEN = 100;

// @route   PUT /api/admin/live-prompter/glossary
router.put('/glossary', protect, authorize('admin'), async (req, res) => {
  try {
    let terms = [];
    if (Array.isArray(req.body?.glossaryTerms)) {
      terms = req.body.glossaryTerms
        .map((t) => (typeof t === 'string' ? t.trim().slice(0, MAX_GLOSSARY_TERM_LEN) : ''))
        .filter(Boolean);
    } else if (typeof req.body?.glossaryText === 'string') {
      terms = req.body.glossaryText
        .split(/[\n,]+/)
        .map((t) => t.trim().slice(0, MAX_GLOSSARY_TERM_LEN))
        .filter(Boolean);
    }
    terms = [...new Set(terms.map((t) => t.replace(/\s+/g, ' ')))].slice(0, MAX_GLOSSARY_TERMS);

    const repo = await getOrCreateRepo(req.user._id);
    repo.glossaryTerms = terms;
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   PUT /api/admin/live-prompter/training
router.put('/training', protect, authorize('admin'), async (req, res) => {
  try {
    const raw = typeof req.body?.trainingInstructions === 'string' ? req.body.trainingInstructions : '';
    const trainingInstructions = raw.slice(0, MAX_TRAINING_CHARS);
    const repo = await getOrCreateRepo(req.user._id);
    repo.trainingInstructions = trainingInstructions;
    repo.trainingInstructionsUpdatedAt = new Date();
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   PUT /api/admin/live-prompter/linkedin  (interview bank only; body.mode optional, default interview)
router.put('/linkedin', protect, authorize('admin'), async (req, res) => {
  try {
    const mode = parseMode(req.body?.mode);
    if (mode !== 'interview') {
      return res.status(400).json({ message: 'LinkedIn URL applies to Interview Mode only.' });
    }
    const url = typeof req.body?.linkedInUrl === 'string' ? req.body.linkedInUrl.trim() : '';
    const repo = await getOrCreateRepo(req.user._id);
    const bank = getBank(repo, 'interview');
    bank.linkedInUrl = url.slice(0, 2000);
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   POST /api/admin/live-prompter/audio  (interview bank only)
router.post('/audio', protect, authorize('admin'), (req, res, next) => {
  audioUpload.single('audio')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload error' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: 'audio file is required (field name: audio)' });
    }
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      return res.status(500).json({ message: 'Cloudinary is not configured.' });
    }

    const mode = parseMode(req.body?.mode);
    if (mode !== 'interview') {
      return res.status(400).json({ message: 'Audio introduction applies to Interview Mode only.' });
    }

    const folder = `live-prompter/audio/${req.user._id}`;
    const up = await uploadAudio(req.file.buffer, folder, req.file.mimetype);
    const transcript = await transcribeAudioBuffer(req.file.buffer, req.file.originalname);

    const repo = await getOrCreateRepo(req.user._id);
    const bank = getBank(repo, 'interview');
    if (bank.audioIntroduction?.cloudinaryPublicId) {
      await deleteFromCloudinary(bank.audioIntroduction.cloudinaryPublicId, 'video').catch(() => {});
    }
    bank.audioIntroduction = {
      cloudinaryUrl: up.url,
      cloudinaryPublicId: up.publicId,
      transcript,
      uploadedAt: new Date()
    };
    await repo.save();
    res.status(201).json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   DELETE /api/admin/live-prompter/audio
router.delete('/audio', protect, authorize('admin'), async (req, res) => {
  try {
    const repo = await LivePrompterRepository.findOne({ userId: req.user._id });
    if (!repo) return res.json(serializeRepo(await getOrCreateRepo(req.user._id)));
    await migrateLegacyKnowledge(repo);
    const bank = getBank(repo, 'interview');

    if (bank.audioIntroduction?.cloudinaryPublicId) {
      await deleteFromCloudinary(bank.audioIntroduction.cloudinaryPublicId, 'video').catch(() => {});
    }
    bank.audioIntroduction = undefined;
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   POST /api/admin/live-prompter/summarize  body: { mode?: interview|clientMeeting }
router.post('/summarize', protect, authorize('admin'), async (req, res) => {
  try {
    const mode = parseMode(req.body?.mode);
    const repo = await getOrCreateRepo(req.user._id);
    const bank = getBank(repo, mode);

    const hasDoc = (bank.documents || []).length > 0;
    const hasLi = !!(bank.linkedInUrl && String(bank.linkedInUrl).trim());
    const hasAudio =
      !!(bank.audioIntroduction?.transcript && bank.audioIntroduction.transcript.trim()) ||
      !!(bank.audioIntroduction?.cloudinaryUrl && bank.audioIntroduction.cloudinaryUrl.trim());
    if (!hasDoc && !hasLi && !hasAudio) {
      return res.status(400).json({
        message:
          'Add at least one document, a reference URL (Interview: LinkedIn), or an audio clip before summarizing this mode.'
      });
    }

    const bundle = buildRawBundleFromBank(bank);
    if (!bundle.trim() || bundle.length < 20) {
      return res.status(400).json({ message: 'Not enough material to summarize. Upload a document or audio transcript.' });
    }

    const structuredProfile = await livePrompterSummarizeKnowledge(bundle, mode);
    bank.structuredProfile = structuredProfile;
    bank.knowledgeSummaryUpdatedAt = new Date();
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Summarization failed' });
  }
});

// @route   POST /api/admin/live-prompter/prompt
// Body: { rawTranscript, mode } after Pause — fuzzy glossary, GPT clean, then answer.
// Or legacy: { questions[], mode } or { question, mode }
router.post('/prompt', protect, authorize('admin'), async (req, res) => {
  try {
    const repo = await LivePrompterRepository.findOne({ userId: req.user._id });
    if (!repo) {
      return res.status(400).json({ message: 'Repository not found.' });
    }
    await migrateLegacyKnowledge(repo);

    const mode = MODES.includes(req.body?.mode) ? req.body.mode : parseMode(repo.activeMode);
    const bank = getBank(repo, mode);
    const profile = bank?.structuredProfile?.trim() || '';
    if (!profile) {
      return res.status(400).json({
        message: `Knowledge profile is empty for ${mode === 'clientMeeting' ? 'Client Meeting' : 'Interview'} mode. Run “Generate / Refresh Knowledge Summary” for that mode first.`
      });
    }

    const trainingInstructions = (repo.trainingInstructions || '').trim();
    const glossary = (repo.glossaryTerms || []).map((t) => String(t).trim()).filter(Boolean);

    let questions = [];
    let cleanedQuestion = '';

    if (typeof req.body?.rawTranscript === 'string' && req.body.rawTranscript.trim()) {
      let text = req.body.rawTranscript.trim().slice(0, 12000);
      text = applyFuzzyGlossary(text, glossary);
      const cleaned = await livePrompterCleanQuestion(text, glossary);
      cleanedQuestion = cleaned;
      const extracted = extractQuestionsFromPausedTranscript(cleaned);
      questions = extracted.length ? extracted : cleaned.length >= 3 ? [cleaned] : [];
    } else if (Array.isArray(req.body?.questions)) {
      questions = req.body.questions
        .map((q) => (typeof q === 'string' ? q.trim() : ''))
        .filter(Boolean);
    } else if (typeof req.body?.question === 'string' && req.body.question.trim()) {
      questions = [req.body.question.trim()];
    }

    if (!questions.length) {
      return res.status(400).json({
        message:
          'Provide rawTranscript (after Pause) or questions[]. Nothing to answer — capture speech, then Pause when the question is complete.'
      });
    }

    const suggestion = await livePrompterSuggestAnswer({
      questions,
      structuredProfile: profile,
      trainingInstructions,
      prompterMode: mode
    });
    res.json({ suggestion, cleanedQuestion: cleanedQuestion || undefined });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Prompt failed' });
  }
});

module.exports = router;
