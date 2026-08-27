/**
 * Runtime adapter boundary.
 * WDIMTM browser code talks only to this module for model execution.
 *
 * Dogfood path: openai-compatible single-shot is the recommended real runtime.
 * PromptaaS remains optional (future routing / billing / multi-step).
 */

import { assertBoundedRequest } from "../context-bounds.js";
import { enrichResponse, suggestMemory } from "../followups.js";
import {
  answerLanguageInstruction,
  resolveAnswerLanguage,
  resolveUiLocale,
} from "../i18n.js";
import { resolveLens } from "../lenses.js";
import { toExplainMemories } from "../memory-context.js";
import { capabilityForMode, normalizeMode } from "../modes.js";
import { DEFAULT_SETTINGS } from "../settings-defaults.js";
import {
  buildChatSearchQuery,
  buildSearchQuery,
  formatWebEvidence,
  humanizeSearchError,
  isWebSearchConfigured,
  modeWantsWebSearch,
  runWebSearch,
} from "../web-search.js";
import { explainWithAnthropic } from "./anthropic.js";
import { runChat } from "./chat.js";
import { explainWithMock } from "./mock.js";
import { explainWithOpenAICompatible } from "./openai-compatible.js";
import { explainWithPromptaaS } from "./promptaas.js";
import { explainWithWdimtmCloud } from "./wdimtm-cloud.js";

/**
 * Configuration and the memory provider are supplied by the caller rather than
 * fetched here.
 *
 * The extension reads them from chrome.storage; WDIMTM Cloud reads them from
 * D1. Neither is special-cased inside the runtime, which is what lets the same
 * explain mean the same thing in both places — and what lets this module live
 * in a host-free core at all.
 *
 * @typedef {Object} RuntimeDeps
 * @property {typeof DEFAULT_SETTINGS} settings
 * @property {import('../lib/memory.js').MemoryProvider} [memoryProvider]
 * @property {string} [hostLocale] the host's UI language; see lib/host-locale.js
 */

export { DEFAULT_SETTINGS };

/**
 * @param {import('../lib/types.js').ExplainRequest & { mode?: string }} request
 * @param {{ onChunk?: (text: string) => void, signal?: AbortSignal }} [opts]
 * @returns {Promise<import('../lib/types.js').ExplainResponse>}
 */
