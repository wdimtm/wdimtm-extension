/**
 * The runtime registry — one entry per runtime, and the only place that knows
 * which runtimes exist.
 *
 * `runtime` is the seam this product is organized around, and the same map used
 * to live in six places: the explain switch, the chat chain, two different
 * readiness rules, four hand-written connectivity pings, and the Options form.
 * They drifted, as duplicated maps do — three of them disagreed about whether
 * `promptaas` was ready, and about what to call the reason.
 *
 * An entry answers every question the rest of the codebase asks about a runtime:
 *
 *   configFromSettings  which settings keys configure it, and under what names
 *   ready               is it configured well enough to run (AI status banner)
 *   completion          can it serve a plain completion (conversation import)
 *   ping                a "Test connection" round trip
 *   explain / chat      the two things a runtime actually does
 *
 * Adding a runtime is adding one entry here. Nothing else should grow a case.
 */

import { DEFAULT_CLOUD_BASE_URL } from "../cloud.js";
import {
  chatWithAnthropic,
  explainWithAnthropic,
  pingAnthropic,
} from "./anthropic.js";
import { chatWithMock, explainWithMock, pingMock } from "./mock.js";
import {
  chatWithOpenAICompatible,
  explainWithOpenAICompatible,
  pingOpenAICompatible,
} from "./openai-compatible.js";
import {
  chatWithPromptaaS,
  explainWithPromptaaS,
  pingPromptaaS,
} from "./promptaas.js";
import {
  chatWithWdimtmCloud,
  explainWithWdimtmCloud,
  pingWdimtmCloud,
} from "./wdimtm-cloud.js";

/**
 * @typedef {Object} RuntimeReadiness
 * @property {boolean} ok
 * @property {string} reason
 *
 * Whether a runtime can serve the plain completions that conversation import
 * needs (`runtime/completion.js`). This is a different question from `ready`:
 * import does not go through the explain path at all, it posts its own system
 * prompt to an OpenAI-compatible endpoint, so what it needs is that endpoint's
 * key rather than whatever the selected runtime happens to be configured with.
 *
 * @typedef {{ ok: false, reason: string }
 *          | { ok: true, keyField: string, missingReason: string }} CompletionSupport
 *
 * @typedef {Object} RuntimeEntry
 * @property {string} id
 * @property {string[]} settingsKeys  settings this runtime reads, for UIs that
 *   collect them (Options "Test connection")
 * @property {(settings: Record<string, any>, ctx?: { answerLanguage?: string, languageInstruction?: string }) => Record<string, any>} configFromSettings
 *   Renames settings keys into the runtime's own config; it does not invent
 *   values. Each runtime already falls back to its protocol defaults, and a
 *   probe has to be able to tell "not set" from "set to the default".
 * @property {(settings: Record<string, any>) => RuntimeReadiness} ready
 * @property {CompletionSupport} completion
 * @property {(config: Record<string, any>) => Promise<{ ok: boolean, message: string, code?: string }>} ping
 * @property {(request: any, config: any) => Promise<any>} explain
 * @property {(request: any, config: any) => Promise<{ reply: string, runtime: string }>} chat
 */

/** Conversation import posts to the BYOK endpoint whatever runtime is selected. */
const COMPLETION_VIA_BYOK_KEY = /** @type {const} */ ({
  ok: true,
  keyField: "apiKey",
  missingReason: "missing_key",
});

/** `languageInstruction` only rides along when the caller supplied one. */
function withLanguage(config, ctx) {
  return ctx?.languageInstruction
    ? { ...config, languageInstruction: ctx.languageInstruction }
    : config;
}

