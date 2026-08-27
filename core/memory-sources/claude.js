/**
 * Claude `conversations.json` parser (Issue #49).
 *
 * Flatter than the ChatGPT export: each conversation carries `chat_messages`
 * in order, so there is no branch to resolve. Message text lives either in a
 * `content` array of typed blocks or in a plain `text` field, depending on
 * export vintage; both are handled.
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
    (entry) => entry && typeof entry === "object" && Array.isArray(entry.chat_messages)
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
  if (!Array.isArray(entry.chat_messages)) return null;

  /** @type {import('./types.js').Turn[]} */
  const turns = [];
  for (const message of entry.chat_messages) {
    const turn = toTurn(message);
    if (turn) turns.push(turn);
  }

  return finalizeConversation({
    id: typeof entry.uuid === "string" ? entry.uuid : entry.id,
    title: entry.name ?? entry.title,
    createdAt: toIsoDate(entry.created_at),
    turns,
  });
}

/**
 * @param {any} message
 * @returns {import('./types.js').Turn | null}
 */
function toTurn(message) {
  if (!message || typeof message !== "object") return null;

  const role = normalizeRole(message.sender ?? message.role);
  if (!role) return null;

  const text = extractContent(message);
  if (!text) return null;
  return { role, text };
}

/**
 * Claude exports label the user "human"; newer shapes may use "user".
 * @param {unknown} sender
 * @returns {import('./types.js').TurnRole | null}
 */
function normalizeRole(sender) {
  if (sender === "human" || sender === "user") return "user";
  if (sender === "assistant") return "assistant";
  return null;
}

/**
 * Typed content blocks win when present; attachments and tool blocks carry no
 * signal about the user and are dropped.
 * @param {any} message
 */
function extractContent(message) {
  if (Array.isArray(message.content)) {
    const text = message.content
      .filter((block) => block && block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    if (cleanText(text)) return cleanText(text);
  }

  if (typeof message.text === "string") return cleanText(message.text);

  return "";
}

/** @type {import('./types.js').MemorySource} */
export const claudeSource = {
  id: "claude",
  label: "Claude",
  sniff,
  parse,
};
