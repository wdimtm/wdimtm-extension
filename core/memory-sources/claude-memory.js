/**
 * Claude `memories.json` — a memory source, not a conversation source (#49).
 *
 * A real Claude export ships the user's own curated memory store: a prose
 * profile plus a set of structured markdown notes. It is already distilled —
 * the thing the conversation pipeline spends half a million tokens producing —
 * so it gets a short path of its own rather than being forced through batching
 * and per-conversation extraction.
 *
 * For the export this was written against: 11KB total, one model call, versus
 * ~513k tokens for the same user's full ChatGPT history.
 */

import { cleanText } from "./types.js";

/**
 * @typedef {Object} ProfileBlock
 * @property {string} label  Human-readable origin, shown as evidence in review.
 * @property {string} text
 */

/**
 * @param {unknown} parsed
 * @returns {boolean}
 */
export function sniff(parsed) {
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      (typeof entry.conversations_memory === "string" || Array.isArray(entry.memory_files))
  );
}

/**
 * Pure and synchronous, like the conversation parsers.
 *
 * @param {unknown} parsed
 * @returns {{ blocks: ProfileBlock[], skipped: number }}
 */
export function parse(parsed) {
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  /** @type {ProfileBlock[]} */
  const blocks = [];
  let skipped = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      skipped += 1;
      continue;
    }

    const summary = cleanText(entry.conversations_memory);
    if (summary) blocks.push({ label: "Profile summary", text: summary });

    if (Array.isArray(entry.memory_files)) {
      for (const file of entry.memory_files) {
        if (!file || typeof file !== "object") {
          skipped += 1;
          continue;
        }
        const text = cleanText(file.content);
        if (!text) {
          skipped += 1;
          continue;
        }
        // The path is signal, not decoration: /preferences.md, /profile.md and
        // /topics/* line up almost exactly with our memory types, so it is kept
        // as the block label and shown to the model.
        blocks.push({ label: typeof file.path === "string" ? file.path : "memory file", text });
      }
    }
  }

  return { blocks, skipped };
}

/** @type {{ id: string, label: string, sniff: typeof sniff, parse: typeof parse }} */
export const claudeMemorySource = {
  id: "claude-memory",
  label: "Claude memory",
  sniff,
  parse,
};
