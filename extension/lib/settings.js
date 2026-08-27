/**
 * Unified settings access for runtime, lenses, profile, memory.
 */

import { resolveUiLocale, STRINGS } from "../../core/i18n.js";
import { browserLocale } from "./host-locale.js";
import { applyOverride, BUILTIN_LENSES } from "../../core/lenses.js";
import { DEFAULT_SETTINGS, SECRET_KEYS } from "../../core/settings-defaults.js";
import { isHostDenied } from "../../core/site-scope.js";

// Re-exported so every existing import site keeps working; the definitions
// live in a host-free module now.
export { DEFAULT_SETTINGS, SECRET_KEYS };

/** @typedef {import('./lenses.js').LensDef} LensDef */

/** @param {Record<string, unknown>} obj */
function splitSecrets(obj) {
  /** @type {Record<string, unknown>} */
  const secrets = {};
  /** @type {Record<string, unknown>} */
  const rest = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.includes(/** @type {never} */ (k))) secrets[k] = v;
    else rest[k] = v;
  }
  return { secrets, rest };
}

/**
 * One-time move of secrets written by versions that kept them in .sync.
 * Deletes them from .sync so they stop being uploaded — leaving a copy behind
 * would defeat the whole point of the split.
 * @param {Record<string, unknown>} syncStored
 */
async function migrateSecretsOutOfSync(syncStored) {
  /** @type {Record<string, unknown>} */
  const stranded = {};
  for (const k of SECRET_KEYS) {
    const v = syncStored[k];
    if (typeof v === "string" && v.trim()) stranded[k] = v;
  }
  if (!Object.keys(stranded).length) return stranded;
  try {
    // Defaults must be empty strings, not the stranded values — passing the
    // latter makes an absent local key read back as already-present.
    const local = await chrome.storage.local.get(
      Object.fromEntries(Object.keys(stranded).map((k) => [k, ""]))
    );
    // A value already in local storage wins — it is the newer one.
    /** @type {Record<string, unknown>} */
    const toWrite = {};
    for (const [k, v] of Object.entries(stranded)) {
      if (!String(local[k] || "").trim()) toWrite[k] = v;
    }
    if (Object.keys(toWrite).length) await chrome.storage.local.set(toWrite);
    await chrome.storage.sync.remove(Object.keys(stranded));
  } catch {
    // Migration is best-effort: a failure here must not break reading settings.
  }
  return stranded;
}

/**
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  const { secrets: secretDefaults, rest: syncDefaults } = splitSecrets(DEFAULT_SETTINGS);
  const [syncStored, localStored] = await Promise.all([
    chrome.storage.sync.get({ ...syncDefaults, ...secretDefaults }),
    chrome.storage.local.get(secretDefaults),
  ]);
  const migrated = await migrateSecretsOutOfSync(syncStored);
  const stored = {
    ...syncStored,
    // Local wins; a stranded .sync value is the fallback until migration lands.
    ...migrated,
    ...Object.fromEntries(
      Object.entries(localStored).filter(([, v]) => String(v || "").trim())
    ),
  };
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    customLenses: Array.isArray(stored.customLenses)
      ? stored.customLenses
      : DEFAULT_SETTINGS.customLenses,
    lensOverrides:
      stored.lensOverrides && typeof stored.lensOverrides === "object"
        ? stored.lensOverrides
        : DEFAULT_SETTINGS.lensOverrides,
    denylist: Array.isArray(stored.denylist) ? stored.denylist : DEFAULT_SETTINGS.denylist,
    domainLenses: Array.isArray(stored.domainLenses)
      ? stored.domainLenses
      : DEFAULT_SETTINGS.domainLenses,
    enabled: stored.enabled !== false,
  };
}

/**
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 */
export async function saveSettings(patch) {
  const { secrets, rest } = splitSecrets(patch);
  await Promise.all([
    Object.keys(rest).length ? chrome.storage.sync.set(rest) : Promise.resolve(),
    Object.keys(secrets).length ? chrome.storage.local.set(secrets) : Promise.resolve(),
  ]);
}

/**
 * Safe subset for content scripts (no secrets).
 * @param {typeof DEFAULT_SETTINGS} settings
 */
