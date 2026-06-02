/**
 * Resume Tailoring Studio — service layer.
 *
 * Responsibilities:
 *   1. Parse a single uploaded resume (PDF or DOCX) into raw text + best-effort style hints.
 *   2. Use the existing OpenAI client to convert the raw resume into a structured ParsedResume JSON.
 *   3. For each pasted job description, produce a TailoredResume JSON anchored to the original profile.
 *
 * Design choices:
 *   - Reuses `getOpenAIClient` from `services/openaiService.js` so every feature uses the same API layer.
 *   - The model is read from env at call-time, with a feature-specific override:
 *       OPENAI_RESUME_TAILOR_MODEL || OPENAI_MODEL || 'gpt-4o-mini'
 *     Switching model later = config change only, no code change.
 *   - Truthfulness guardrails are baked into the system prompt; we instruct the model never to invent
 *     companies, dates, titles, certifications, achievements, or projects.
 *   - The structured JSON shape is identical for parsed and tailored resumes so the downstream DOCX
 *     builder can stay format-agnostic.
 */

const mammoth = require('mammoth')
const pdfParse = require('pdf-parse')
const { getOpenAIClient } = require('./openaiService')

const RESUME_PARSE_SYSTEM_PROMPT = `You are an expert resume parser.
Convert the supplied raw resume text into a strict JSON object with this exact shape:

{
  "contact": {
    "name": string,
    "title": string | null,
    "email": string | null,
    "phone": string | null,
    "location": string | null,
    "links": [{"label": string, "url": string}]
  },
  "summary": string | null,
  "skills": string[],
  "experience": [
    {
      "company": string,
      "role": string,
      "location": string | null,
      "start": string | null,
      "end": string | null,
      "bullets": string[]
    }
  ],
  "projects": [
    {
      "name": string,
      "role": string | null,
      "period": string | null,
      "bullets": string[]
    }
  ],
  "education": [
    {
      "school": string,
      "degree": string | null,
      "period": string | null,
      "details": string | null
    }
  ],
  "certifications": string[],
  "sectionOrder": string[]
}

Rules:
- Reproduce facts exactly as in the source. Do not invent any data.
- "sectionOrder" must list the section keys in the order they appeared in the source resume,
  using only these keys: "summary", "skills", "experience", "projects", "education", "certifications".
- Omit a section from "sectionOrder" if not present.
- Use null when a field is missing. Use [] when a list is absent.
- Return JSON only — no commentary, no markdown fences.`

const RESUME_TAILOR_SYSTEM_PROMPT = `You are an expert resume writer and career strategist.
You are given:
  (a) ORIGINAL_RESUME — the candidate's real, parsed resume as JSON.
  (b) JOB_DESCRIPTION — text of the role the candidate is applying to.

Produce a tailored version of ORIGINAL_RESUME that better matches JOB_DESCRIPTION.
Return JSON in EXACTLY the same shape as ORIGINAL_RESUME (same keys), with one extra top-level key:
  "targetRole": string  // the role title inferred from the job description (max 60 chars)

CRITICAL RULES (truthfulness — non-negotiable):
- Do NOT fabricate companies, employers, employment dates, job titles, certifications, degrees,
  schools, project names, achievements, or technologies the candidate did not already have.
- Do NOT invent experience, headcount, revenue figures, or measurable outcomes that are absent.
- You MAY rephrase, reorder, condense, and reframe real responsibilities and achievements so they
  resonate more strongly with the job description.
- You MAY emphasise the most relevant skills, projects, or bullets and de-emphasise less relevant ones
  by reordering them or trimming low-value bullets.
- Preserve the candidate's identity (name, contact, email, phone, location, links) exactly.
- Preserve the original "sectionOrder".
- Keep the tone professional and concise. Each bullet under 28 words. Aim for an output that fits on
  one A4 page when typeset at 10–11pt — that means roughly:
    * summary: 2–3 sentences
    * skills: 8–14 items
    * experience: keep all roles, but at most 4 bullets each, prioritising the most JD-relevant ones
    * projects: keep at most 3, with at most 3 bullets each
    * education: keep entries; collapse details if needed
- Use plain text in fields. No markdown, no bullet characters in bullet strings (the renderer adds them).
- Return JSON only — no commentary, no markdown fences.`

/**
 * Extract raw text + best-effort style hints from an uploaded resume buffer.
 * @param {Buffer} buffer
 * @param {'pdf'|'docx'} kind
 */
async function extractResumeText(buffer, kind) {
  if (kind === 'docx') {
    const [textResult, htmlResult] = await Promise.all([
      mammoth.extractRawText({ buffer }),
      mammoth.convertToHtml({ buffer }).catch(() => null),
    ])
    const text = (textResult?.value || '').trim()
    const html = htmlResult?.value || ''
    const styleHints = inferStyleHintsFromHtml(html)
    return { text, styleHints, sourceKind: 'docx' }
  }

  if (kind === 'pdf') {
    const result = await pdfParse(buffer)
    const text = (result?.text || '').trim()
    return {
      text,
      styleHints: { font: 'Calibri', baseFontSize: 10.5, accentColor: '#0F172A' },
      sourceKind: 'pdf',
    }
  }

  throw new Error(`Unsupported resume type: ${kind}`)
}

/**
 * Cheap heuristic from mammoth HTML to guess the visual identity of a DOCX resume.
 * Not pixel-perfect; good enough to pick a font family and a base font size for the rebuild.
 */
