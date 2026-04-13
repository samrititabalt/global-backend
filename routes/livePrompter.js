/**
 * Live Prompter — admin-only knowledge repo + live interview suggestions.
 * Mounted at /api/admin/live-prompter
 */

const express = require('express');
const multer = require('multer');
const { protect, authorize } = require('../middleware/auth');
const LivePrompterRepository = require('../models/LivePrompterRepository');
const { uploadFile, uploadAudio, deleteFromCloudinary } = require('../services/cloudinary');
const { extractDocumentText, transcribeAudioBuffer } = require('../services/livePrompterContent');
const { livePrompterSummarizeKnowledge, livePrompterSuggestAnswer } = require('../services/openaiService');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/msword' ||
      file.mimetype === 'text/plain';
    if (ok) cb(null, true);
    else cb(new Error('Only PDF, DOCX, DOC, or TXT allowed'), false);
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

async function getOrCreateRepo(userId) {
  let repo = await LivePrompterRepository.findOne({ userId });
  if (!repo) {
    repo = await LivePrompterRepository.create({ userId });
  }
  return repo;
}

function buildRawBundle(repo) {
  const parts = [];
  for (const d of repo.documents || []) {
    parts.push(`--- DOCUMENT: ${d.fileName} ---\n${d.extractedText || '[No extracted text]'}`);
  }
  parts.push(`--- LINKEDIN ---\nURL on file: ${repo.linkedInUrl || '(none)'}\nNote: Public LinkedIn pages are not scraped; URL is for your reference only unless you pasted profile text elsewhere.`);
  if (repo.audioIntroduction?.transcript) {
    parts.push(`--- AUDIO INTRO TRANSCRIPT ---\n${repo.audioIntroduction.transcript}`);
  } else if (repo.audioIntroduction?.cloudinaryUrl) {
    parts.push('--- AUDIO INTRO ---\n[Uploaded; no transcript available — re-upload or add summary manually in documents.]');
  }
  return parts.join('\n\n');
}

function serializeRepo(repo) {
  const o = repo.toObject ? repo.toObject() : repo;
  return {
    documents: (o.documents || []).map((d) => ({
      _id: d._id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      cloudinaryUrl: d.cloudinaryUrl,
      uploadedAt: d.uploadedAt,
      hasExtractedText: !!(d.extractedText && d.extractedText.length)
    })),
    linkedInUrl: o.linkedInUrl || '',
    audioIntroduction: o.audioIntroduction
      ? {
          cloudinaryUrl: o.audioIntroduction.cloudinaryUrl,
          uploadedAt: o.audioIntroduction.uploadedAt,
          hasTranscript: !!(o.audioIntroduction.transcript && o.audioIntroduction.transcript.length)
        }
      : null,
    structuredProfile: o.structuredProfile || '',
    knowledgeSummaryUpdatedAt: o.knowledgeSummaryUpdatedAt || null,
    trainingInstructions: o.trainingInstructions || '',
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

// @route   POST /api/admin/live-prompter/documents
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

    const folder = `live-prompter/${req.user._id}`;
    const up = await uploadFile(req.file.buffer, folder, req.file.mimetype);
    const extractedText = await extractDocumentText(req.file.buffer, req.file.mimetype);

    const repo = await getOrCreateRepo(req.user._id);
    repo.documents.push({
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

// @route   DELETE /api/admin/live-prompter/documents/:id
router.delete('/documents/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const repo = await LivePrompterRepository.findOne({ userId: req.user._id });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    const doc = repo.documents.id(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    if (doc.cloudinaryPublicId) {
      await deleteFromCloudinary(doc.cloudinaryPublicId, 'raw').catch(() => {});
    }
    repo.documents.pull({ _id: req.params.id });
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

const MAX_TRAINING_CHARS = 8000;

// @route   PUT /api/admin/live-prompter/training
router.put('/training', protect, authorize('admin'), async (req, res) => {
  try {
    const raw = typeof req.body?.trainingInstructions === 'string' ? req.body.trainingInstructions : '';
    const trainingInstructions = raw.slice(0, MAX_TRAINING_CHARS);
    const repo = await getOrCreateRepo(req.user._id);
    repo.trainingInstructions = trainingInstructions;
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   PUT /api/admin/live-prompter/linkedin
router.put('/linkedin', protect, authorize('admin'), async (req, res) => {
  try {
    const url = typeof req.body?.linkedInUrl === 'string' ? req.body.linkedInUrl.trim() : '';
    const repo = await getOrCreateRepo(req.user._id);
    repo.linkedInUrl = url.slice(0, 2000);
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   POST /api/admin/live-prompter/audio
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

    const folder = `live-prompter/audio/${req.user._id}`;
    const up = await uploadAudio(req.file.buffer, folder, req.file.mimetype);
    let transcript = await transcribeAudioBuffer(req.file.buffer, req.file.originalname);

    const repo = await getOrCreateRepo(req.user._id);
    if (repo.audioIntroduction?.cloudinaryPublicId) {
      await deleteFromCloudinary(repo.audioIntroduction.cloudinaryPublicId, 'video').catch(() => {});
    }
    repo.audioIntroduction = {
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

    if (repo.audioIntroduction?.cloudinaryPublicId) {
      await deleteFromCloudinary(repo.audioIntroduction.cloudinaryPublicId, 'video').catch(() => {});
    }
    repo.audioIntroduction = undefined;
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// @route   POST /api/admin/live-prompter/summarize
router.post('/summarize', protect, authorize('admin'), async (req, res) => {
  try {
    const repo = await getOrCreateRepo(req.user._id);
    const hasDoc = (repo.documents || []).length > 0;
    const hasLi = !!(repo.linkedInUrl && String(repo.linkedInUrl).trim());
    const hasAudio =
      !!(repo.audioIntroduction?.transcript && repo.audioIntroduction.transcript.trim()) ||
      !!(repo.audioIntroduction?.cloudinaryUrl && repo.audioIntroduction.cloudinaryUrl.trim());
    if (!hasDoc && !hasLi && !hasAudio) {
      return res.status(400).json({
        message: 'Add at least one document, a LinkedIn URL, or an audio introduction before summarizing.'
      });
    }

    const bundle = buildRawBundle(repo);
    if (!bundle.trim() || bundle.length < 20) {
      return res.status(400).json({ message: 'Not enough material to summarize. Upload a document or audio transcript.' });
    }

    const structuredProfile = await livePrompterSummarizeKnowledge(bundle);
    repo.structuredProfile = structuredProfile;
    repo.knowledgeSummaryUpdatedAt = new Date();
    await repo.save();
    res.json(serializeRepo(repo));
  } catch (e) {
    res.status(500).json({ message: e.message || 'Summarization failed' });
  }
});

// @route   POST /api/admin/live-prompter/prompt
router.post('/prompt', protect, authorize('admin'), async (req, res) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) {
      return res.status(400).json({ message: 'question is required' });
    }

    const repo = await LivePrompterRepository.findOne({ userId: req.user._id });
    const profile = repo?.structuredProfile?.trim() || '';
    if (!profile) {
      return res.status(400).json({
        message: 'Knowledge profile is empty. Run “Generate / Refresh Knowledge Summary” first.'
      });
    }

    const trainingInstructions = (repo.trainingInstructions || '').trim();
    const suggestion = await livePrompterSuggestAnswer({
      question,
      structuredProfile: profile,
      trainingInstructions
    });
    res.json({ suggestion });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Prompt failed' });
  }
});

module.exports = router;
