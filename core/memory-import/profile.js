/**
 * Profile distillation (#49).
 *
 * A memory export is already distilled prose, so the job here is *splitting*
 * durable statements out of it, not inferring them from scattered dialogue.
 * That difference is why it gets its own prompt rather than reusing the
 * conversation one, which is written to look past chat noise.
 *
 * Pure and deterministic; the network call lives in the service worker.
 */

import { isMemoryType } from "../memory-sources/types.js";
import { extractJsonArray } from "./distill.js";

/** Matches the conversation batcher, so one oversized store still splits. */
export const PROFILE_BATCH_CHARS = 24000;

/**
 * A curated memory store is the user's own account of themselves, so its
 * statements outrank anything inferred from a single conversation. This is the
 * floor they land on after merging.
 */
export const PROFILE_CONFIDENCE = 0.9;

/**
 * @typedef {Object} ProfileBatch
 * @property {number} index
 * @property {import('../memory-sources/claude-memory.js').ProfileBlock[]} blocks
 * @property {string} text
 */

/**
 * @param {import('../memory-sources/claude-memory.js').ProfileBlock} block
 * @param {number} ordinal
 */
export function renderProfileBlock(block, ordinal) {
  const label = String(block.label || "memory").replace(/["\n\r]/g, " ").slice(0, 120);
  return `<memory n="${ordinal}" source="${label}">\n${block.text}\n</memory>`;
}

/**
 * @param {import('../memory-sources/claude-memory.js').ProfileBlock[]} blocks
 * @param {{ batchChars?: number }} [opts]
 * @returns {ProfileBatch[]}
 */
export function buildProfileBatches(blocks, opts = {}) {
  const budget = opts.batchChars || PROFILE_BATCH_CHARS;
  /** @type {ProfileBatch[]} */
  const batches = [];
  let current = [];
  let rendered = [];
  let size = 0;

  const flush = () => {
    if (!current.length) return;
    batches.push({ index: batches.length, blocks: current, text: rendered.join("\n\n") });
    current = [];
    rendered = [];
    size = 0;
  };

  for (const block of blocks) {
    let text = renderProfileBlock(block, current.length + 1);
    if (size && size + text.length > budget) {
      flush();
      text = renderProfileBlock(block, 1);
    }
    current.push(block);
    rendered.push(text);
    size += text.length;
  }
  flush();

  return batches;
}

const PROFILE_INSTRUCTIONS = `You are splitting a person's existing memory store into individual memories.

The input is already about this person — written by an AI assistant that knew them. Do not re-infer or second-guess it; break it into separate, durable statements.

Return a JSON array. Each item:
  "type": one of profile, interest, goal, knowledge, preference, note
  "text": one short first-person sentence, e.g. "I work on transaction monitoring at a crypto exchange"
  "from": array of memory numbers it came from

Rules:
- One fact per item. Split compound sentences apart.
- Rewrite into the first person, keeping the substance exactly.
- The source path is a strong hint: /profile → profile, /preferences → preference, /topics/* → interest or knowledge, /areas/* → goal or knowledge.
- Skip anything transient — a task in progress, a one-off question, a date-stamped status.
- Skip identifiers: names, emails, account ids, phone numbers.
- Output only the JSON array, no prose.`;

/**
 * @param {ProfileBatch} batch
 * @returns {{ system: string, user: string }}
 */
export function buildProfilePrompt(batch) {
  return { system: PROFILE_INSTRUCTIONS, user: batch.text };
}

/**
 * @param {string} raw
 * @param {ProfileBatch} batch
 * @returns {import('../memory-sources/types.js').MemoryCandidate[] | null}
 */
export function parseProfileResponse(raw, batch) {
  const items = extractJsonArray(raw);
  if (!items) return null;

  /** @type {import('../memory-sources/types.js').MemoryCandidate[]} */
  const candidates = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;

    candidates.push({
      type: isMemoryType(item.type) ? item.type : "note",
      text,
      evidenceTitles: resolveLabels(item.from, batch),
      confidence: PROFILE_CONFIDENCE,
      // Carried through the merge so a curated statement is not demoted to the
      // confidence of whatever it happens to be merged with.
      fromProfile: true,
    });
  }
  return candidates;
}

/**
 * @param {unknown} from
 * @param {ProfileBatch} batch
 */
function resolveLabels(from, batch) {
  if (!Array.isArray(from)) return [];
  /** @type {string[]} */
  const labels = [];
  for (const n of from) {
    const block = batch.blocks[Number(n) - 1];
    if (block && !labels.includes(block.label)) labels.push(block.label);
  }
  return labels;
}
