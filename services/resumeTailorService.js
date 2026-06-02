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
 *   - The model defaults to gpt-5 because resume tailoring benefits from a reasoning-class
 *     model. It can be overridden via env var:
 *       OPENAI_RESUME_TAILOR_MODEL || 'gpt-5'
 *     Switching model later = config change only, no code change.
 *   - For reasoning models (gpt-5*, o1*, o3*, o4*) we automatically swap `max_tokens` for
 *     `max_completion_tokens` and drop `temperature`, since those models reject the legacy
 *     params.
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
  "skills": string[]
            | { "category": string, "items": string[] }[],
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
- For "skills": if the source resume groups skills under category headings (e.g. "Sales & BD",
  "Technical Skills", "Cloud Platforms"), return them as a categorised array:
    [{ "category": "Sales & BD", "items": ["Net New Business Dev", "Pipeline Generation"] }, ...]
  If the source lists skills as a single flat block, return a flat string[] instead.
  Prefer 3–4 categories with 3–6 items each when categorisation is reasonable.
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
- Preserve the original "skills" structure: if ORIGINAL_RESUME has categorised skills
  ([{category, items}]), keep the same categories and only re-order/swap items inside them
  to better fit the JD. If ORIGINAL_RESUME has flat skills (string[]), return flat skills.
  Do not add new skill categories that did not exist in the source.
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
  return process.env.OPENAI_RESUME_TAILOR_MODEL || 'gpt-5'
}

function isReasoningModel(model) {
  const m = String(model || '').toLowerCase()
  if (m.startsWith('gpt-5-chat')) return false // gpt-5-chat-latest accepts legacy params
  if (m.startsWith('gpt-5')) return true
  if (m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return true
  return false
}

function sanitizeOpenAIError(error) {
  const status = error?.status || error?.response?.status
  const code = error?.code || error?.type

  if (status === 401 || code === 'invalid_api_key' || /api key/i.test(error?.message || '')) {
    return new Error('OpenAI rejected the configured API key. Please check OPENAI_API_KEY in Render.')
  }

  if (status === 429) {
    return new Error('OpenAI rate limit reached. Please wait a minute and try again.')
  }

  if (status >= 500) {
    return new Error('OpenAI is temporarily unavailable. Please try again shortly.')
  }

  return new Error(error?.message || 'OpenAI request failed.')
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
  const reasoning = isReasoningModel(model)

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }

  if (reasoning) {
    // gpt-5 / o-series: reasoning tokens count toward the budget, so be generous.
    requestBody.max_completion_tokens = Math.max(maxTokens * 2, 4000)
    // temperature, top_p, presence_penalty, frequency_penalty are all rejected; omit them.
  } else {
    requestBody.max_tokens = maxTokens
    requestBody.temperature = temperature
  }

  if (/gpt-4o|gpt-4-turbo|gpt-4\.1|gpt-5/i.test(model)) {
    requestBody.response_format = { type: 'json_object' }
  }

  let completion
  try {
    completion = await client.chat.completions.create(requestBody)
  } catch (error) {
    throw sanitizeOpenAIError(error)
  }

  const raw = completion.choices?.[0]?.message?.content?.trim() || ''
  const parsed = safeJsonParse(raw)
  if (!parsed) throw new Error('AI returned a non-JSON or empty response.')
  return parsed
}

/**
 * Convert raw resume text into a structured ParsedResume JSON.
 */
async function parseResumeWithAI(rawText) {
  const userPrompt = `Raw resume text:\n\n${rawText.slice(0, 18000)}`
  try {
    const parsed = await callJsonCompletion({
      system: RESUME_PARSE_SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 3600,
      temperature: 0.1,
    })
    return normalizeParsedResume(parsed, rawText)
  } catch (error) {
    console.warn('[ResumeTailor] AI resume parsing failed; using deterministic fallback parser:', error?.message)
    return buildParsedResumeFallback(rawText)
  }
}

/**
 * Tailor a parsed resume to a single job description.
 * Returns { tailored, targetRole, roleSlug }.
 */
