const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const JSZip = require('jszip');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { getOpenAIClient } = require('./openaiService'); // whisper uses same client

const MAX_DOC_CHARS = 24000;

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
 * @returns {Promise<string>}
 */
async function extractDocumentText(buffer, mimeType) {
  if (!buffer || !buffer.length) return '';
  const mime = mimeType || '';
  try {
    if (mime === 'application/pdf') {
      const data = await pdfParse(buffer);
      return (data?.text || '').slice(0, MAX_DOC_CHARS).trim();
    }
    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/msword'
    ) {
      const { value } = await mammoth.extractRawText({ buffer });
      return (value || '').slice(0, MAX_DOC_CHARS).trim();
    }
    if (mime === 'text/plain') {
      return buffer.toString('utf8').slice(0, MAX_DOC_CHARS).trim();
    }
    if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      return (await extractPptxText(buffer)).slice(0, MAX_DOC_CHARS).trim();
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
