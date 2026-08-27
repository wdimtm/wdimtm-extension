/**
 * Memory source registry (Issue #49).
 *
 * Adding a vendor means writing one parser and registering it here; nothing
 * downstream of `Conversation` changes.
 */

import { chatgptSource } from "./chatgpt.js";
import { claudeMemorySource } from "./claude-memory.js";
import { claudeSource } from "./claude.js";

/** @type {import('./types.js').MemorySource[]} */
export const MEMORY_SOURCES = [chatgptSource, claudeSource];

/**
 * Sources that yield an already-distilled profile rather than conversations.
 * Kept separate because they take a different, far shorter path: no batching,
 * no per-conversation extraction, one cheap call.
 */
export const PROFILE_SOURCES = [claudeMemorySource];

/**
 * @typedef {Object} ImportParseSuccess
 * @property {true} ok
 * @property {'conversations'} kind
 * @property {string} sourceId
 * @property {string} sourceLabel
 * @property {import('./types.js').Conversation[]} conversations
 * @property {number} skipped
 *
 * @typedef {Object} ImportProfileSuccess
 * @property {true} ok
 * @property {'profile'} kind
 * @property {string} sourceId
 * @property {string} sourceLabel
 * @property {import('./claude-memory.js').ProfileBlock[]} blocks
 * @property {number} skipped
 *
 * @typedef {Object} ImportParseFailure
 * @property {false} ok
 * @property {'invalid_json' | 'unknown_format' | 'empty'} code
 *
 * @typedef {ImportParseSuccess | ImportProfileSuccess | ImportParseFailure} ImportParseOutcome
 */

/**
 * Parse an export file's text into conversations.
 *
 * Pure and synchronous: no `chrome.*`, no network. The whole ingestion layer is
 * testable under `node --test` because of this.
 *
 * @param {string} fileText
 * @returns {ImportParseOutcome}
 */
export function parseExport(fileText) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    return { ok: false, code: "invalid_json" };
  }

  // Profile stores are checked first: they are small and unambiguous, and a
  // conversation sniffer could never mistake one for history anyway.
  const profileSource = PROFILE_SOURCES.find((candidate) => candidate.sniff(parsed));
  if (profileSource) {
    const { blocks, skipped } = profileSource.parse(parsed);
    if (!blocks.length) return { ok: false, code: "empty" };
    return {
      ok: true,
      kind: "profile",
      sourceId: profileSource.id,
      sourceLabel: profileSource.label,
      blocks,
      skipped,
    };
  }

  const source = MEMORY_SOURCES.find((candidate) => candidate.sniff(parsed));
  if (!source) return { ok: false, code: "unknown_format" };

  const { conversations, skipped } = source.parse(parsed);
  if (!conversations.length) return { ok: false, code: "empty" };

  return {
    ok: true,
    kind: "conversations",
    sourceId: source.id,
    sourceLabel: source.label,
    conversations,
    skipped,
  };
}
