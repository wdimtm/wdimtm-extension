export const MSG = {
  EXPLAIN: "wdimtm:explain",
  GET_SETTINGS: "wdimtm:get-settings",
  OPEN_OPTIONS: "wdimtm:open-options",
  MEMORY_LIST: "wdimtm:memory-list",
  MEMORY_ADD: "wdimtm:memory-add",
  MEMORY_UPDATE: "wdimtm:memory-update",
  MEMORY_REMOVE: "wdimtm:memory-remove",
  MEMORY_CLEAR: "wdimtm:memory-clear",
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
  HISTORY_CLEAR: "wdimtm:history-clear",
  ACCOUNT_STATUS: "wdimtm:account-status",
  ACCOUNT_SET_MODE: "wdimtm:account-set-mode",
  ACCOUNT_SIGN_IN: "wdimtm:account-sign-in",
  ACCOUNT_SIGN_OUT: "wdimtm:account-sign-out",
  ACCOUNT_SYNC_NOW: "wdimtm:account-sync-now",
  TEST_RUNTIME: "wdimtm:test-runtime",
  RUNTIME_STATUS: "wdimtm:runtime-status",
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
};

/**
 * @param {string} type
 * @param {unknown} [payload]
 */
export function message(type, payload) {
  return { type, payload };
}