export function publicSettings(settings) {
  const resolvedUi = resolveUiLocale(settings.uiLocale, browserLocale());
  return {
    runtime: settings.runtime,
    defaultLensId: settings.defaultLensId,
    lensMode: settings.lensMode === "manual" ? "manual" : "auto",
    profileText: settings.profileText || "",
    customLenses: (settings.customLenses || []).map((l) => ({
      id: l.id,
      name: l.name,
      nameZh: l.nameZh,
      hint: l.hint,
      instructions: l.instructions,
    })),
    builtinLenses: BUILTIN_LENSES.map((l) => {
      const applied = applyOverride(l, settings.lensOverrides?.[l.id]);
      return {
        id: applied.id,
        name: applied.name,
        nameZh: applied.nameZh,
        hint: applied.hint,
        instructions: applied.instructions,
        overridden: Boolean(settings.lensOverrides?.[l.id]),
      };
    }),
    lensOverrides: settings.lensOverrides || {},
    domainLenses: Array.isArray(settings.domainLenses) ? settings.domainLenses : [],
    hasApiKey: Boolean(
      settings.apiKey ||
        settings.anthropicApiKey ||
        settings.promptaasApiKey ||
        settings.cloudAccessToken
    ),
    model: settings.runtime === "anthropic" ? settings.anthropicModel : settings.model,
    memoryProvider: settings.memoryProvider,
    stream: settings.stream !== false,
    hasProfile: Boolean(settings.profileText?.trim()),
    uiLocale: settings.uiLocale || "auto",
    answerLanguage: settings.answerLanguage || "auto",
    resolvedUiLocale: resolvedUi,
    uiStrings: STRINGS[resolvedUi] || STRINGS.en,
    enabled: settings.enabled !== false,
    denylist: Array.isArray(settings.denylist) ? settings.denylist : [],
    answerDepth: settings.answerDepth || "normal",
    theme: settings.theme || "system",
    accountMode: settings.accountMode === "cloud" ? "cloud" : "local",
    syncPreferences: settings.syncPreferences !== false,
    syncChatHistory: Boolean(settings.syncChatHistory),
    syncSecrets: Boolean(settings.syncSecrets),
    lastSyncedAt: settings.lastSyncedAt || "",
    /**
     * Where a user goes when the hosted balance runs out (#41). Empty for BYOK
     * and mock — there is nothing to top up, and the popover then offers the
     * only real alternative instead.
     */
    topUpUrl: topUpUrlFor(settings),
    // Research is a durable server-side job (#52), so it exists only when a
    // signed-in cloud does. The bubble uses this to decide whether offering
    // "Research this" would be a promise it cannot keep.
    researchReady: Boolean(
      (String(settings.cloudBaseUrl || "").trim() || "https://cloud.wdimtm.com") &&
        String(settings.cloudAccessToken || "").trim()
    ),
    webSearchEnabled: Boolean(settings.webSearchEnabled),
    webSearchProvider: settings.webSearchProvider || "none",
    hasWebSearchKey: Boolean(String(settings.webSearchApiKey || "").trim()),
  };
}

/**
 * The "top up / manage plan" destination for the current paid path, if any.
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {string}
 */
export function topUpUrlFor(settings) {
  // Hosted path only — Agentaab is an internal Cloud implementation detail.
  if (settings?.runtime === "wdimtm-cloud" || settings?.runtime === "promptaas") {
    return String(settings.cloudSignUpUrl || settings.promptaasSubscribeUrl || "").trim();
  }
  return "";
}

// Re-exported so existing import sites keep working; the definition lives in
// core/site-scope.js, which the popup and the content script share.
export { isHostDenied };

/**
 * Restricted browser pages where content scripts should no-op if injected.
 * @param {string} href
 */
export function isRestrictedUrl(href) {
  try {
    const u = new URL(href);
    if (u.protocol === "chrome:" || u.protocol === "chrome-extension:") return true;
    if (u.protocol === "edge:" || u.protocol === "about:") return true;
    if (u.protocol === "devtools:") return true;
    return false;
  } catch {
    return true;
  }
}
