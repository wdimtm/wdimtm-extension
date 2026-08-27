/**
 * Pure helpers for bounded context rules.
 * Used by extraction and unit tests — keeps "never upload the whole DOM" enforceable.
 */

export const MAX_SELECTION = 4000;
export const MAX_CONTEXT = 2500;
export const NEIGHBOR_CHARS = 600;

/** @param {string} s */
export function normalizeWhitespace(s) {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} s
 * @param {number} max
 */
export function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * @param {string} text
 * @param {string} needle
 * @param {number} radius
 */
export function sliceAroundMatch(text, needle, radius) {
  const idx = text.indexOf(needle.slice(0, Math.min(needle.length, 80)));
  if (idx < 0) {
    return truncate(text, radius * 2);
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  let slice = text.slice(start, end);
  if (start > 0) slice = "…" + slice;
  if (end < text.length) slice = slice + "…";
  return slice;
}

/**
 * Assert a payload respects Phase 0 privacy bounds.
 * @param {{ selection: string, page?: { context?: string } }} request
 */
export function assertBoundedRequest(request) {
  if (typeof request.selection !== "string" || request.selection.length === 0) {
    throw new Error("selection must be a non-empty string");
  }
  if (request.selection.length > MAX_SELECTION) {
    throw new Error(`selection exceeds ${MAX_SELECTION} chars`);
  }
  const ctx = request.page?.context;
  if (ctx != null && ctx.length > MAX_CONTEXT) {
    throw new Error(`context exceeds ${MAX_CONTEXT} chars`);
  }
  return true;
}
