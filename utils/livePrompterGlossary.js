/**
 * Fuzzy glossary correction for Live Prompter transcripts (names, brands, etc.).
 */

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) row[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

function capitalizeLike(original, replacement) {
  if (!replacement) return replacement;
  if (/^[A-Z]/.test(original) && /^[a-z]/.test(replacement)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  return replacement;
}

/**
 * Replace word-sized tokens that are close Levenshtein matches to glossary terms.
 * @param {string} text
 * @param {string[]} terms
 * @returns {string}
 */
function applyFuzzyGlossary(text, terms) {
  const list = (terms || [])
    .map((t) => String(t).trim())
    .filter((t) => t.length >= 2)
    .slice(0, 200);
  if (!list.length || !text) return text;

  return text.replace(/[A-Za-z0-9']+/g, (word) => {
    const core = word.replace(/^'+|'+$/g, '');
    if (core.length < 3) return word;
    const lower = core.toLowerCase();
    for (const term of list) {
      const tl = term.toLowerCase();
      if (lower === tl) return capitalizeLike(word, term);
      const maxLen = Math.max(lower.length, tl.length);
      if (maxLen < 4) continue;
      const d = levenshtein(lower, tl);
      if (d <= 2 && d <= maxLen * 0.45) {
        return capitalizeLike(word, term);
      }
    }
    return word;
  });
}

module.exports = {
  applyFuzzyGlossary,
  levenshtein
};