async function tailorResumeForJob({ parsedResume, jobDescription, index }) {
  const trimmedJd = String(jobDescription || '').slice(0, 12000)

  const userPrompt = `ORIGINAL_RESUME:
${JSON.stringify(parsedResume)}

ORIGINAL_RESUME_RAW_TEXT:
${String(parsedResume.sourceText || '').slice(0, 18000)}

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

function normalizeParsedResume(input, sourceText = '') {
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
    skills: normalizeSkills(safe.skills),
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
    sourceText: stringOrEmpty(sourceText || safe.sourceText),
  }
}

function buildParsedResumeFallback(rawText) {
  const text = stringOrEmpty(rawText)
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const contact = extractFallbackContact(lines)
  const sections = splitResumeIntoSections(lines)

  const skillsText = sections.skills.join(' ')
  const skills = skillsText
    .split(/[,|•·;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 1)
    .slice(0, 30)

  const summary = sections.summary.length
    ? sections.summary.join(' ').slice(0, 900)
    : lines.slice(1, 5).join(' ').slice(0, 900) || null

  const experienceBullets = sections.experience.length
    ? sections.experience
    : lines.filter((line) => /^[•\-*–]\s+/.test(line)).map((line) => line.replace(/^[•\-*–]\s+/, ''))

  const projects = sections.projects.length
    ? [
        {
          name: 'Projects',
          role: null,
          period: null,
          bullets: sections.projects.slice(0, 8),
        },
      ]
    : []

  const education = sections.education.length
    ? [
        {
          school: sections.education[0],
          degree: sections.education.slice(1).join(' ') || null,
          period: null,
          details: null,
        },
      ]
    : []

  const certifications = sections.certifications.slice(0, 12)

  const sectionOrder = []
  if (summary) sectionOrder.push('summary')
  if (skills.length) sectionOrder.push('skills')
  if (experienceBullets.length) sectionOrder.push('experience')
  if (projects.length) sectionOrder.push('projects')
  if (education.length) sectionOrder.push('education')
  if (certifications.length) sectionOrder.push('certifications')

  return normalizeParsedResume(
    {
      contact,
      summary,
      skills,
      experience: experienceBullets.length
        ? [
            {
              company: 'Experience',
              role: contact.title || 'Professional Experience',
              location: null,
              start: null,
              end: null,
              bullets: experienceBullets.slice(0, 16),
            },
          ]
        : [],
      projects,
      education,
      certifications,
      sectionOrder,
    },
    text
  )
}

function extractFallbackContact(lines) {
  const joined = lines.slice(0, 12).join(' | ')
  const email = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null
  const phone = joined.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || null
  const links = []
  const linkRegex = /(https?:\/\/[^\s|]+|(?:linkedin\.com|github\.com|portfolio\.|www\.)[^\s|]+)/gi
  let match
  while ((match = linkRegex.exec(joined))) {
    const url = match[0]
    links.push({ label: url, url: url.startsWith('http') ? url : `https://${url}` })
  }

  const name =
    lines.find((line) => {
      if (email && line.includes(email)) return false
      if (phone && line.includes(phone)) return false
      if (line.length > 80) return false
      return /[A-Za-z]/.test(line)
    }) || 'Candidate'

  const title =
    lines
      .slice(0, 8)
      .find((line) => line !== name && !line.includes('@') && line.length <= 90) || null

  return {
    name,
    title,
    email,
    phone,
    location: null,
    links,
  }
}

function splitResumeIntoSections(lines) {
  const sections = {
    summary: [],
    skills: [],
    experience: [],
    projects: [],
    education: [],
    certifications: [],
  }
  let current = 'summary'

  const headingToSection = (line) => {
    const normal = line.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
    if (/^(profile|summary|professional summary|career summary|about)$/.test(normal)) return 'summary'
    if (/^(skills|technical skills|core skills|key skills|competencies)$/.test(normal)) return 'skills'
    if (/^(experience|work experience|professional experience|employment history|career history)$/.test(normal)) return 'experience'
    if (/^(projects|key projects|project experience)$/.test(normal)) return 'projects'
    if (/^(education|academic|academics|qualifications)$/.test(normal)) return 'education'
    if (/^(certifications|certificates|licenses|licences)$/.test(normal)) return 'certifications'
    return null
  }

  lines.forEach((line) => {
    const nextSection = headingToSection(line)
    if (nextSection) {
      current = nextSection
      return
    }

    if (!sections[current]) current = 'summary'
    sections[current].push(line.replace(/^[•\-*–]\s+/, '').trim())
  })

  return sections
}

function normalizeSkills(input) {
  if (!Array.isArray(input)) return []
  if (input.length === 0) return []

  const looksGrouped = input.some(
    (item) => item && typeof item === 'object' && !Array.isArray(item) && (item.items || item.category)
  )

  if (looksGrouped) {
    const groups = input
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const category = stringOrEmpty(item.category)
        const items = Array.isArray(item.items)
          ? item.items.filter(Boolean).map((x) => String(x).trim()).filter(Boolean)
          : []
        if (items.length === 0) return null
        return { category, items }
      })
      .filter(Boolean)
    if (groups.length > 0) return groups
  }

  return input.filter(Boolean).map((s) => String(s).trim()).filter(Boolean)
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
  buildParsedResumeFallback,
}
