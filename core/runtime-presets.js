/**
 * AI access product surface and BYOK provider presets.
 *
 * Product modes (what the user picks): mock | byok | cloud.
 * Agentaab is how WDIMTM Cloud is implemented on the server — not a client option.
 * Anthropic is a BYOK provider (different wire protocol), not its own access mode.
 */

/** @typedef {{
 *   id: string,
 *   label: string,
 *   labelZh: string,
 *   apiBaseUrl: string,
 *   model: string,
 *   protocol?: 'openai-compatible' | 'anthropic',
 * }} ByokPreset */

/** @type {ByokPreset[]} */
export const BYOK_PRESETS = [
  {
    id: "openai",
    label: "OpenAI",
    labelZh: "OpenAI",
    apiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    protocol: "openai-compatible",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    labelZh: "OpenRouter",
    apiBaseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    protocol: "openai-compatible",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    labelZh: "Anthropic（Claude）",
    apiBaseUrl: "https://api.anthropic.com/v1",
    model: "claude-opus-5",
    protocol: "anthropic",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    labelZh: "Ollama（本地）",
    apiBaseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
    protocol: "openai-compatible",
  },
  {
    id: "custom",
    label: "Custom…",
    labelZh: "自定义…",
    apiBaseUrl: "",
    model: "",
    protocol: "openai-compatible",
  },
];

/**
 * Native Anthropic runtime defaults (#64). Used when the BYOK provider is Claude.
 */
export const ANTHROPIC_DEFAULTS = {
  apiBaseUrl: "https://api.anthropic.com/v1",
  model: "claude-opus-5",
};

/** Model suggestions for the Options dropdown (any Messages-API model works). */
export const ANTHROPIC_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 (most capable)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (balanced)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
];

/**
 * Map product-facing access mode → runtime id.
 * @param {'mock' | 'byok' | 'cloud' | string} accessMode
 * @param {string} [byokProvider] BYOK preset id when accessMode is byok
 * @returns {'mock' | 'openai-compatible' | 'anthropic' | 'wdimtm-cloud'}
 */
export function accessModeToRuntime(accessMode, byokProvider = "openai") {
  if (accessMode === "cloud") return "wdimtm-cloud";
  if (accessMode === "byok") {
    const preset = BYOK_PRESETS.find((p) => p.id === byokProvider);
    if (preset?.protocol === "anthropic" || byokProvider === "anthropic") {
      return "anthropic";
    }
    return "openai-compatible";
  }
  // Legacy aliases: never offered in UI, still recognized if something old calls them.
  if (accessMode === "anthropic") return "anthropic";
  // Direct Agentaab was never a product path; it is how Cloud is built.
  if (accessMode === "promptaas") return "wdimtm-cloud";
  return "mock";
}

/**
 * @param {string} runtime
 * @returns {'mock' | 'byok' | 'cloud'}
 */
export function runtimeToAccessMode(runtime) {
  if (runtime === "wdimtm-cloud" || runtime === "promptaas") return "cloud";
  if (runtime === "openai-compatible" || runtime === "anthropic") return "byok";
  return "mock";
}

/**
 * Which BYOK provider card/fields to show for the current settings.
 * @param {{ runtime?: string, apiBaseUrl?: string } | null | undefined} settings
 * @returns {string}
 */
export function byokProviderForSettings(settings) {
  if (settings?.runtime === "anthropic") return "anthropic";
  const base = String(settings?.apiBaseUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!base) return "openai";
  for (const p of BYOK_PRESETS) {
    if (p.id === "custom" || p.protocol === "anthropic") continue;
    if (p.apiBaseUrl.replace(/\/$/, "") === base) return p.id;
  }
  return "custom";
}

/**
 * Whether the selected runtime is ready for real inference.
 * @param {import('./settings.js').DEFAULT_SETTINGS extends infer S ? S : any} settings
 */
export function isRuntimeReady(settings) {
  const runtime = settings.runtime || "mock";
  if (runtime === "mock") return { ok: false, reason: "mock" };
  if (runtime === "openai-compatible") {
    if (!settings.apiKey?.trim()) return { ok: false, reason: "missing_byok_key" };
    if (!settings.apiBaseUrl?.trim()) return { ok: false, reason: "missing_byok_base" };
    return { ok: true, reason: "ready" };
  }
  if (runtime === "anthropic") {
    if (!settings.anthropicApiKey?.trim()) {
      return { ok: false, reason: "missing_anthropic_key" };
    }
    if (!settings.anthropicBaseUrl?.trim()) {
      return { ok: false, reason: "missing_anthropic_base" };
    }
    return { ok: true, reason: "ready" };
  }
  // Legacy client runtime: treat like cloud readiness for status purposes.
  if (runtime === "promptaas") {
    return {
      ok: false,
      reason: "use_cloud",
    };
  }
  if (runtime === "wdimtm-cloud") {
    // Production base URL is the default; users should not type it.
    // Ready = signed in (session token from Google). Packages/checkout are separate.
    const base =
      String(settings.cloudBaseUrl || "").trim() || "https://cloud.wdimtm.com";
    if (!base) return { ok: false, reason: "missing_cloud_base" };
    if (!settings.cloudAccessToken?.trim()) {
      return { ok: false, reason: "missing_cloud_token" };
    }
    return { ok: true, reason: "ready" };
  }
  return { ok: false, reason: "unknown" };
}
