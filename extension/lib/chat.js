/**
 * Page-scoped chat session helpers (Issue #13).
 * Chat is an escalation from the explain popover — not the default surface.
 */

import { stripAttachmentPayloads } from "../../core/images.js";

const PREFIX = "wdimtm.chat.v1:";
const HISTORY_PREFIX = "wdimtm.history.v1:";
const MAX_HISTORY = 12;
/** A page keeps one thread per selection; oldest are dropped past this. */
export const MAX_THREADS = 8;

/**
 * @param {string} url
 */
export function sessionKeyForUrl(url) {
  try {
    const u = new URL(url);
    // Origin + pathname — ignore hash/query noise for stability.
    return `${PREFIX}${u.origin}${u.pathname}`;
  } catch {
    return `${PREFIX}${String(url || "").slice(0, 200)}`;
  }
}

/**
 * @param {string} url
 */
export function historyKeyForUrl(url) {
  try {
    const u = new URL(url);
    return `${HISTORY_PREFIX}${u.origin}${u.pathname}`;
  } catch {
    return `${HISTORY_PREFIX}${String(url || "").slice(0, 200)}`;
  }
}

// ── Per-selection threads ────────────────────────────────────
// A page used to hold a single session slot, so opening chat for a second
// selection overwrote the first conversation. Threads are keyed by selection
// instead, so selections on the same page no longer clobber each other.

/**
 * Stable short id for a selection. FNV-1a — no crypto dependency, and the same
 * selection maps to the same thread across reloads.
 * @param {string} selection
 */
export function threadIdForSelection(selection) {
  const s = String(selection || "").trim();
  if (!s) return "t_default";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `t_${h.toString(36)}`;
}

/**
 * Read the thread store, migrating the legacy single-session shape in place.
 * @param {unknown} raw
 * @returns {{ threads: Array<object> }}
 */
function normalizeStore(raw) {
  if (!raw || typeof raw !== "object") return { threads: [] };
  const rec = /** @type {Record<string, any>} */ (raw);
  if (Array.isArray(rec.threads)) {
    return { threads: rec.threads.filter((t) => t && typeof t === "object") };
  }
  // Legacy v1: one session object per page.
  if (Array.isArray(rec.messages)) {
    return {
      threads: [
        {
          id: threadIdForSelection(rec.selection),
          selection: rec.selection || "",
          messages: rec.messages,
          page: rec.page,
          lensId: rec.lensId,
          seedExplanation: rec.seedExplanation,
          updatedAt: rec.updatedAt,
        },
      ],
    };
  }
  return { threads: [] };
}

/**
 * @param {string} url
 * @returns {Promise<{ threads: Array<object> }>}
 */
export async function loadThreadStore(url) {
  const key = sessionKeyForUrl(url);
  const data = await chrome.storage.session.get({ [key]: null });
  return normalizeStore(data[key]);
}

/**
 * @param {string} url
 * @param {string} selection
 * @returns {Promise<object | null>}
 */
export async function loadThread(url, selection) {
  const { threads } = await loadThreadStore(url);
  const id = threadIdForSelection(selection);
  return threads.find((t) => t.id === id) || null;
}

/**
 * Upsert one thread. Never touches the other threads on the page.
 * @param {string} url
 * @param {{ selection?: string, messages?: Array<object>, page?: object, lensId?: string, seedExplanation?: string, id?: string }} thread
 */
export async function saveThread(url, thread) {
  const key = sessionKeyForUrl(url);
  const { threads } = await loadThreadStore(url);
  const id = thread.id || threadIdForSelection(thread.selection);
  const rawMessages = Array.isArray(thread.messages) ? thread.messages : [];
  // Image payloads stay in the tab; session storage only keeps thumbnails.
  const messages = rawMessages.map((msg) =>
    msg?.attachments?.length
      ? { ...msg, attachments: stripAttachmentPayloads(msg.attachments) }
      : msg
  );
  const next = {
    ...thread,
    id,
    selection: thread.selection || "",
    messages,
    updatedAt: new Date().toISOString(),
  };
  const store = {
    threads: [next, ...threads.filter((t) => t.id !== id)].slice(0, MAX_THREADS),
  };
  await chrome.storage.session.set({ [key]: store });
  return store;
}

/**
 * Summaries for the "on this page" list — full messages stay out of the UI payload.
 * @param {string} url
 */
export async function listThreads(url) {
  const { threads } = await loadThreadStore(url);
  return threads.map((t) => ({
    id: t.id,
    selection: t.selection || "",
    lensId: t.lensId,
    updatedAt: t.updatedAt,
    messageCount: Array.isArray(t.messages) ? t.messages.length : 0,
  }));
}

/**
 * @param {string} url
 * @param {string} selection
 */
export async function clearThread(url, selection) {
  const key = sessionKeyForUrl(url);
  const { threads } = await loadThreadStore(url);
  const id = threadIdForSelection(selection);
  const store = { threads: threads.filter((t) => t.id !== id) };
  await chrome.storage.session.set({ [key]: store });
  return store;
}

/**
 * @param {string} url
 * @returns {Promise<Array<{
 *   id: string,
 *   at: string,
 *   selection: string,
 *   explanation: string,
 *   lensId?: string,
 *   mode?: string,
 * }>>}
 */
export async function loadPageHistory(url) {
  const key = historyKeyForUrl(url);
  const data = await chrome.storage.session.get({ [key]: [] });
  return Array.isArray(data[key]) ? data[key] : [];
}

/**
 * @param {string} url
 * @param {{ selection: string, explanation: string, lensId?: string, mode?: string }} entry
 */
export async function appendPageHistory(url, entry) {
  const key = historyKeyForUrl(url);
  const prev = await loadPageHistory(url);
  const next = [
    {
      id: `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      selection: String(entry.selection || "").slice(0, 500),
      explanation: String(entry.explanation || "").slice(0, 4000),
      lensId: entry.lensId,
      mode: entry.mode,
    },
    ...prev,
  ].slice(0, MAX_HISTORY);
  await chrome.storage.session.set({ [key]: next });
  return next;
}

export async function clearPageHistory(url) {
  const key = historyKeyForUrl(url);
  await chrome.storage.session.remove(key);
}

/**
 * Build system prompt for multi-turn page chat.
 * @param {{
 *   selection: string,
 *   page: { url: string, title: string, context?: string },
 *   lens?: { id: string, instructions?: string },
 *   memories?: Array<{ type: string, content: string }>,
 *   languageInstruction?: string,
 *   webEvidence?: string,
 *   hasAttachments?: boolean,
 *   webSearchMeta?: {
 *     used?: boolean,
 *     provider?: string,
 *     error?: string,
 *     resultCount?: number,
 *     status?: string,
 *     query?: string,
 *     humanError?: string,
 *   },
 * }} ctx
 */

// Re-exported so existing import sites keep working; the builder itself is
// host-free and lives in chat-prompt.js now.
export { buildChatSystemPrompt } from "../../core/chat-prompt.js";
