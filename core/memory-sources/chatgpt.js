/**
 * ChatGPT `conversations.json` parser (Issue #49).
 *
 * Each conversation stores its messages as a *tree* (`mapping`, keyed by node
 * id) plus a `current_node` pointer. The active branch is obtained by walking
 * from `current_node` up through `parent` and reversing.
 *
 * Iterating `mapping` wholesale would also pick up branches the user abandoned
 * by regenerating, feeding three versions of the same answer to the distiller.
 * We only fall back to that when the walk yields nothing.
 *
 * Field names follow the export format as observed to date; the parser stays
 * defensive so a drifted or partial entry is skipped and counted rather than
 * failing the whole import.
 */

import { cleanText, finalizeConversation, toIsoDate } from "./types.js";

/**
 * @param {unknown} parsed
 * @returns {boolean}
 */
export function sniff(parsed) {
  if (!Array.isArray(parsed) || !parsed.length) return false;
  return parsed.some(
    (entry) => entry && typeof entry === "object" && "mapping" in entry
  );
}

/**
 * @param {unknown} parsed
 * @returns {import('./types.js').ParseResult}
 */
export function parse(parsed) {
  if (!Array.isArray(parsed)) return { conversations: [], skipped: 0 };

  /** @type {import('./types.js').Conversation[]} */
  const conversations = [];
  let skipped = 0;

  for (const entry of parsed) {
    try {
      const conversation = parseOne(entry);
      if (conversation) conversations.push(conversation);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }

  return { conversations, skipped };
}

/**
 * @param {any} entry
 * @returns {import('./types.js').Conversation | null}
 */
function parseOne(entry) {
  if (!entry || typeof entry !== "object") return null;
  const mapping = entry.mapping;
  if (!mapping || typeof mapping !== "object") return null;

  const nodes = walkActiveBranch(mapping, entry.current_node) || allNodesByTime(mapping);

  /** @type {import('./types.js').Turn[]} */
  const turns = [];
  for (const node of nodes) {
    const turn = toTurn(node.message);
    if (turn) turns.push(turn);
  }

  return finalizeConversation({
    id: typeof entry.conversation_id === "string" ? entry.conversation_id : entry.id,
    title: entry.title,
    createdAt: toIsoDate(entry.create_time),
    turns,
  });
}

/**
 * Walk from `current_node` to the root, then reverse into chronological order.
 * Returns null when the pointer is missing or the walk finds no messages, so
 * the caller can fall back.
 *
 * @param {Record<string, any>} mapping
 * @param {unknown} currentNode
 */
function walkActiveBranch(mapping, currentNode) {
  if (typeof currentNode !== "string" || !mapping[currentNode]) return null;

  /** @type {any[]} */
  const chain = [];
  // A malformed export could contain a parent cycle; `seen` keeps the walk finite.
  const seen = new Set();
  let id = currentNode;

  while (typeof id === "string" && mapping[id] && !seen.has(id)) {
    seen.add(id);
    chain.push(mapping[id]);
    id = mapping[id].parent;
  }

  chain.reverse();
  return chain.some((node) => node?.message) ? chain : null;
}

/**
 * Degraded path: every node in creation order, abandoned branches included.
 * @param {Record<string, any>} mapping
 */
function allNodesByTime(mapping) {
  return Object.values(mapping)
    .filter((node) => node && typeof node === "object")
    .sort((a, b) => (a?.message?.create_time || 0) - (b?.message?.create_time || 0));
}

/**
 * @param {any} message
 * @returns {import('./types.js').Turn | null}
 */
function toTurn(message) {
  if (!message || typeof message !== "object") return null;
  if (message.metadata?.is_visually_hidden_from_conversation === true) return null;

  const role = message.author?.role;
  if (role !== "user" && role !== "assistant") return null;

  const text = extractContent(message.content);
  if (!text) return null;
  return { role, text };
}

/**
 * `content` varies by `content_type`. Verified against a real 714-conversation
 * export; the shapes that actually occur are handled explicitly.
 *
 * @param {any} content
 */
function extractContent(content) {
  if (!content || typeof content !== "object") return "";

  // Custom instructions — the user describing themselves in their own words.
  // Text-for-text this is the highest-value material in an export, so it is
  // pulled out rather than dropped for lacking a `parts` array.
  if (content.content_type === "user_editable_context") {
    const profile = cleanText(content.user_profile);
    const instructions = cleanText(content.user_instructions);
    const joined = [profile, instructions].filter(Boolean).join("\n");
    return joined ? `[custom instructions]\n${joined}` : "";
  }

  // Reasoning traces are the model thinking aloud, not the user. In a real
  // export these are ~35% of all messages and say nothing about who the user
  // is. They lack both `parts` and `text` today, so this is belt-and-braces
  // against a format change that gives them one.
  if (content.content_type === "thoughts" || content.content_type === "reasoning_recap") {
    return "";
  }

  if (Array.isArray(content.parts)) {
    const text = content.parts.map(partToText).filter(Boolean).join("\n");
    if (cleanText(text)) return cleanText(text);
  }

  // Code blocks keep their body here rather than in `parts`.
  if (typeof content.text === "string") return cleanText(content.text);

  return "";
}

/**
 * Parts are usually plain strings, but multimodal messages mix in objects.
 * Image pointers carry no signal and are dropped; audio transcriptions carry
 * the user's actual words, and without them a spoken conversation parses to
 * nothing at all.
 *
 * @param {unknown} part
 */
function partToText(part) {
  if (typeof part === "string") return part;
  if (
    part &&
    typeof part === "object" &&
    part.content_type === "audio_transcription" &&
    typeof part.text === "string"
  ) {
    return part.text;
  }
  return "";
}

/** @type {import('./types.js').MemorySource} */
export const chatgptSource = {
  id: "chatgpt",
  label: "ChatGPT",
  sniff,
  parse,
};
