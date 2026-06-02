/**
 * Resume Tailoring Studio routes (admin-only).
 *
 * Endpoints:
 *   POST /api/admin/resume-tailor/generate
 *     multipart/form-data:
 *       - resume: File (PDF or DOCX)
 *       - jobDescriptions: JSON-encoded string[]  (1..10 items)
 *     Response: { success, model, candidate, results: [...], zipBase64 }
 *
 *   GET  /api/admin/resume-tailor/config
 *     Returns the configured model + feature limits, used by the admin UI.
 *
 * Notes:
 *   - The route is mounted under /api/admin/resume-tailor and protected by `protect + authorize('admin')`,
 *     matching the pattern of every other admin-only route in the project.
 *   - File upload uses multer memory storage so we never persist resume files to disk; everything
 *     happens in-memory within the request lifetime.
 *   - The AI model is read from `getResumeTailorModel()` which follows the same app-wide
 *     OPENAI_MODEL || 'gpt-4o-mini' config used by the rest of the project.
 */

const express = require('express')
const router = express.Router()
const multer = require('multer')
const JSZip = require('jszip')

const { protect, authorize } = require('../middleware/auth')
const {
  extractResumeText,
  parseResumeWithAI,
  tailorResumeForJob,
  getResumeTailorModel,
  slugifyRole,
} = require('../services/resumeTailorService')
const { buildResumeDocx } = require('../utils/resumeDocxBuilder')

const MAX_JOB_DESCRIPTIONS = 10
const MAX_RESUME_BYTES = 10 * 1024 * 1024 // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RESUME_BYTES, files: 1 },
})

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function detectKindFromFile(file) {
  if (!file) return null
  if (file.mimetype === 'application/pdf') return 'pdf'
  if (
    file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'docx'
  // Fall back to extension when mimetype is missing (some browsers/proxies do this)
  const lower = (file.originalname || '').toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  return null
}

function sanitizeJobDescriptions(input) {
  let arr = input
  if (typeof input === 'string') {
    try {
      arr = JSON.parse(input)
    } catch (err) {
      return { error: 'jobDescriptions must be a JSON array of strings.' }
    }
  }
  if (!Array.isArray(arr)) {
    return { error: 'jobDescriptions must be an array.' }
  }
  const cleaned = arr
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
  if (cleaned.length === 0) {
    return { error: 'Provide at least one non-empty job description.' }
  }
  if (cleaned.length > MAX_JOB_DESCRIPTIONS) {
    return { error: `A maximum of ${MAX_JOB_DESCRIPTIONS} job descriptions is allowed.` }
  }
  return { value: cleaned }
}

/**
 * Run async tasks with bounded concurrency. Resolves with results in input order.
 */
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0

  async function next() {
    while (true) {
      const i = cursor
      cursor += 1
      if (i >= items.length) return
      try {
        results[i] = { ok: true, value: await worker(items[i], i) }
      } catch (err) {
        results[i] = { ok: false, error: err }
      }
    }
  }

  const runners = []
  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    runners.push(next())
  }
  await Promise.all(runners)
  return results
}

router.get('/config', protect, authorize('admin'), (req, res) => {
  res.json({
    success: true,
    model: getResumeTailorModel(),
    maxJobDescriptions: MAX_JOB_DESCRIPTIONS,
    maxResumeBytes: MAX_RESUME_BYTES,
    allowedMimeTypes: Array.from(ALLOWED_MIME_TYPES),
  })
})

