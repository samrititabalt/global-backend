/**
 * Resume DOCX builder.
 *
 * Builds a Word (.docx) document from a structured ParsedResume / TailoredResume JSON.
 * The output aims for:
 *   - One A4 page when content fits (we tighten margins, line spacing, and font size).
 *   - Visual identity inherited from style hints extracted from the uploaded resume
 *     (font family + accent colour). When an exact match isn't possible we degrade
 *     gracefully to a clean Calibri/dark-navy default.
 *   - Section ordering preserved from the original resume's "sectionOrder" field.
 *
 * This is intentionally template-driven (not template-cloning): the first version of
 * the feature ships a deterministic, professional rebuild rather than a fragile
 * style-clone of arbitrary uploads.
 */

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  convertInchesToTwip,
} = require('docx')

const SECTION_TITLES = {
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
}

function pickFontFamily(font) {
  const allow = ['Calibri', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Garamond', 'Cambria']
  return allow.includes(font) ? font : 'Calibri'
}

function hexNoHash(hex, fallback = '0F172A') {
  if (!hex) return fallback
  const clean = String(hex).replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(clean) ? clean.toUpperCase() : fallback
}

/**
 * @param {object} resume - structured resume JSON
 * @param {object} options - { styleHints }
 * @returns {Promise<Buffer>}
 */
async function buildResumeDocx(resume, options = {}) {
  const styleHints = options.styleHints || {}
  const font = pickFontFamily(styleHints.font || 'Calibri')
  const baseSize = Number(styleHints.baseFontSize) || 10.5
  const baseHalfPoints = Math.round(baseSize * 2)
  const accent = hexNoHash(styleHints.accentColor, '0F172A')
  const muted = '475569'

  const children = []
  children.push(...buildHeader(resume, { font, accent, baseHalfPoints }))

  const order =
    Array.isArray(resume.sectionOrder) && resume.sectionOrder.length > 0
      ? resume.sectionOrder
      : ['summary', 'skills', 'experience', 'projects', 'education', 'certifications']

  for (const key of order) {
    const block = renderSection(key, resume, { font, accent, baseHalfPoints, muted })
    if (block && block.length) {
      children.push(...block)
    }
  }

  const document = new Document({
    creator: 'Tabalt Resume Tailoring Studio',
    title: `Tailored Resume — ${resume?.contact?.name || 'Candidate'}`,
    styles: {
      default: {
        document: {
          run: { font, size: baseHalfPoints, color: '0F172A' },
          paragraph: { spacing: { line: 264 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.5),
              right: convertInchesToTwip(0.5),
              bottom: convertInchesToTwip(0.5),
              left: convertInchesToTwip(0.5),
            },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBuffer(document)
}

function buildHeader(resume, { font, accent, baseHalfPoints }) {
  const contact = resume?.contact || {}
  const out = []

  if (contact.name) {
    out.push(
      new Paragraph({
        spacing: { before: 0, after: 40 },
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun({
            text: contact.name,
            bold: true,
            size: baseHalfPoints + 8, // ~14.5pt
            color: accent,
            font,
          }),
        ],
      })
    )
  }

  if (contact.title) {
    out.push(
      new Paragraph({
        spacing: { before: 0, after: 40 },
        children: [
          new TextRun({
            text: contact.title,
            italics: true,
            size: baseHalfPoints,
            color: '475569',
            font,
          }),
        ],
      })
    )
  }

  const contactParts = []
  if (contact.location) contactParts.push(contact.location)
  if (contact.phone) contactParts.push(contact.phone)
  if (contact.email) contactParts.push(contact.email)

  if (contactParts.length) {
    out.push(
      new Paragraph({
        spacing: { before: 0, after: 60 },
        children: [
          new TextRun({
            text: contactParts.join('  ·  '),
            size: baseHalfPoints - 1,
            color: '334155',
            font,
          }),
        ],
      })
    )
  }

  if (Array.isArray(contact.links) && contact.links.length) {
    const linkRuns = []
    contact.links.forEach((link, idx) => {
      if (idx > 0) {
        linkRuns.push(
          new TextRun({ text: '  ·  ', size: baseHalfPoints - 1, color: '94a3b8', font })
        )
      }
      const text = link.label || link.url
      if (link.url) {
        linkRuns.push(
          new ExternalHyperlink({
            link: link.url,
            children: [
              new TextRun({
                text,
                size: baseHalfPoints - 1,
                color: accent,
                underline: {},
                font,
              }),
            ],
          })
        )
      } else if (text) {
        linkRuns.push(
          new TextRun({ text, size: baseHalfPoints - 1, color: '334155', font })
        )
      }
    })
    if (linkRuns.length) {
      out.push(
        new Paragraph({
          spacing: { before: 0, after: 100 },
          children: linkRuns,
        })
      )
    }
  }

  out.push(buildHorizontalRule(accent))

  return out
}

function buildHorizontalRule(accent) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    border: {
      bottom: { color: accent, space: 1, style: BorderStyle.SINGLE, size: 6 },
    },
    children: [new TextRun({ text: '' })],
  })
}

function sectionHeading(label, { font, accent, baseHalfPoints }) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 140, after: 60 },
    children: [
      new TextRun({
        text: String(label).toUpperCase(),
        bold: true,
        size: baseHalfPoints + 1,
        color: accent,
        font,
        characterSpacing: 24,
      }),
    ],
  })
}