/** @type {RuntimeEntry[]} */
export const RUNTIMES = [
  {
    id: "mock",
    settingsKeys: [],
    configFromSettings: (_settings, ctx = {}) =>
      // An explicit boolean, not a truthy one: `false` also turns off the
      // mock's own CJK autodetection, which is what "answer in English" means.
      withLanguage({ forceZh: ctx.answerLanguage === "zh_CN" }, ctx),
    ready: () => ({ ok: false, reason: "mock" }),
    completion: { ok: false, reason: "mock" },
    ping: pingMock,
    explain: explainWithMock,
    chat: chatWithMock,
  },
  {
    id: "openai-compatible",
    settingsKeys: ["apiBaseUrl", "apiKey", "model"],
    configFromSettings: (settings, ctx = {}) =>
      withLanguage(
        {
          apiBaseUrl: settings.apiBaseUrl || "",
          apiKey: settings.apiKey || "",
          model: settings.model || "",
        },
        ctx
      ),
    ready: (settings) => {
      if (!settings.apiKey?.trim()) return { ok: false, reason: "missing_byok_key" };
      if (!settings.apiBaseUrl?.trim()) return { ok: false, reason: "missing_byok_base" };
      return { ok: true, reason: "ready" };
    },
    completion: COMPLETION_VIA_BYOK_KEY,
    ping: pingOpenAICompatible,
    explain: explainWithOpenAICompatible,
    chat: chatWithOpenAICompatible,
  },
  {
    id: "anthropic",
    settingsKeys: ["anthropicBaseUrl", "anthropicApiKey", "anthropicModel"],
    configFromSettings: (settings, ctx = {}) =>
      withLanguage(
        {
          apiBaseUrl: settings.anthropicBaseUrl || "",
          apiKey: settings.anthropicApiKey || "",
          model: settings.anthropicModel || "",
        },
        ctx
      ),
    ready: (settings) => {
      if (!settings.anthropicApiKey?.trim()) {
        return { ok: false, reason: "missing_anthropic_key" };
      }
      if (!settings.anthropicBaseUrl?.trim()) {
        return { ok: false, reason: "missing_anthropic_base" };
      }
      return { ok: true, reason: "ready" };
    },
    completion: COMPLETION_VIA_BYOK_KEY,
    ping: pingAnthropic,
    explain: explainWithAnthropic,
    chat: chatWithAnthropic,
  },
  {
    id: "wdimtm-cloud",
    settingsKeys: ["cloudBaseUrl", "cloudAccessToken"],
    configFromSettings: (settings, ctx = {}) =>
      withLanguage(
        {
          baseUrl: settings.cloudBaseUrl || "",
          accessToken: settings.cloudAccessToken || "",
        },
        ctx
      ),
    ready: (settings) => {
      // Production base URL is the default; users should not type it.
      // Ready = signed in (session token from Google). Packages/checkout are separate.
      const base = String(settings.cloudBaseUrl || "").trim() || DEFAULT_CLOUD_BASE_URL;
      if (!base) return { ok: false, reason: "missing_cloud_base" };
      if (!settings.cloudAccessToken?.trim()) {
        return { ok: false, reason: "missing_cloud_token" };
      }
      return { ok: true, reason: "ready" };
    },
    completion: COMPLETION_VIA_BYOK_KEY,
    ping: pingWdimtmCloud,
    explain: explainWithWdimtmCloud,
    chat: chatWithWdimtmCloud,
  },
  {
    id: "promptaas",
    settingsKeys: ["promptaasBaseUrl", "promptaasApiKey", "promptaasAgentId"],
    configFromSettings: (settings, ctx = {}) =>
      withLanguage(
        {
          baseUrl: settings.promptaasBaseUrl || "",
          apiKey: settings.promptaasApiKey || "",
          agentId: settings.promptaasAgentId || "",
        },
        ctx
      ),
    // Legacy client runtime: never offered in the UI (runtime-presets.js maps
    // the access mode onto WDIMTM Cloud), so readiness sends the user there.
    ready: () => ({ ok: false, reason: "use_cloud" }),
    // Import asks a narrower question and gets a narrower answer: the agent
    // endpoint is a fixed explainer, not an open completion endpoint.
    completion: { ok: false, reason: "promptaas" },
    ping: pingPromptaaS,
    explain: explainWithPromptaaS,
    chat: chatWithPromptaaS,
  },
];

/** @type {Map<string, RuntimeEntry>} */
const BY_ID = new Map(RUNTIMES.map((entry) => [entry.id, entry]));

/** Every runtime id the product knows about. */
export const RUNTIME_IDS = RUNTIMES.map((entry) => entry.id);

/** The offline default, and the fallback for an id nothing recognizes. */
export const DEFAULT_RUNTIME_ID = "mock";

/**
 * @param {string | undefined | null} id
 * @returns {RuntimeEntry | undefined}
 */
export function getRuntime(id) {
  return BY_ID.get(String(id || ""));
}

/**
 * Execution always resolves to something runnable: an unknown runtime id falls
 * back to mock rather than failing, which is what the explain switch and the
 * chat chain both did with their `default` branch.
 *
 * @param {string | undefined | null} id
 * @returns {RuntimeEntry}
 */
export function runtimeForExecution(id) {
  return getRuntime(id) || /** @type {RuntimeEntry} */ (BY_ID.get(DEFAULT_RUNTIME_ID));
}

/**
 * Readiness for the AI status banner and the popup badge.
 * @param {Record<string, any>} settings
 * @returns {RuntimeReadiness}
 */
export function readinessOf(settings) {
  const entry = getRuntime(settings?.runtime || DEFAULT_RUNTIME_ID);
  if (!entry) return { ok: false, reason: "unknown" };
  return entry.ready(settings || {});
}

/**
 * Whether conversation import can run against the selected runtime.
 * An unrecognized runtime is given the benefit of the doubt and checked for a
 * BYOK key, exactly as the hand-written rule did.
 *
 * @param {string | undefined | null} runtime
 * @returns {CompletionSupport}
 */
export function completionSupportOf(runtime) {
  return getRuntime(runtime)?.completion || COMPLETION_VIA_BYOK_KEY;
}
