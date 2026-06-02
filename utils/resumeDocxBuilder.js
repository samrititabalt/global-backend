/**
 * Resume DOCX builder.
 *
 * Builds a Word (.docx) document from a structured ParsedResume / TailoredResume JSON.
 * The output aims to visually mirror common professional resume layouts:
 *   - Centred header (name, subtitle, contact line, links).
 *   - Coloured section rules under each heading.
 *   - Skills as a 4-column shaded table (with category headers when available).
 *   - Experience / project entries with right-aligned dates via tab stops.
 *   - One A4 page when the content fits; tight margins, 10.5pt base font.
 *   - Visual identity (font family + accent colour) inherited from the upload's style hints
 *     when extractable, with a clean Calibri/dark-navy default fallback.
 */

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  TabStopType,
  TabStopPosition,
  convertInchesToTwip,
} = require('docx')

const SECTION_TITLES = {
  summary: 'Profile',
  skills: 'Core Competencies',
  experience: 'Professional Experience',
  projects: 'Key Projects',
  education: 'Education',
  certifications: 'Certifications',
}

const ALLOWED_FONTS = [
  'Calibri',
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Garamond',
  'Cambria',
]

function pickFontFamily(font) {
  return ALLOWED_FONTS.includes(font) ? font : 'Calibri'
}

function hexNoHash(hex, fallback = '0F172A') {
  if (!hex) return fallback
  const clean = String(hex).replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(clean) ? clean.toUpperCase() : fallback
}

/** Lighten a 6-char hex colour by `amount` (0..1). 0 = original, 1 = white. */
function lightenHex(hexNo, amount) {
  const clean = String(hexNo || '').replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 'F2F7FF'
  const a = Math.max(0, Math.min(1, amount))
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const lr = Math.round(r + (255 - r) * a)
  const lg = Math.round(g + (255 - g) * a)
  const lb = Math.round(b + (255 - b) * a)
  return [lr, lg, lb]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
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

  const ctx = {
    font,
    accent,
    baseHalfPoints,
    muted: '475569',
    headerFill: lightenHex(accent, 0.85),
    cellFill: lightenHex(accent, 0.93),
  }

  const children = []
  children.push(...buildHeader(resume, ctx))

  const order =
    Array.isArray(resume.sectionOrder) && resume.sectionOrder.length > 0
      ? resume.sectionOrder
      : ['summary', 'skills', 'experience', 'projects', 'education', 'certifications']

  for (const key of order) {
    const block = renderSection(key, resume, ctx)
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
              right: convertInchesToTwip(0.55),
              bottom: convertInchesToTwip(0.5),
              left: convertInchesToTwip(0.55),
            },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBuffer(document)
}

function buildHeader(resume, ctx) {
  const contact = resume?.contact || {}
  const out = []

  if (contact.name) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 40 },
        children: [
          new TextRun({
            text: contact.name.toUpperCase(),
            bold: true,
            size: ctx.baseHalfPoints + 14, // ~17.5pt
            color: ctx.accent,
            font: ctx.font,
            characterSpacing: 30,
          }),
        ],
      })
    )
  }

  if (contact.title) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 40 },
        children: [
          new TextRun({
            text: contact.title,
            italics: true,
            size: ctx.baseHalfPoints,
            color: ctx.muted,
            font: ctx.font,
          }),
        ],
      })
    )
  }

  const contactLineParts = []
  if (contact.location) contactLineParts.push(contact.location)
  if (contact.phone) contactLineParts.push(contact.phone)
  if (contact.email) contactLineParts.push(contact.email)
  if (Array.isArray(contact.links)) {
    contact.links.forEach((link) => {
      const text = link.label || link.url
      if (text) contactLineParts.push(text)
    })
  }

  if (contactLineParts.length) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 80 },
        children: [
          new TextRun({
            text: contactLineParts.join('  •  '),
            size: ctx.baseHalfPoints - 1,
            color: '334155',
            font: ctx.font,
          }),
        ],
      })
    )
  }

  return out
}