function renderSection(key, resume, ctx) {
  switch (key) {
    case 'summary':
      return resume.summary ? renderSummary(resume.summary, ctx) : []
    case 'skills':
      return Array.isArray(resume.skills) && resume.skills.length ? renderSkills(resume.skills, ctx) : []
    case 'experience':
      return Array.isArray(resume.experience) && resume.experience.length
        ? renderExperience(resume.experience, ctx)
        : []
    case 'projects':
      return Array.isArray(resume.projects) && resume.projects.length
        ? renderProjects(resume.projects, ctx)
        : []
    case 'education':
      return Array.isArray(resume.education) && resume.education.length
        ? renderEducation(resume.education, ctx)
        : []
    case 'certifications':
      return Array.isArray(resume.certifications) && resume.certifications.length
        ? renderCertifications(resume.certifications, ctx)
        : []
    default:
      return []
  }
}

function renderSummary(summary, ctx) {
  return [
    sectionHeading(SECTION_TITLES.summary, ctx),
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: summary,
          size: ctx.baseHalfPoints,
          color: '0F172A',
          font: ctx.font,
        }),
      ],
    }),
  ]
}

function renderSkills(skills, ctx) {
  const text = skills.join('  ·  ')
  return [
    sectionHeading(SECTION_TITLES.skills, ctx),
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text,
          size: ctx.baseHalfPoints,
          color: '0F172A',
          font: ctx.font,
        }),
      ],
    }),
  ]
}

function renderExperience(experience, ctx) {
  const out = [sectionHeading(SECTION_TITLES.experience, ctx)]
  experience.forEach((entry, idx) => {
    const dateRange = formatDateRange(entry.start, entry.end)
    const titleLine = [entry.role, entry.company].filter(Boolean).join(' — ')

    out.push(
      new Paragraph({
        spacing: { before: idx === 0 ? 40 : 80, after: 20 },
        children: [
          new TextRun({
            text: titleLine,
            bold: true,
            size: ctx.baseHalfPoints,
            color: '0F172A',
            font: ctx.font,
          }),
          ...(dateRange || entry.location
            ? [
                new TextRun({ text: '   ', font: ctx.font }),
                new TextRun({
                  text: [dateRange, entry.location].filter(Boolean).join('  ·  '),
                  italics: true,
                  size: ctx.baseHalfPoints - 1,
                  color: ctx.muted,
                  font: ctx.font,
                }),
              ]
            : []),
        ],
      })
    )

    entry.bullets.forEach((bullet) => {
      out.push(
        new Paragraph({
          spacing: { before: 0, after: 20 },
          indent: { left: 200, hanging: 200 },
          children: [
            new TextRun({
              text: '• ',
              size: ctx.baseHalfPoints,
              color: '0F172A',
              font: ctx.font,
            }),
            new TextRun({
              text: bullet,
              size: ctx.baseHalfPoints,
              color: '0F172A',
              font: ctx.font,
            }),
          ],
        })
      )
    })
  })
  return out
}

function renderProjects(projects, ctx) {
  const out = [sectionHeading(SECTION_TITLES.projects, ctx)]
  projects.forEach((entry, idx) => {
    const headParts = [entry.name]
    if (entry.role) headParts.push(entry.role)

    out.push(
      new Paragraph({
        spacing: { before: idx === 0 ? 40 : 80, after: 20 },
        children: [
          new TextRun({
            text: headParts.filter(Boolean).join(' — '),
            bold: true,
            size: ctx.baseHalfPoints,
            color: '0F172A',
            font: ctx.font,
          }),
          ...(entry.period
            ? [
                new TextRun({ text: '   ', font: ctx.font }),
                new TextRun({
                  text: entry.period,
                  italics: true,
                  size: ctx.baseHalfPoints - 1,
                  color: ctx.muted,
                  font: ctx.font,
                }),
              ]
            : []),
        ],
      })
    )

    entry.bullets.forEach((bullet) => {
      out.push(
        new Paragraph({
          spacing: { before: 0, after: 20 },
          indent: { left: 200, hanging: 200 },
          children: [
            new TextRun({
              text: '• ',
              size: ctx.baseHalfPoints,
              color: '0F172A',
              font: ctx.font,
            }),
            new TextRun({
              text: bullet,
              size: ctx.baseHalfPoints,
              color: '0F172A',
              font: ctx.font,
            }),
          ],
        })
      )
    })
  })
  return out
}

function renderEducation(education, ctx) {
  const out = [sectionHeading(SECTION_TITLES.education, ctx)]
  education.forEach((entry, idx) => {
    out.push(
      new Paragraph({
        spacing: { before: idx === 0 ? 40 : 60, after: 20 },
        children: [
          new TextRun({
            text: [entry.degree, entry.school].filter(Boolean).join(' — '),
            bold: true,
            size: ctx.baseHalfPoints,
            color: '0F172A',
            font: ctx.font,
          }),
          ...(entry.period
            ? [
                new TextRun({ text: '   ', font: ctx.font }),
                new TextRun({
                  text: entry.period,
                  italics: true,
                  size: ctx.baseHalfPoints - 1,
                  color: ctx.muted,
                  font: ctx.font,
                }),
              ]
            : []),
        ],
      })
    )
    if (entry.details) {
      out.push(
        new Paragraph({
          spacing: { after: 20 },
          children: [
            new TextRun({
              text: entry.details,
              size: ctx.baseHalfPoints,
              color: '0F172A',
              font: ctx.font,
            }),
          ],
        })
      )
    }
  })
  return out
}

function renderCertifications(certifications, ctx) {
  return [
    sectionHeading(SECTION_TITLES.certifications, ctx),
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: certifications.join('  ·  '),
          size: ctx.baseHalfPoints,
          color: '0F172A',
          font: ctx.font,
        }),
      ],
    }),
  ]
}

function formatDateRange(start, end) {
  if (!start && !end) return null
  if (start && end) return `${start} – ${end}`
  return start || end
}

module.exports = {
  buildResumeDocx,
}
