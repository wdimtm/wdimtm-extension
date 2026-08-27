/**
 * Settings shape and defaults — deliberately free of any host API.
 *
 * Split out of settings.js so the runtime can fall back to a default without
 * importing chrome.storage. The runtime has to work in a Cloudflare Worker as
 * well as in the extension; the storage-backed half of settings.js cannot go
 * there, and this half never needed to.
 */

/** @typedef {import('./lenses.js').LensDef} LensDef */

export const DEFAULT_SETTINGS = {
  runtime:
    /** @type {'mock' | 'openai-compatible' | 'anthropic' | 'promptaas' | 'wdimtm-cloud'} */ ("mock"),
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  /** Native Anthropic Messages API runtime (#64) — separate key/model from BYOK. */
  anthropicBaseUrl: "https://api.anthropic.com/v1",
  anthropicApiKey: "",
  anthropicModel: "claude-opus-5",
  promptaasBaseUrl: "http://127.0.0.1:8787",
  promptaasApiKey: "",
  promptaasAgentId: "wdimtm-explainer",
  /** Public subscribe / manage-plan URL for PromptaaS app */
  promptaasSubscribeUrl: "",
  /**
   * WDIMTM Cloud (Issue #51) — the hosted service mode of the same client.
   * Production default is baked in; normal users never fill this. Self-hosters
   * can override under Advanced. Packages / checkout come from Agentaab via
   * the Cloud API — not from client-side Agentaab URLs.
   */
  cloudBaseUrl: "https://cloud.wdimtm.com",
  /** Access token for WDIMTM Cloud. Filled by Google sign-in; never pasted by hand for normal users. Never synced. */
  cloudAccessToken: "",
  /** Public manage / top-up URL (optional). Checkout usually goes through package payment. */
  cloudSignUpUrl: "",
  /** Last successful test connection ISO time */
  lastRuntimeTestAt: "",
  lastRuntimeTestOk: false,
  defaultLensId: "general",
  /**
   * How the bubble picks a lens:
   * - auto: suggest from selection (+ profile); user may pin a specific lens
   * - manual: always use defaultLensId (or the bubble pick) — never auto-suggest
   * @type {'auto' | 'manual'}
   */
  lensMode: "auto",
  /** @type {LensDef[]} */
  customLenses: [],
  /**
   * Per-domain default Lens (Issue #19), e.g. [{ host: "x.com", lensId: "sanity" }].
   * A default only — the bubble still overrides it for a single selection.
   * @type {Array<{ host: string, lensId: string }>}
   */
  domainLenses: [],
  /**
   * Per-lens tweaks for built-ins (and optional id-keyed notes).
   * @type {Record<string, { name?: string, nameZh?: string, hint?: string, instructions?: string }>}
   */
  lensOverrides: {},
  /** Free-form stable profile (expertise, preferred depth/language). */
  profileText: "",
  memoryProvider: /** @type {'local' | 'none'} */ ("local"),
  stream: true,
  /** auto | en | zh_CN */
  uiLocale: "auto",
  /** auto | en | zh_CN | match-selection */
  answerLanguage: "auto",
  /** Master kill switch for content UI */
  enabled: true,
  /** Hostnames where WDIMTM stays inactive, e.g. ["mail.google.com"] */
  denylist: /** @type {string[]} */ ([]),
  /** short | normal | detailed */
  answerDepth: "normal",
  /** system | dark | light */
  theme: "system",
  /**
   * Account mode (Issue #28).
   * local = device only; cloud = signed-in sync (Phase B backend).
   */
  accountMode: /** @type {'local' | 'cloud'} */ ("local"),
  /** When cloud: sync profile/lenses/memories/prefs */
  syncPreferences: true,
  /** When cloud: sync page-chat threads */
  syncChatHistory: false,
  /** When cloud: sync API keys (default off — not recommended) */
  syncSecrets: false,
  /** ISO timestamp of last successful cloud sync */
  lastSyncedAt: "",
  /**
   * Web search for verify / research (optional).
   * @type {boolean}
   */
  webSearchEnabled: false,
  /** @type {'none' | 'tavily' | 'brave' | 'serper'} */
  webSearchProvider: "none",
  webSearchApiKey: "",
  webSearchMaxResults: 5,
};

/**
 * Secrets live in chrome.storage.local, never in .sync.
 *
 * Everything in .sync is uploaded to the user's Google account whenever Chrome
 * Sync is on, and mirrored to every signed-in Chrome. That is fine for
 * preferences and lenses; it is not fine for a credential the user pasted in
 * once. These keys are read from and written to local storage instead.
 */
export const SECRET_KEYS = /** @type {const} */ ([
  "apiKey",
  "anthropicApiKey",
  "promptaasApiKey",
  "webSearchApiKey",
  "cloudAccessToken",
]);