router.post(
  '/generate',
  protect,
  authorize('admin'),
  (req, res, next) =>
    upload.single('resume')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            success: false,
            message: `Resume file is too large. Max ${Math.round(MAX_RESUME_BYTES / (1024 * 1024))} MB.`,
          })
        }
        return res
          .status(400)
          .json({ success: false, message: err.message || 'Upload failed.' })
      }
      next()
    }),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: 'Please upload your original resume (PDF or DOCX).' })
      }

      const kind = detectKindFromFile(req.file)
      if (!kind) {
        return res.status(400).json({
          success: false,
          message: 'Unsupported file type. Upload a .pdf or .docx resume.',
        })
      }

      const jdResult = sanitizeJobDescriptions(req.body.jobDescriptions)
      if (jdResult.error) {
        return res.status(400).json({ success: false, message: jdResult.error })
      }
      const jobDescriptions = jdResult.value

      const { text, styleHints, sourceKind } = await extractResumeText(req.file.buffer, kind)
      if (!text || text.length < 80) {
        return res.status(422).json({
          success: false,
          message:
            'We could not read enough text from this resume. If it is a scanned PDF, please upload a DOCX or a text-based PDF.',
        })
      }

      let parsedResume
      try {
        parsedResume = await parseResumeWithAI(text)
      } catch (err) {
        console.error('[ResumeTailor] parseResumeWithAI failed:', err?.message)
        return res.status(502).json({
          success: false,
          message: 'AI failed to read the resume. Please try again in a moment.',
          detail: err?.message,
        })
      }

      const tailorResults = await runWithConcurrency(jobDescriptions, 3, (jd, idx) =>
        tailorResumeForJob({ parsedResume, jobDescription: jd, index: idx })
      )

      const zip = new JSZip()
      const results = []
      const usedNames = new Set()

      for (let i = 0; i < tailorResults.length; i += 1) {
        const item = tailorResults[i]
        if (!item.ok) {
          console.error(`[ResumeTailor] JD #${i + 1} failed:`, item.error?.message)
          results.push({
            index: i,
            jobNumber: i + 1,
            status: 'failed',
            error: safePublicGenerationError(item.error),
          })
          continue
        }

        const { tailored, targetRole, roleSlug } = item.value
        try {
          const buffer = await buildResumeDocx(tailored, { styleHints })
          const fileName = uniqueFileName(usedNames, parsedResume.contact?.name, roleSlug, i + 1)
          zip.file(fileName, buffer)
          results.push({
            index: i,
            jobNumber: i + 1,
            status: 'success',
            targetRole,
            fileName,
            base64Docx: buffer.toString('base64'),
          })
        } catch (err) {
          console.error(`[ResumeTailor] DOCX render failed for JD #${i + 1}:`, err?.message)
          results.push({
            index: i,
            jobNumber: i + 1,
            status: 'failed',
            targetRole,
            error: 'Could not render this resume to DOCX.',
          })
        }
      }

      const successCount = results.filter((r) => r.status === 'success').length
      let zipBase64 = null
      if (successCount > 0) {
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
        zipBase64 = zipBuffer.toString('base64')
      }

      res.json({
        success: true,
        model: getResumeTailorModel(),
        sourceKind,
        candidate: {
          name: parsedResume.contact?.name || null,
          email: parsedResume.contact?.email || null,
        },
        successCount,
        failureCount: results.length - successCount,
        results,
        zipBase64,
        zipFileName: buildZipFileName(parsedResume.contact?.name),
      })
    } catch (err) {
      console.error('[ResumeTailor] Unhandled error:', err)
      res.status(500).json({
        success: false,
        message: 'Resume tailoring failed unexpectedly.',
        error: err?.message,
      })
    }
  }
)

function buildZipFileName(candidateName) {
  const slug = slugifyRole(candidateName) || 'tailored-resumes'
  return `${slug}-tailored-resumes.zip`
}

function uniqueFileName(usedNames, candidateName, roleSlug, fallbackIdx) {
  const candidatePart = slugifyRole(candidateName)
  const rolePart = slugifyRole(roleSlug) || `tailored-resume-${fallbackIdx}`
  let base = candidatePart ? `${candidatePart}-${rolePart}` : rolePart
  let candidate = `${base}.docx`
  let suffix = 2
  while (usedNames.has(candidate)) {
    candidate = `${base}-${suffix}.docx`
    suffix += 1
  }
  usedNames.add(candidate)
  return candidate
}

function safePublicGenerationError(error) {
  const message = error?.message || ''
  if (/openai rejected|api key|401|invalid_api_key/i.test(message)) {
    return 'OpenAI is not accepting the configured API key on the backend. Please check Render environment variable OPENAI_API_KEY.'
  }
  if (/rate limit|429/i.test(message)) {
    return 'OpenAI rate limit reached. Please wait a minute and try again.'
  }
  if (/temporarily unavailable|5\d\d/i.test(message)) {
    return 'OpenAI is temporarily unavailable. Please try again shortly.'
  }
  return message || 'AI failed for this job description.'
}

module.exports = router