export async function explain(request, opts = {}) {
  assertBoundedRequest(request);

  const settings = requireSettings(opts, "explain");
  const lens = resolveLens(
    request.lens,
    settings.defaultLensId,
    settings.customLenses || [],
    settings.lensOverrides || {}
  );

  const provider = opts.memoryProvider;
  const query = `${request.selection}\n${request.page?.title || ""}\n${lens.id}`;
  const relevant =
    !provider || settings.memoryProvider === "none" ? [] : await provider.search(query, 6);

  // Profile is a first-class field; also fold free-form profileText into memories for providers.
  const profileText = (settings.profileText || "").trim();
  const memoryItems =
    request.memories?.length > 0
      ? request.memories
      : toExplainMemories(profileText, relevant);

  // Prefer explicit profile field over duplicated type=profile memory rows.
  let profile = (request.profile || profileText || "").trim();
  const memories = [];
  for (const m of memoryItems) {
    if (!m?.content) continue;
    if (m.type === "profile") {
      if (!profile) profile = String(m.content).trim();
      continue;
    }
    memories.push({ type: m.type, content: String(m.content).trim() });
  }

  const answerLanguage = resolveAnswerLanguage(settings, request.selection || "", opts.hostLocale);
  const uiLocale = resolveUiLocale(settings.uiLocale, opts.hostLocale);
  const depth = settings.answerDepth || "normal";
  const depthInstruction =
    depth === "short"
      ? "Keep the answer very short (2–4 lines)."
      : depth === "detailed"
        ? "Provide a thorough but scannable answer (up to ~12 short lines or a tight list)."
        : "Keep the answer concise (about 3–8 short lines).";

  const mode = normalizeMode(request.mode || "explain", { lensId: lens.id });
  const cap = capabilityForMode(mode);

  // Optional web search for verify / research (and fact-check lens on explain).
  /** @type {import('../lib/web-search.js').WebSearchResult | null} */
  let webSearch = null;
  if (isWebSearchConfigured(settings) && modeWantsWebSearch(mode, lens.id)) {
    const query = buildSearchQuery(request.selection, request.page?.title || "");
    webSearch = await runWebSearch({
      provider: settings.webSearchProvider,
      apiKey: settings.webSearchApiKey || "",
      query,
      maxResults: settings.webSearchMaxResults || 5,
    });
  }

  /** @type {import('../lib/types.js').ExplainRequest & Record<string, unknown>} */
  const full = {
    ...request,
    selection: request.selection,
    page: request.page,
    lens: {
      id: lens.id,
      instructions: lens.instructions,
    },
    profile: profile || undefined,
    memories,
    mode,
    answerLanguage,
    answerDepth: depth,
    languageInstruction: `${answerLanguageInstruction(answerLanguage)} ${depthInstruction}`,
    followUpQuestion: request.followUpQuestion
      ? String(request.followUpQuestion).slice(0, 400)
      : undefined,
    webEvidence: webSearch ? formatWebEvidence(webSearch) : undefined,
    webSearchMeta: webSearch
      ? {
          used: webSearch.used,
          provider: webSearch.provider,
          error: webSearch.error,
          resultCount: webSearch.hits?.length || 0,
        }
      : undefined,
  };

  const wantStream = settings.stream !== false && typeof opts.onChunk === "function";
  // The signal always rides along, streaming or not: cancelling has to stop the
  // request, not just hide the popover it came from (#18).
  const streamOpts = {
    ...(wantStream ? { onChunk: opts.onChunk } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  /** @type {import('../lib/types.js').ExplainResponse} */
  let res;
  switch (settings.runtime) {
    case "openai-compatible":
      res = await explainWithOpenAICompatible(full, {
        apiBaseUrl: settings.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl,
        apiKey: settings.apiKey || "",
        model: settings.model || DEFAULT_SETTINGS.model,
        languageInstruction: full.languageInstruction,
        ...streamOpts,
      });
      break;
    case "anthropic":
      res = await explainWithAnthropic(full, {
        apiBaseUrl: settings.anthropicBaseUrl || DEFAULT_SETTINGS.anthropicBaseUrl,
        apiKey: settings.anthropicApiKey || "",
        model: settings.anthropicModel || DEFAULT_SETTINGS.anthropicModel,
        languageInstruction: full.languageInstruction,
        ...streamOpts,
      });
      break;
    case "wdimtm-cloud":
      // Hosted service mode — same client, same contract, server-side credentials.
      res = await explainWithWdimtmCloud(full, {
        baseUrl: settings.cloudBaseUrl || "",
        accessToken: settings.cloudAccessToken || "",
        languageInstruction: full.languageInstruction,
        ...streamOpts,
      });
      break;
    case "promptaas":
      // Optional provider — same ExplainRequest contract; future home for routing/tools.
      res = await explainWithPromptaaS(full, {
        baseUrl: settings.promptaasBaseUrl || DEFAULT_SETTINGS.promptaasBaseUrl,
        apiKey: settings.promptaasApiKey || "",
        agentId: settings.promptaasAgentId || DEFAULT_SETTINGS.promptaasAgentId,
        languageInstruction: full.languageInstruction,
        ...streamOpts,
      });
      break;
    case "mock":
    default:
      res = await explainWithMock(full, {
        ...streamOpts,
        forceZh: answerLanguage === "zh_CN",
      });
      break;
  }

  const zhUi = uiLocale === "zh_CN" || answerLanguage === "zh_CN";
  const enriched = enrichResponse(res, mode, zhUi, {
    selection: full.selection,
    lensId: lens.id,
  });

  if (!enriched.memorySuggestion && settings.memoryProvider !== "none") {
    enriched.memorySuggestion = suggestMemory(full, enriched);
  }
  // Final guard: never accept huge / dump-like memory suggestions
  if (enriched.memorySuggestion?.content) {
    const c = enriched.memorySuggestion.content.trim();
    if (c.length < 8 || c.length > 280) {
      enriched.memorySuggestion = null;
    }
  }

  enriched.meta = {
    ...(enriched.meta || {}),
    mode,
    lensId: lens.id,
    personalization:
      profile && memories.length
        ? "rich"
        : profile || memories.length
          ? "light"
          : "none",
    capability: cap.kind,
    capabilityStatus: cap.status,
    webSearch: full.webSearchMeta || { used: false },
  };

  return enriched;
}

/**
 * Multi-turn page chat (escalation from popover).
 * Optional web search (same settings as verify/research) + optional streaming.
 * @param {{
 *   selection: string,
 *   page: { url: string, title: string, context?: string },
 *   lens?: { id: string, instructions?: string },
 *   messages: Array<{ role: 'user' | 'assistant', content: string }>,
 * }} request
 * @param {{ onChunk?: (text: string) => void, signal?: AbortSignal }} [opts]
 */
export async function chat(request, opts = {}) {
  if (!request?.page?.url) throw new Error("Chat requires page.url.");
  if (!request.messages?.length) throw new Error("Chat requires messages.");

  const settings = requireSettings(opts, "chat");
  const lens = resolveLens(
    request.lens,
    settings.defaultLensId,
    settings.customLenses || [],
    settings.lensOverrides || {}
  );
  const provider = opts.memoryProvider;
  const query = `${request.selection || ""}\n${request.page?.title || ""}\n${lens.id}`;
  const relevant =
    !provider || settings.memoryProvider === "none" ? [] : await provider.search(query, 6);
  const profileText = (settings.profileText || "").trim();
  const memories = toExplainMemories(profileText, relevant);
  const lastUser =
    [...(request.messages || [])].reverse().find((m) => m.role === "user")?.content ||
    "";
  const answerLanguage = resolveAnswerLanguage(
    settings,
    request.selection || lastUser,
    opts.hostLocale
  );
  const languageInstruction = answerLanguageInstruction(answerLanguage);

  /** @type {import('../lib/web-search.js').WebSearchResult | null} */
  let webSearch = null;
  const searchConfigured = isWebSearchConfigured(settings);
  const zhAnswer = answerLanguage === "zh_CN";

  /** @type {{
   *   used: boolean,
   *   status: string,
   *   provider?: string,
   *   error?: string,
   *   humanError?: string,
   *   resultCount?: number,
   *   query?: string,
   * }} */
  let webSearchMeta = {
    used: false,
    status: "not_configured",
    provider: settings.webSearchProvider || "none",
  };

  // Page chat: search every turn when configured (mode "chat").
  if (searchConfigured && modeWantsWebSearch("chat", lens.id)) {
    const searchQuery = buildChatSearchQuery(
      lastUser,
      request.selection || "",
      request.page?.title || ""
    );
    webSearch = await runWebSearch({
      provider: settings.webSearchProvider,
      apiKey: settings.webSearchApiKey || "",
      query: searchQuery,
      maxResults: settings.webSearchMaxResults || 5,
    });
    if (webSearch.used && webSearch.hits?.length) {
      webSearchMeta = {
        used: true,
        status: "ok",
        provider: webSearch.provider,
        resultCount: webSearch.hits.length,
        query: webSearch.query,
      };
    } else if (webSearch.error) {
      webSearchMeta = {
        used: false,
        status: "failed",
        provider: webSearch.provider,
        error: webSearch.error,
        humanError: humanizeSearchError(webSearch.error, { zh: zhAnswer }),
        resultCount: 0,
        query: webSearch.query,
      };
    } else {
      webSearchMeta = {
        used: false,
        status: "empty",
        provider: webSearch.provider,
        resultCount: 0,
        query: webSearch.query,
      };
    }
  }

  const wantStream = settings.stream !== false && typeof opts.onChunk === "function";

  return runChat(
    {
      selection: request.selection || "",
      page: request.page,
      lens: { id: lens.id, instructions: lens.instructions },
      memories,
      messages: request.messages,
      answerLanguage,
      webEvidence:
        webSearch && webSearch.used ? formatWebEvidence(webSearch) : undefined,
      webSearchMeta,
    },
    {
      runtime: settings.runtime || "mock",
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      anthropicBaseUrl: settings.anthropicBaseUrl,
      anthropicApiKey: settings.anthropicApiKey,
      anthropicModel: settings.anthropicModel,
      promptaasBaseUrl: settings.promptaasBaseUrl,
      promptaasApiKey: settings.promptaasApiKey,
      promptaasAgentId: settings.promptaasAgentId,
      cloudBaseUrl: settings.cloudBaseUrl,
      cloudAccessToken: settings.cloudAccessToken,
      languageInstruction,
      ...(wantStream ? { onChunk: opts.onChunk } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }
  );
}

/**
 * A missing config is a wiring mistake, not a runtime condition — failing
 * loudly here beats silently explaining with defaults the user never chose.
 *
 * @param {{ settings?: unknown }} opts
 * @param {string} where
 */
function requireSettings(opts, where) {
  if (!opts?.settings) {
    throw new Error(`${where}() needs settings — the caller supplies them now.`);
  }
  return opts.settings;
}
