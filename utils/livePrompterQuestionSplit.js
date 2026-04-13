/**
 * Split a paused transcript into multiple questions when markers exist; otherwise caller uses full string.
 */

const QUESTION_LEADIN =
  /\b(what|why|how|when|where|who|which|tell\s+me|can\s+you|could\s+you|would\s+you|will\s+you|do\s+you|did\s+you|have\s+you|had\s+you|are\s+you|is\s+there|may\s+i\s+ask|walk\s+(?:me|us)\s+through|explain|describe)\b/i;

function looksLikeQuestionPhrase(s) {
  const x = s.replace(/\?\s*$/, '').trim();
  if (x.length < 6) return false;
  if (/\?\s*$/.test(s)) return true;
  return QUESTION_LEADIN.test(x);
}

function splitAndJoinedQuestions(chunk) {
  const pattern =
    /\s+and\s+(?=(?:what|why|how|when|where|who|which|tell\s+me|can\s+you|could\s+you|would\s+you|do\s+you|did\s+you|have\s+you|may\s+i\s+ask|walk\s+(?:me|us)\s+through|explain|describe)\b)/gi;
  const matches = [...chunk.matchAll(pattern)];
  if (matches.length === 0) return [chunk];
  const parts = [];
  let start = 0;
  for (const m of matches) {
    parts.push(chunk.slice(start, m.index).trim());
    start = m.index + m[0].length;
  }
  parts.push(chunk.slice(start).trim());
  return parts.filter(Boolean);
}

function normalizeQuestionKey(q) {
  return q.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 240);
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function extractQuestionsFromPausedTranscript(raw) {
  const t = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 3) return [];

  const out = [];
  const seen = new Set();

  const pushQ = (q) => {
    const trimmed = q.trim();
    if (trimmed.length < 4) return;
    const k = normalizeQuestionKey(trimmed);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(trimmed);
  };

  if (/\?/.test(t)) {
    const pieces = t.match(/[^?]+\?/g) || [];
    for (const piece of pieces) {
      const inner = piece.replace(/\?\s*$/, '').trim();
      const subs = splitAndJoinedQuestions(inner);
      for (const sub of subs) {
        const withQ = sub.endsWith('?') ? sub : `${sub}?`;
        pushQ(withQ);
      }
    }
    return out;
  }

  const subs = splitAndJoinedQuestions(t);
  if (subs.length > 1) {
    for (const sub of subs) {
      if (looksLikeQuestionPhrase(sub)) pushQ(sub);
    }
  } else if (looksLikeQuestionPhrase(t)) {
    pushQ(t);
  }

  return out;
}

module.exports = {
  extractQuestionsFromPausedTranscript,
  looksLikeQuestionPhrase
};
