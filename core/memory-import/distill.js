/**
 * Distillation: the map half of the pipeline (Issue #49).
 *
 * Everything here is pure and deterministic. The network call lives in the
 * service worker; this module only decides *what* to send and interprets what
 * comes back. That split is what keeps the pipeline testable without mocking
 * `chrome.*`, and it is also what makes resuming possible: the same file always
 * produces the same batches, so a cursor stays meaningful across sessions.
 */

import { isMemoryType } from "../memory-sources/types.js";

/**
 * User turns are where the signal about the user lives; assistant turns are
 * mostly context. Truncating the assistant side hard preserves what matters
 * while keeping batches dense.
 */
export const LIMITS = {
  userTurnChars: 2000,
  assistantTurnChars: 300,
  conversationChars: 8000,
  batchChars: 24000,
};

/**
 * @typedef {Object} DistillBatch
 * @property {number} index
 * @property {import('../memory-sources/types.js').Conversation[]} conversations
 * @property {string} text  Rendered prompt body, ready to send.
 */

/**
 * Render one conversation into the compact form sent to the model.
 * @param {import('../memory-sources/types.js').Conversation} conversation
 * @param {number} ordinal  1-based, referenced by the model's `from` field.
 */
export function renderConversation(conversation, ordinal) {
  const lines = [`<conversation n="${ordinal}" title="${sanitizeAttr(conversation.title)}">`];
  let budget = LIMITS.conversationChars;

  for (const turn of conversation.turns) {
    if (budget <= 0) break;
    const cap = turn.role === "user" ? LIMITS.userTurnChars : LIMITS.assistantTurnChars;
    const text = truncate(turn.text, Math.min(cap, budget));
    if (!text) continue;
    budget -= text.length;
    lines.push(`${turn.role}: ${text}`);
  }

  lines.push("</conversation>");
  return lines.join("\n");
}

/**
 * Group conversations into batches under a character budget.
 * Deterministic: same input, same batches, always.
 *
 * @param {import('../memory-sources/types.js').Conversation[]} conversations
 * @param {{ batchChars?: number }} [opts]
 * @returns {DistillBatch[]}
 */
export function buildDistillBatches(conversations, opts = {}) {
  const batchChars = opts.batchChars || LIMITS.batchChars;
  /** @type {DistillBatch[]} */
  const batches = [];

  /** @type {import('../memory-sources/types.js').Conversation[]} */
  let current = [];
  /** @type {string[]} */
  let rendered = [];
  let size = 0;

  const flush = () => {
    if (!current.length) return;
    batches.push({ index: batches.length, conversations: current, text: rendered.join("\n\n") });
    current = [];
    rendered = [];
    size = 0;
  };

  for (const conversation of conversations) {
    let text = renderConversation(conversation, current.length + 1);
    // A single oversized conversation still gets its own batch rather than
    // being dropped; renderConversation has already capped it.
    if (size && size + text.length > batchChars) {
      flush();
      text = renderConversation(conversation, 1);
    }
    current.push(conversation);
    rendered.push(text);
    size += text.length;
  }
  flush();

  return batches;
}

/**
 * Rough token estimate for the disclosure screen.
 *
 * CJK text packs far more tokens per character than Latin text, so a flat
 * chars/4 would understate a Chinese-heavy history badly — and this number is
 * shown to the user before they agree to spend it.
 *
 * @param {string} text
 */
export function estimateTokens(text) {
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk += 1;
    }
  }
  const other = text.length - cjk;
  return Math.ceil(cjk / 1.5 + other / 4);
}

/**
 * @param {DistillBatch[]} batches
 */
export function estimateBatchTokens(batches) {
  return batches.reduce((sum, batch) => sum + estimateTokens(batch.text), 0);
}

/**
 * Identity check for resuming a paused job against a re-selected file.
 * Cheap and non-cryptographic — it guards against picking the wrong file, not
 * against tampering.
 *
 * @param {import('../memory-sources/types.js').Conversation[]} conversations
 */
export function fingerprintConversations(conversations) {
  let hash = 2166136261;
  for (const conversation of conversations) {
    for (let i = 0; i < conversation.id.length; i += 1) {
      hash ^= conversation.id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${conversations.length}-${(hash >>> 0).toString(36)}`;
}

const DISTILL_INSTRUCTIONS = `You extract durable facts about a person from their past AI conversations.

Return a JSON array. Each item:
  "type": one of profile, interest, goal, knowledge, preference, note
  "text": one short first-person sentence, e.g. "I work on DeFi protocol design"
  "from": array of conversation numbers supporting it
  "confidence": 0 to 1

Rules:
- Describe the PERSON, not the topics discussed. "I am learning Rust" is a memory; "Rust has a borrow checker" is not.
- profile: durable role or expertise. interest: ongoing topics. goal: something they are trying to achieve. knowledge: what they already understand well. preference: how they want answers framed. note: anything else durable.
- Skip one-off task requests that reveal nothing about the person.
- Prefer few strong items over many weak ones. Return [] if nothing durable appears.
- Output only the JSON array, no prose.`;

/**
 * @param {DistillBatch} batch
 * @returns {{ system: string, user: string }}
 */
export function buildDistillPrompt(batch) {
  return { system: DISTILL_INSTRUCTIONS, user: batch.text };
}

/**
 * Interpret a model response into candidates.
 *
 * Models wrap JSON in prose or markdown fences often enough that strict parsing
 * would fail routinely, so this is deliberately lenient. An unusable response
 * returns null, which the caller treats as a retryable batch failure rather
 * than a fatal error.
 *
 * @param {string} raw
 * @param {DistillBatch} batch
 * @returns {import('../memory-sources/types.js').MemoryCandidate[] | null}
 */
export function parseDistillResponse(raw, batch) {
  const items = extractJsonArray(raw);
  if (!items) return null;

  /** @type {import('../memory-sources/types.js').MemoryCandidate[]} */
  const candidates = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;
    const type = isMemoryType(item.type) ? item.type : "note";

    candidates.push({
      type,
      text,
      evidenceTitles: resolveEvidence(item.from, batch),
      confidence: clamp01(item.confidence),
    });
  }
  return candidates;
}

/**
 * @param {string} raw
 * @returns {any[] | null}
 */
export function extractJsonArray(raw) {
  if (typeof raw !== "string") return null;
  const withoutFences = raw.replace(/```(?:json)?/gi, "");
  const start = withoutFences.indexOf("[");
  const end = withoutFences.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(withoutFences.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Map the model's 1-based conversation numbers back to titles. Titles rather
 * than ids because raw conversations are never persisted — an id would be
 * undereferenceable by the time the review screen renders.
 *
 * @param {unknown} from
 * @param {DistillBatch} batch
 */
function resolveEvidence(from, batch) {
  if (!Array.isArray(from)) return [];
  /** @type {string[]} */
  const titles = [];
  for (const n of from) {
    const conversation = batch.conversations[Number(n) - 1];
    if (conversation && !titles.includes(conversation.title)) titles.push(conversation.title);
  }
  return titles;
}

/** @param {unknown} value */
function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
  const trimmed = text.trim();
  if (max <= 0) return "";
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/** @param {string} value */
function sanitizeAttr(value) {
  return value.replace(/["\n\r]/g, " ").slice(0, 120);
}
