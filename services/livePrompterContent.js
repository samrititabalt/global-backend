const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { getOpenAIClient } = require('./openaiService'); // whisper uses same client

const MAX_DOC_CHARS = 24000;

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
  transcribeAudioBuffer,
  MAX_DOC_CHARS
};
