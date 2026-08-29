/**
 * Anthropic Messages API — native Claude runtime (#64).
 *
 * Sibling of openai-compatible.js: same ExplainRequest contract, same
 * classifyRuntimeError plumbing, same onChunk streaming callback. Only the
 * wire protocol differs:
 *
 *   POST {base}/messages                    (not /chat/completions)
 *   x-api-key + anthropic-version headers   (not Authorization: Bearer)
 *   system as a top-level field             (not a role:"system" message)
 *   content[] blocks / content_block_delta   (not choices[].message / delta)
 *
 * No temperature: sampling parameters are rejected with a 400 on current
 * Claude models.
 */

import {
  buildExplainContext,
  buildModelMessages,
} from "../explain-context.js";
import { extractResponseTrailers } from "../followups.js";
import { capabilityForMode } from "../modes.js";
import { createRequestTimeout, describeAbort, fetchWithTimeout } from "../request-timeout.js";
import { classifyRuntimeError } from "../runtime-errors.js";

export const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

/**
 * Thinking is on by default on current Claude models and shares the
 * max_tokens ceiling with the visible answer. Answer length is steered by the
 * system prompt's depth line, so max_tokens is only a truncation guard — give
 * it headroom instead of budgeting it like an OpenAI completion.
 */
const THINKING_HEADROOM_TOKENS = 4096;

/**
 * @param {string} apiKey
 * @returns {Record<string, string>}
 */
export function anthropicHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    // MV3 service-worker fetch carries a chrome-extension:// Origin, which the
    // API treats as a browser call and rejects without this opt-in header.
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

/**
 * Split the shared explain messages into Anthropic's shape: system is a
 * top-level string, messages carry only user/assistant turns.
 * @param {{ role: string, content: string }[]} messages
 * @returns {{ system: string, messages: { role: 'user' | 'assistant', content: string }[] }}
 */
export function splitSystemMessages(messages) {
  const system = [];
  /** @type {{ role: 'user' | 'assistant', content: string }[]} */
  const turns = [];
  for (const m of messages || []) {
    if (!m?.content) continue;
    if (m.role === "system") {
      system.push(String(m.content));
      continue;
    }
    turns.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content),
    });
  }
  return { system: system.join("\n\n"), messages: turns };
}

/**
 * @param {import('../lib/types.js').ExplainRequest & {
 *   mode?: string,
 *   followUpQuestion?: string,
 *   profile?: string,
 *   answerDepth?: string,
 *   languageInstruction?: string,
 * }} request
 * @param {{
 *   apiBaseUrl: string,
 *   apiKey: string,
 *   model: string,
 *   languageInstruction?: string,
 *   onChunk?: (text: string) => void,
 * }} config
 * @returns {Promise<import('../lib/types.js').ExplainResponse>}
 */
export async function explainWithAnthropic(request, config) {
  const base = (config.apiBaseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/$/, "");
  const model = config.model || DEFAULT_ANTHROPIC_MODEL;

  if (!config.apiKey) {
    throw new Error(classifyRuntimeError(new Error("API key is required"), "byok").message);
  }

  const ctx = buildExplainContext({
    ...request,
    languageInstruction: config.languageInstruction || request.languageInstruction,
  });
  const { system, messages } = splitSystemMessages(buildModelMessages(ctx));
  const stream = Boolean(config.onChunk);
  const maxTokens = tokenBudgetForMode(ctx.mode) + THINKING_HEADROOM_TOKENS;

  // Same silence clocks as the other runtimes (#18) — long streaming answers
  // are fine; a quiet connection is not.
  const deadline = createRequestTimeout({
    ...(config.timeouts || {}),
    externalSignal: config.signal,
  });
  const res = await fetchWithTimeout(
    () =>
      fetch(`${base}/messages`, {
        method: "POST",
        signal: deadline.signal,
        headers: anthropicHeaders(config.apiKey),
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          stream,
          system,
          messages,
        }),
      }),
    deadline
  ).catch((err) => {
    deadline.settle();
    throw err;
  });

  if (!res.ok) {
    deadline.settle();
    const body = await res.text().catch(() => "");
    throw new Error(
      classifyRuntimeError(
        new Error(`LLM request failed (${res.status}): ${body.slice(0, 200)}`),
        "byok"
      ).message
    );
  }

  const cap = capabilityForMode(ctx.mode);
  const meta = {
    mode: ctx.mode,
    lensId: ctx.lens.id,
    personalization: ctx.flags.personalization,
    capability: cap.kind,
    capabilityStatus: cap.status,
  };

  if (stream && res.body) {
    let raw;
    try {
      raw = await readAnthropicTextStream(res, config.onChunk, undefined, deadline);
    } catch (err) {
      throw deadline.signal.aborted ? describeAbort(deadline) : err;
    } finally {
      deadline.settle();
    }
    const parsed = extractResponseTrailers(raw);
    return {
      explanation: parsed.explanation,
      followUps: parsed.followUps,
      memorySuggestion: parsed.memorySuggestion,
      whyItMatters: parsed.whyItMatters,
      runtime: "anthropic",
      meta,
    };
  }

  deadline.settle();
  const data = await res.json();
  if (data?.stop_reason === "refusal") {
    throw new Error("Claude declined this request (safety refusal). Try rephrasing the selection.");
  }
  const text = flattenContent(data?.content).trim();
  if (!text) throw new Error("Empty response from model.");
  const parsed = extractResponseTrailers(text);
  if (config.onChunk) config.onChunk(parsed.explanation);

  return {
    explanation: parsed.explanation,
    followUps: parsed.followUps,
    memorySuggestion: parsed.memorySuggestion,
    whyItMatters: parsed.whyItMatters,
    runtime: "anthropic",
    meta,
  };
}

