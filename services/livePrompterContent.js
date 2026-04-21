const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const JSZip = require('jszip');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { getOpenAIClient } = require('./openaiService'); // whisper uses same client

const MAX_DOC_CHARS = 24000;
const MIN_TEXT_FOR_NO_OCR = 500;
const MAX_OCR_IMAGE_COUNT = 20;

function normalizeExtractedText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r/g, '\n')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, MAX_DOC_CHARS);
}

function shouldRunOcrForText(text) {
  const s = (text || '').trim();
  if (s.length < MIN_TEXT_FOR_NO_OCR) return true;
  const alphaNum = (s.match(/[A-Za-z0-9]/g) || []).length;
  return alphaNum / Math.max(s.length, 1) < 0.2;
}

function mergeExtractedText(primaryText, ocrText) {
  const primary = normalizeExtractedText(primaryText);
  const ocr = normalizeExtractedText(ocrText);
  if (!primary) return ocr;
  if (!ocr) return primary;
  if (primary.includes(ocr) || ocr.includes(primary)) {
    return normalizeExtractedText(primary.length >= ocr.length ? primary : ocr);
  }
  return normalizeExtractedText(`${primary}\n\n${ocr}`);
}

function extractTextFromOpenAIResponse(result) {
  if (!result) return '';
  if (typeof result.output_text === 'string' && result.output_text.trim()) {
    return result.output_text.trim();
  }
  if (Array.isArray(result.output)) {
    const chunks = [];
    for (const item of result.output) {
      const content = item?.content || [];
      for (const c of content) {
        const t = c?.text || c?.output_text;
        if (typeof t === 'string' && t.trim()) chunks.push(t.trim());
      }
    }
    if (chunks.length) return chunks.join('\n');
  }
  return '';
}

async function ocrImageWithOpenAI(imageBuffer, mimeType) {
  const client = getOpenAIClient();
  if (!client || !imageBuffer?.length) return '';
  const mime = mimeType || 'image/png';
  const dataUrl = `data:${mime};base64,${imageBuffer.toString('base64')}`;
  try {
    const out = await client.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Extract all visible text from this resume/document image with best effort OCR. Preserve job titles, company names, dates, skills, certifications, and project bullets. Return plain text only.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Run OCR and return only extracted text.' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    });
    return out?.choices?.[0]?.message?.content?.trim?.() || '';
  } catch (e) {
    console.error('[LivePrompter] Image OCR failed:', e.message);
    return '';
  }
}

async function ocrPdfWithOpenAI(buffer, fileName) {
  const client = getOpenAIClient();
  if (!client || !buffer?.length) return '';
  try {
    const result = await client.responses.create({
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Perform OCR on every page of this PDF. Return plain extracted text only. Preserve headings, companies, dates, skills, certifications, and project details.'
            },
            {
              type: 'input_file',
              filename: fileName || 'document.pdf',
              file_data: `data:application/pdf;base64,${buffer.toString('base64')}`
            }
          ]
        }
      ]
    });
    return extractTextFromOpenAIResponse(result);
  } catch (e) {
    console.error('[LivePrompter] PDF OCR failed:', e.message);
    return '';
  }
}

async function extractDocxEmbeddedImagesOcr(buffer) {
  if (!buffer?.length) return '';
  try {
    const zip = await JSZip.loadAsync(buffer);
    const imageNames = Object.keys(zip.files)
      .filter((name) => /^word\/media\//i.test(name))
      .slice(0, MAX_OCR_IMAGE_COUNT);
    if (!imageNames.length) return '';

    const chunks = [];
    for (const name of imageNames) {
      const file = zip.file(name);
      if (!file) continue;
      const img = await file.async('nodebuffer');
      const lower = name.toLowerCase();
      const mime =
        lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : lower.endsWith('.webp')
            ? 'image/webp'
            : 'image/png';
      const txt = await ocrImageWithOpenAI(img, mime);
      if (txt) chunks.push(txt);
    }
    return chunks.join('\n\n');
  } catch (e) {
    console.error('[LivePrompter] DOCX image OCR failed:', e.message);
    return '';
  }
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractPptxText(buffer) {
  if (!buffer?.length) return '';
  try {
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
      .sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return na - nb;
      });
    const chunks = [];
    for (const name of names) {
      const file = zip.file(name);
      if (!file) continue;
      const xml = await file.async('string');
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
      if (texts.length) chunks.push(texts.join(' '));
    }
    return chunks.join('\n').slice(0, MAX_DOC_CHARS).trim();
  } catch (e) {
    return `[Could not extract PPTX text: ${e.message}]`;
  }
}

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {{ enableOcr?: boolean, fileName?: string }} [options]
 * @returns {Promise<string>}
 */
async function extractDocumentText(buffer, mimeType, options = {}) {
  if (!buffer || !buffer.length) return '';
  const mime = mimeType || '';
  const enableOcr = !!options.enableOcr;
  const fileName = options.fileName || 'document';
  try {
    if (mime === 'application/pdf') {
      const data = await pdfParse(buffer);
      const baseText = normalizeExtractedText(data?.text || '');
      if (!enableOcr || !shouldRunOcrForText(baseText)) return baseText;
      const ocrText = await ocrPdfWithOpenAI(buffer, fileName);
      return mergeExtractedText(baseText, ocrText);
    }
    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/msword'
    ) {
      const { value } = await mammoth.extractRawText({ buffer });
      const baseText = normalizeExtractedText(value || '');
      if (!enableOcr) return baseText;
      const imageOcrText = await extractDocxEmbeddedImagesOcr(buffer);
      return mergeExtractedText(baseText, imageOcrText);
    }
    if (mime === 'text/plain') {
      return normalizeExtractedText(buffer.toString('utf8'));
    }
    if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      return normalizeExtractedText(await extractPptxText(buffer));
    }
    if (mime === 'application/vnd.ms-powerpoint') {
      return '[Legacy .ppt binary — export to PDF or PPTX for automatic text extraction; file is still stored.]';
    }
    return '';
  } catch (e) {
    return `[Could not extract text: ${e.message}]`;
  }
}

/**
 * @param {Buffer} buffer
 * @param {string} originalName
 * @returns {Promise<string>}
 */
async function transcribeAudioBuffer(buffer, originalName) {
  const client = getOpenAIClient();
  if (!client || !buffer?.length) return '';

  const safeName = (originalName || 'audio.webm').replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmp = path.join(os.tmpdir(), `live-prompter-${Date.now()}-${safeName}`);
  await fsp.writeFile(tmp, buffer);
  try {
    const stream = fs.createReadStream(tmp);
    const result = await client.audio.transcriptions.create({
      file: stream,
      model: process.env.OPENAI_WHISPER_MODEL || 'whisper-1'
    });
    return (result.text || '').trim();
  } catch (e) {
    console.error('[LivePrompter] Whisper transcription failed:', e.message);
    return '';
  } finally {
    await fsp.unlink(tmp).catch(() => {});
  }
}

module.exports = {
  extractDocumentText,
  extractPptxText,
  transcribeAudioBuffer,
  MAX_DOC_CHARS
};
