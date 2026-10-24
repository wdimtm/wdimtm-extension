/**
 * The one list of messages the extension's pages send to the service worker.
 * Every sender and the worker's router import it; a page that kept its own
 * copy fell out of step and sent `undefined` (#163).
 */
export const MSG = Object.freeze({
  EXPLAIN: "wdimtm:explain",
  GET_SETTINGS: "wdimtm:get-settings",
  OPEN_OPTIONS: "wdimtm:open-options",
  MEMORY_LIST: "wdimtm:memory-list",
  MEMORY_ADD: "wdimtm:memory-add",
  SET_DEFAULT_LENS: "wdimtm:set-default-lens",
  RESET_ALL: "wdimtm:reset-all",
  EXPORT_SETTINGS: "wdimtm:export-settings",
  IMPORT_SETTINGS: "wdimtm:import-settings",
  CHAT: "wdimtm:chat",
  CHAT_LOAD: "wdimtm:chat-load",
  CHAT_SAVE: "wdimtm:chat-save",
  CHAT_THREAD_LOAD: "wdimtm:chat-thread-load",
  CHAT_THREAD_CLEAR: "wdimtm:chat-thread-clear",
  HISTORY_LOAD: "wdimtm:history-load",
  HISTORY_APPEND: "wdimtm:history-append",
  ACCOUNT_STATUS: "wdimtm:account-status",
  ACCOUNT_SET_MODE: "wdimtm:account-set-mode",
  ACCOUNT_SIGN_IN: "wdimtm:account-sign-in",
  ACCOUNT_SIGN_OUT: "wdimtm:account-sign-out",
  ACCOUNT_SYNC_NOW: "wdimtm:account-sync-now",
  ACCOUNT_EXPORT: "wdimtm:account-export",
  ACCOUNT_DELETE: "wdimtm:account-delete",
  TEST_RUNTIME: "wdimtm:test-runtime",
  // Conversation import (#49). The page drives the job; these handlers are
  // stateless — one batch in, one result out — so the service worker never
  // needs to outlive a single request.
  IMPORT_STATUS: "wdimtm:import-status",
  IMPORT_DISTILL: "wdimtm:import-distill",
  IMPORT_PROFILE: "wdimtm:import-profile",
  IMPORT_MERGE: "wdimtm:import-merge",
  IMPORT_COMMIT: "wdimtm:import-commit",
  RESEARCH_START: "wdimtm:research-start",
  RESEARCH_GET: "wdimtm:research-get",
  RESEARCH_CANCEL: "wdimtm:research-cancel",
  RESEARCH_LIST: "wdimtm:research-list",
});

const KNOWN_TYPES = new Set(Object.values(MSG));

/**
 * A page's side of the bridge. Refuses a type that is not in `MSG` before
 * anything is sent, so a misspelt or missing constant fails where it was
 * written instead of as "Unknown message type" from the worker.
 *
 * @param {(message: { type: string, payload?: unknown }) => Promise<any>} send
 *   `chrome.runtime.sendMessage`, or a fake in tests.
 * @returns {(message: { type: string, payload?: unknown }) => Promise<any>}
 */
export function createSender(send) {
  return (message) => {
    if (!KNOWN_TYPES.has(message?.type)) {
      return Promise.reject(new Error(`Unknown message type: ${message?.type}`));
    }
    return send(message);
  };
}

/**
 * The worker's side of the bridge: one handler per `MSG` type. A handler for a
 * type that is not in `MSG` is a bug in the table, so it throws when the table
 * is built rather than waiting for a message that never comes.
 *
 * @param {Record<string, (payload: any) => Promise<any>>} handlers
 * @returns {(message: { type?: string, payload?: unknown } | null | undefined) => Promise<any>}
 */
export function createMessageRouter(handlers) {
  for (const type of Object.keys(handlers)) {
    if (!KNOWN_TYPES.has(type)) throw new Error(`Handler for unknown message type: ${type}`);
  }
  return async (message) => {
    const type = message?.type;
    const handler = type && Object.hasOwn(handlers, type) ? handlers[type] : null;
    if (!handler) return { ok: false, error: `Unknown message type: ${type}` };
    return handler(message.payload);
  };
}