/**
 * Multi-turn page chat over the Messages API: system stays top-level, no
 * temperature, and the same SSE reader as explain.
 *
 * @param {{
 *   system: string,
 *   messages: Array<{ role: 'user' | 'assistant', content: string }>,
 * }} request
 * @param {{
 *   apiBaseUrl?: string,
 *   apiKey?: string,
 *   model?: string,
 *   onChunk?: (text: string) => void,
 *   signal?: AbortSignal,
 * }} config
 * @returns {Promise<{ reply: string, runtime: string }>}
 */
export async function chatWithAnthropic(request, config) {
  const base = (config.apiBaseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/$/, "");
  const model = config.model || DEFAULT_ANTHROPIC_MODEL;
  if (!config.apiKey) throw new Error("API key is required for chat.");
  const stream = Boolean(config.onChunk);

  const deadline = createRequestTimeout({ externalSignal: config.signal });
  const res = await fetchWithTimeout(
    () =>
      fetch(`${base}/messages`, {
        method: "POST",
        signal: deadline.signal,
        headers: anthropicHeaders(config.apiKey),
        body: JSON.stringify({
          model,
          // Headroom for adaptive thinking, which shares the max_tokens ceiling.
          max_tokens: 5000,
          stream,
          system: request.system,
          messages: (request.messages || []).map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content || ""),
          })),
        }),
      }),
    deadline
  ).catch((err) => {
    deadline.settle();
    throw err;
  });

  if (!res.ok) {
    deadline.settle();
    const body = await res.text().catch(() => "");
    throw new Error(`Chat failed (${res.status}): ${body.slice(0, 200)}`);
  }

  if (stream && res.body) {
    try {
      const text = await readAnthropicTextStream(
        res,
        config.onChunk,
        "Empty streamed chat response.",
        deadline
      );
      return { reply: text, runtime: "anthropic" };
    } catch (err) {
      throw deadline.signal.aborted ? describeAbort(deadline) : err;
    } finally {
      deadline.settle();
    }
  }

  deadline.settle();
  const data = await res.json();
  const text = flattenContent(data?.content).trim();
  if (!text) throw new Error("Empty chat response.");
  if (config.onChunk) config.onChunk(text);
  return { reply: text, runtime: "anthropic" };
}

/**
 * Connectivity probe for "Test connection".
 * @param {{ apiBaseUrl?: string, apiKey?: string, model?: string }} config
 * @returns {Promise<{ ok: boolean, message: string, code?: string }>}
 */
export async function pingAnthropic(config) {
  const base = (config.apiBaseUrl || "").replace(/\/$/, "");
  const model = config.model || DEFAULT_ANTHROPIC_MODEL;
  if (!base) {
    return {
      ok: false,
      code: "missing_anthropic_base",
      message: "Anthropic base URL is required.",
    };
  }
  if (!config.apiKey?.trim()) {
    return { ok: false, code: "missing_anthropic_key", message: "Anthropic API key is required." };
  }

  try {
    const res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: anthropicHeaders(config.apiKey.trim()),
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: "Reply with the single word: ok",
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const classified = classifyRuntimeError(
        new Error(`LLM request failed (${res.status}): ${body.slice(0, 120)}`),
        "byok"
      );
      return { ok: false, code: classified.code, message: classified.message };
    }
    const data = await res.json();
    const text = flattenContent(data?.content).trim();
    return {
      ok: true,
      code: "ready",
      message: text
        ? `Connected. Model replied: “${text.slice(0, 40)}”`
        : "Connected. Empty content but HTTP OK.",
    };
  } catch (err) {
    const classified = classifyRuntimeError(err, "byok");
    return { ok: false, code: classified.code, message: classified.message };
  }
}

/**
 * Messages responses are a list of content blocks; only text blocks carry the
 * answer (thinking blocks are empty unless summaries are requested).
 * @param {unknown} content
 * @returns {string}
 */
export function flattenContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

/** @param {string} mode */
function tokenBudgetForMode(mode) {
  if (mode === "more" || mode === "research" || mode === "probe") return 900;
  if (mode === "verify" || mode === "opportunity") return 750;
  if (mode === "why_it_matters") return 700;
  return 650;
}

/**
 * Read a Messages API SSE stream, forwarding text deltas to onChunk.
 * Shared with the page-chat path in chat.js.
 * @param {Response} res
 * @param {(t: string) => void} [onChunk]
 * @param {string} [emptyMessage]
 */
export async function readAnthropicTextStream(
  res,
  onChunk,
  emptyMessage = "Empty streamed response from model.",
  deadline
) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    deadline?.chunkReceived?.();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        if (json.type === "error") {
          const detail = json.error?.message || json.error?.type || "stream error";
          throw new Error(classifyRuntimeError(new Error(detail), "byok").message);
        }
        // Thinking deltas arrive as thinking_delta and are skipped on purpose.
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
          const delta = json.delta.text;
          if (delta) {
            full += delta;
            onChunk?.(delta);
            deadline?.chunkReceived?.();
          }
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue; // partial / non-JSON keepalive
        throw err;
      }
    }
  }

  if (!full.trim()) throw new Error(emptyMessage);
  return full.trim();
}

// Re-export for tests / tooling that want the same messages the runtime sends.
export { buildExplainContext, buildModelMessages } from "../explain-context.js";