function sectionHeading(label, ctx) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 180, after: 60 },
    border: {
      bottom: { color: ctx.accent, space: 4, style: BorderStyle.SINGLE, size: 6 },
    },
    children: [
      new TextRun({
        text: String(label).toUpperCase(),
        bold: true,
        size: ctx.baseHalfPoints + 1,
        color: ctx.accent,
        font: ctx.font,
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
      return Array.isArray(resume.skills) && resume.skills.length
        ? renderSkills(resume.skills, ctx)
        : []
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
      alignment: AlignmentType.JUSTIFIED,
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

/**
 * Skills can arrive as either:
 *   - string[]                                (flat)
 *   - { category: string, items: string[] }[] (grouped)
 * We render either as a 4-column shaded table with optional category header row.
 */
function renderSkills(skills, ctx) {
  const isGrouped =
    Array.isArray(skills) &&
    skills.length > 0 &&
    typeof skills[0] === 'object' &&
    skills[0] !== null &&
    Array.isArray(skills[0].items)

  let columns
  if (isGrouped) {
    columns = skills
      .filter((g) => g && Array.isArray(g.items))
      .map((g) => ({
        header: String(g.category || '').trim(),
        items: g.items
          .filter(Boolean)
          .map((i) => String(i).trim())
          .filter(Boolean),
      }))
      .filter((c) => c.items.length > 0)
      .slice(0, 4)
  } else {
    const flat = skills
      .filter(Boolean)
      .map((s) => String(s).trim())
      .filter(Boolean)
    if (flat.length === 0) return []
    const cols = Math.min(4, Math.max(2, Math.ceil(flat.length / 4)))
    const perCol = Math.ceil(flat.length / cols)
    columns = Array.from({ length: cols }, (_, c) => ({
      header: '',
      items: flat.slice(c * perCol, (c + 1) * perCol),
    })).filter((c) => c.items.length > 0)
  }

  if (!columns.length) return []

  const hasHeaders = columns.some((c) => c.header)
  const maxItems = Math.max(...columns.map((c) => c.items.length))
  const colWidth = 100 / columns.length

  const rows = []
  if (hasHeaders) {
    rows.push(
      new TableRow({
        tableHeader: true,
        children: columns.map(
          (c) =>
            new TableCell({
              width: { size: colWidth, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.SOLID, color: 'auto', fill: ctx.headerFill },
              margins: { top: 80, bottom: 80, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 0, after: 0 },
                  children: [
                    new TextRun({
                      text: c.header,
                      bold: true,
                      color: ctx.accent,
                      font: ctx.font,
                      size: ctx.baseHalfPoints,
                    }),
                  ],
                }),
              ],
            })
        ),
      })
    )
  }

  for (let r = 0; r < maxItems; r += 1) {
    rows.push(
      new TableRow({
        children: columns.map(
          (c) =>
            new TableCell({
              width: { size: colWidth, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.SOLID, color: 'auto', fill: ctx.cellFill },
              margins: { top: 40, bottom: 40, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 0, after: 0 },
                  children: [
                    new TextRun({
                      text: c.items[r] || '',
                      size: ctx.baseHalfPoints - 1,
                      color: '0F172A',
                      font: ctx.font,
                    }),
                  ],
                }),
              ],
            })
        ),
      })
    )
  }

  const table = new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'FFFFFF' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'FFFFFF' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'FFFFFF' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'FFFFFF' },
    },
  })

  return [
    sectionHeading(SECTION_TITLES.skills, ctx),
    table,
    new Paragraph({ spacing: { before: 0, after: 80 }, children: [new TextRun({ text: '' })] }),
  ]
}

function rightAlignedTitleParagraph({ leftRuns, rightText, ctx, before, after }) {
  const children = [...leftRuns]
  if (rightText) {
    children.push(new TextRun({ text: '\t', font: ctx.font }))
    children.push(
      new TextRun({
        text: rightText,
        italics: true,
        size: ctx.baseHalfPoints - 1,
        color: ctx.muted,
        font: ctx.font,
      })
    )
  }
  return new Paragraph({
    spacing: { before, after },
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    children,
  })
}

function renderExperience(experience, ctx) {
  const out = [sectionHeading(SECTION_TITLES.experience, ctx)]

  experience.forEach((entry, idx) => {
    const dateRange = formatDateRange(entry.start, entry.end)
    const titleLine = entry.role || ''
    const company = entry.company || ''
    const meta = [dateRange, entry.location].filter(Boolean).join('  ·  ')

    out.push(
      rightAlignedTitleParagraph({
        before: idx === 0 ? 60 : 100,
        after: 20,
        ctx,
        leftRuns: [
          new TextRun({
            text: titleLine,
            bold: true,
            size: ctx.baseHalfPoints,
            color: ctx.accent,
            font: ctx.font,
          }),
          ...(company
            ? [
                new TextRun({
                  text: '  |  ',
                  size: ctx.baseHalfPoints,
                  color: ctx.muted,
                  font: ctx.font,
                }),
                new TextRun({
                  text: company,
                  bold: true,
                  size: ctx.baseHalfPoints,
                  color: '0F172A',
                  font: ctx.font,
                }),
              ]
            : []),
        ],
        rightText: meta || null,
      })
    )

    entry.bullets.forEach((bullet) => {
      out.push(
        new Paragraph({
          spacing: { before: 0, after: 20 },
          indent: { left: 220, hanging: 220 },
          children: [
            new TextRun({
              text: '• ',
              size: ctx.baseHalfPoints,
              color: ctx.accent,
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
    const head = [entry.name, entry.role].filter(Boolean).join(' — ')

    out.push(
      rightAlignedTitleParagraph({
        before: idx === 0 ? 60 : 100,
        after: 20,
        ctx,
        leftRuns: [
          new TextRun({
            text: head,
            bold: true,
            size: ctx.baseHalfPoints,
            color: ctx.accent,
            font: ctx.font,
          }),
        ],
        rightText: entry.period || null,
      })
    )

    entry.bullets.forEach((bullet) => {
      out.push(
        new Paragraph({
          spacing: { before: 0, after: 20 },
          indent: { left: 220, hanging: 220 },
          children: [
            new TextRun({
              text: '• ',
              size: ctx.baseHalfPoints,
              color: ctx.accent,
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
    const head = [entry.degree, entry.school].filter(Boolean).join(' — ')

    out.push(
      rightAlignedTitleParagraph({
        before: idx === 0 ? 60 : 80,
        after: 20,
        ctx,
        leftRuns: [
          new TextRun({
            text: head,
            bold: true,
            size: ctx.baseHalfPoints,
            color: ctx.accent,
            font: ctx.font,
          }),
        ],
        rightText: entry.period || null,
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
      alignment: AlignmentType.CENTER,
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
