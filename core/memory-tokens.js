/**
 * Query keywords for memory retrieval.
 *
 * The first cut split on `\W+`, which in JavaScript means "anything outside
 * [A-Za-z0-9_]" — every Chinese character counted as a separator, so a
 * Chinese-only query produced no keywords at all and retrieval degraded to
 * "whatever scores a type bonus". Latin text still splits into words; runs of
 * Han/Kana/Hangul have no spaces to split on, so they become overlapping
 * bigrams (a lone character is kept only when it is all the query has).
 */

const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const CJK_RUN = new RegExp(`[${CJK}]+`, "gu");
const WORD_RUN = new RegExp(`[\\p{L}\\p{N}_]+`, "gu");
const CJK_CHAR = new RegExp(`[${CJK}]`, "u");

/** Latin-style words shorter than this are noise ("a", "of", "to"). */
const MIN_WORD_LENGTH = 3;

/**
 * @param {string} query
 * @returns {string[]} lower-cased, de-duplicated keywords
 */
export function queryTokens(query) {
  const text = String(query || "").toLowerCase();
  const tokens = new Set();
  // Lone characters between other words ("用", "做") are mostly function words.
  // They only count when nothing else in the query gave a keyword.
  const loneChars = new Set();

  for (const run of text.match(CJK_RUN) || []) {
    const chars = [...run];
    if (chars.length === 1) {
      loneChars.add(chars[0]);
      continue;
    }
    for (let i = 0; i < chars.length - 1; i++) tokens.add(chars[i] + chars[i + 1]);
  }

  for (const word of text.match(WORD_RUN) || []) {
    // A run like "rag检索" is one \p{L} run; its CJK part is already handled.
    for (const part of word.split(new RegExp(`[${CJK}]+`, "u"))) {
      if (part && !CJK_CHAR.test(part) && [...part].length >= MIN_WORD_LENGTH) tokens.add(part);
    }
  }

  return [...(tokens.size ? tokens : loneChars)];
}