function inferStyleHintsFromHtml(html) {
  const fontFamilyMatch =
    html.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?/i) || []
  const font = (fontFamilyMatch[1] || 'Calibri').split(',')[0].trim()

  // Heuristic accent: docx headings often pick up colour="..." attributes through mammoth.
  const colorMatch = html.match(/color\s*:\s*(#[0-9a-fA-F]{3,8})/) || []
  const accentColor = colorMatch[1] || '#0F172A'

  return {
    font: ['Calibri', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Garamond', 'Cambria'].includes(
      font
    )
      ? font
      : 'Calibri',
    baseFontSize: 10.5,
    accentColor,
  }
}

function getResumeTailorModel() {
  return (
    process.env.OPENAI_RESUME_TAILOR_MODEL ||
    process.env.OPENAI_MODEL ||
    'gpt-4o-mini'
  )
}

function safeJsonParse(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (err) {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch (innerErr) {
        return null
      }
    }
    return null
  }
}

async function callJsonCompletion({ system, user, maxTokens = 2200, temperature = 0.25 }) {
  const client = getOpenAIClient()
  if (!client) {
    throw new Error('OPENAI_API_KEY is not configured on the server.')
  }

  const model = getResumeTailorModel()
  const requestBody = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  }
  if (/gpt-4o|gpt-4-turbo|gpt-4\.1|gpt-5/i.test(model)) {
    requestBody.response_format = { type: 'json_object' }
  }

  const completion = await client.chat.completions.create(requestBody)
  const raw = completion.choices?.[0]?.message?.content?.trim() || ''
  const parsed = safeJsonParse(raw)
  if (!parsed) {
    throw new Error('AI returned a non-JSON or empty response.')
  }
  return parsed
}

/**
 * Convert raw resume text into a structured ParsedResume JSON.
 */
async function parseResumeWithAI(rawText) {
  const userPrompt = `Raw resume text:\n\n${rawText.slice(0, 18000)}`
  const parsed = await callJsonCompletion({
    system: RESUME_PARSE_SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 2400,
    temperature: 0.1,
  })
  return normalizeParsedResume(parsed)
}

/**
 * Tailor a parsed resume to a single job description.
 * Returns { tailored, targetRole, roleSlug }.
 */
async function tailorResumeForJob({ parsedResume, jobDescription, index }) {
  const trimmedJd = String(jobDescription || '').slice(0, 12000)

  const userPrompt = `ORIGINAL_RESUME:
${JSON.stringify(parsedResume)}

JOB_DESCRIPTION:
${trimmedJd}

Return the tailored resume JSON now.`

  const tailored = await callJsonCompletion({
    system: RESUME_TAILOR_SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 2600,
    temperature: 0.3,
  })

  const targetRole =
    typeof tailored.targetRole === 'string' && tailored.targetRole.trim()
      ? tailored.targetRole.trim().slice(0, 60)
      : `Tailored Resume ${index + 1}`

  const merged = normalizeParsedResume({
    ...parsedResume,
    ...tailored,
    contact: { ...parsedResume.contact, ...(tailored.contact || {}) },
  })

  return {
    tailored: merged,
    targetRole,
    roleSlug: slugifyRole(targetRole) || `tailored-resume-${index + 1}`,
  }
}

function normalizeParsedResume(input) {
  const safe = input && typeof input === 'object' ? input : {}
  const contact = safe.contact && typeof safe.contact === 'object' ? safe.contact : {}
  const allowedSections = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications']

  const sectionOrder = Array.isArray(safe.sectionOrder)
    ? safe.sectionOrder.filter((key) => allowedSections.includes(key))
    : ['summary', 'skills', 'experience', 'projects', 'education', 'certifications']

  return {
    contact: {
      name: stringOrEmpty(contact.name),
      title: stringOrNull(contact.title),
      email: stringOrNull(contact.email),
      phone: stringOrNull(contact.phone),
      location: stringOrNull(contact.location),
      links: Array.isArray(contact.links)
        ? contact.links
            .filter((link) => link && (link.url || link.label))
            .map((link) => ({
              label: stringOrEmpty(link.label) || stringOrEmpty(link.url),
              url: stringOrEmpty(link.url),
            }))
        : [],
    },
    summary: stringOrNull(safe.summary),
    skills: Array.isArray(safe.skills) ? safe.skills.filter(Boolean).map((s) => String(s).trim()) : [],
    experience: Array.isArray(safe.experience)
      ? safe.experience.map((entry) => ({
          company: stringOrEmpty(entry?.company),
          role: stringOrEmpty(entry?.role),
          location: stringOrNull(entry?.location),
          start: stringOrNull(entry?.start),
          end: stringOrNull(entry?.end),
          bullets: Array.isArray(entry?.bullets)
            ? entry.bullets.filter(Boolean).map((b) => String(b).trim()).filter(Boolean)
            : [],
        }))
      : [],
    projects: Array.isArray(safe.projects)
      ? safe.projects.map((entry) => ({
          name: stringOrEmpty(entry?.name),
          role: stringOrNull(entry?.role),
          period: stringOrNull(entry?.period),
          bullets: Array.isArray(entry?.bullets)
            ? entry.bullets.filter(Boolean).map((b) => String(b).trim()).filter(Boolean)
            : [],
        }))
      : [],
    education: Array.isArray(safe.education)
      ? safe.education.map((entry) => ({
          school: stringOrEmpty(entry?.school),
          degree: stringOrNull(entry?.degree),
          period: stringOrNull(entry?.period),
          details: stringOrNull(entry?.details),
        }))
      : [],
    certifications: Array.isArray(safe.certifications)
      ? safe.certifications.filter(Boolean).map((c) => String(c).trim())
      : [],
    sectionOrder,
  }
}

function stringOrEmpty(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function stringOrNull(value) {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed ? trimmed : null
}

function slugifyRole(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

module.exports = {
  extractResumeText,
  parseResumeWithAI,
  tailorResumeForJob,
  getResumeTailorModel,
  slugifyRole,
}
