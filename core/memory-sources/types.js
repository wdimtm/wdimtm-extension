/**
 * Ingestion layer contracts (Issue #49).
 *
 * Principle: memory sources turn external data into candidates;
 * memory providers own storing and retrieving what is known.
 *
 * `Conversation` is the only seam between the two. Parsers are the sole place
 * that knows a vendor export's quirks; everything downstream sees this shape.
 */

/**
 * @typedef {'user' | 'assistant'} TurnRole
 *
 * @typedef {Object} Turn
 * @property {TurnRole} role
 * @property {string} text
 *
 * @typedef {Object} Conversation
 * @property {string} id
 * @property {string} title
 * @property {string} createdAt  ISO 8601, or "" when the export has no usable timestamp
 * @property {Turn[]} turns
 *
 * @typedef {Object} ParseResult
 * @property {Conversation[]} conversations
 * @property {number} skipped  Entries we could not parse; surfaced in the UI.
 *
 * @typedef {Object} MemorySource
 * @property {string} id
 * @property {string} label
 * @property {(parsed: unknown) => boolean} sniff
 * @property {(parsed: unknown) => ParseResult} parse
 */

/**
 * Candidate memory produced by distillation, before review.
 *
 * `evidenceTitles` holds conversation titles rather than ids on purpose: raw
 * conversations are never persisted, so ids would be undereferenceable once the
 * import finishes, while titles stay short, readable, and travel with the
 * candidate into the review screen.
 *
 * @typedef {Object} MemoryCandidate
 * @property {import('../memory.js').MemoryType} type
 * @property {string} text
 * @property {string[]} evidenceTitles
 * @property {number} confidence
 *
 * @typedef {MemoryCandidate & {
 *   supportCount: number,
 *   existingId?: string,
 * }} MergedMemory
 */

/** Memory types the distiller is allowed to emit (mirrors lib/memory.js). */
export const MEMORY_TYPES = /** @type {const} */ ([
  "profile",
  "interest",
  "goal",
  "knowledge",
  "preference",
  "note",
]);

/**
 * @param {unknown} value
 * @returns {value is import('../memory.js').MemoryType}
 */
export function isMemoryType(value) {
  return typeof value === "string" && MEMORY_TYPES.includes(/** @type {never} */ (value));
}

/**
 * Normalize whitespace without destroying paragraph structure.
 * @param {unknown} value
 */
export function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * Vendor exports use seconds-since-epoch floats, ISO strings, or nothing at all.
 * @param {unknown} value
 * @returns {string} ISO string, or "" when unusable.
 */
export function toIsoDate(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Heuristic: seconds vs milliseconds. Anything below this is not a
    // plausible millisecond timestamp for a chat export.
    const ms = value < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
}

/**
 * Drop conversations that carry no usable turns, and normalize the shape.
 * Returns null when the conversation should be counted as skipped.
 *
 * @param {{ id?: unknown, title?: unknown, createdAt?: unknown, turns?: Turn[] }} input
 * @returns {Conversation | null}
 */
export function finalizeConversation(input) {
  const turns = (input.turns || []).filter((t) => t && t.text);
  if (!turns.length) return null;
  const id = typeof input.id === "string" && input.id ? input.id : "";
  if (!id) return null;
  return {
    id,
    title: cleanText(input.title) || "Untitled",
    createdAt: typeof input.createdAt === "string" ? input.createdAt : "",
    turns,
  };
}
