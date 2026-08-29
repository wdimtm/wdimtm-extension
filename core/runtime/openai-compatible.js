/**
 * OpenAI-compatible chat completions — primary dogfood runtime.
 *
 * One request: structured context (page / profile / memories / lens / mode)
 * → personalized explanation + follow-up trailer (+ optional memory trailer).
 */

import {
  buildExplainContext,
  buildModelMessages,
} from "../explain-context.js";
import { extractResponseTrailers } from "../followups.js";
import { hasImageAttachments, toProviderMessages } from "../images.js";
import { capabilityForMode } from "../modes.js";
import {
  createRequestTimeout,
  describeAbort,
  fetchWithTimeout,
} from "../request-timeout.js";
import { classifyRuntimeError } from "../runtime-errors.js";

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

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
 *   onUsage?: (usage: { promptTokens: number, completionTokens: number }) => void,
 *   signal?: AbortSignal,
 *   timeouts?: { firstByteMs?: number, stallMs?: number },
 * }} config
 * @returns {Promise<import('../lib/types.js').ExplainResponse>}
 */
export async function explainWithOpenAICompatible(request, config) {
  const base = (config.apiBaseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
  const model = config.model || DEFAULT_OPENAI_MODEL;

  if (!config.apiKey) {
    throw new Error(classifyRuntimeError(new Error("API key is required"), "byok").message);
  }

  const ctx = buildExplainContext({
    ...request,
    languageInstruction: config.languageInstruction || request.languageInstruction,
  });
  const messages = buildModelMessages(ctx);
  const stream = Boolean(config.onChunk);
  const maxTokens = tokenBudgetForMode(ctx.mode);

  // No request may hang without a ceiling (#18). The clock is on silence, not
  // on total duration — a long answer that keeps streaming is not a fault.
  const deadline = createRequestTimeout({
    ...(config.timeouts || {}),
    externalSignal: config.signal,
  });
  const res = await fetchWithTimeout(
    () =>
      fetch(`${base}/chat/completions`, {
        method: "POST",
        signal: deadline.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: maxTokens,
          stream,
          // Only asked for when someone is accounting for the spend (WDIMTM Cloud).
          // Not every OpenAI-compatible server accepts this field, so BYOK — which
          // never passes onUsage — keeps sending the plain payload it always has.
          ...(stream && config.onUsage
            ? { stream_options: { include_usage: true } }
            : {}),
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
      raw = await readSSE(res, config.onChunk, config.onUsage, deadline);
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
      runtime: "openai-compatible",
      meta,
    };
  }

  const data = await res.json().finally(() => deadline.settle());
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty response from model.");
  // Token counts matter to whoever pays for them (cloud usage accounting, #51).
  config.onUsage?.({
    promptTokens: Number(data?.usage?.prompt_tokens) || 0,
    completionTokens: Number(data?.usage?.completion_tokens) || 0,
  });
  const parsed = extractResponseTrailers(text);
  if (config.onChunk) config.onChunk(parsed.explanation);

  return {
    explanation: parsed.explanation,
    followUps: parsed.followUps,
    memorySuggestion: parsed.memorySuggestion,
    whyItMatters: parsed.whyItMatters,
    runtime: "openai-compatible",
    meta,
  };
}

/**
 * Multi-turn page chat over the same protocol.
 *
 * Chat is not explain: the caller has already built the system prompt and owns
 * the turn history, so this sends them as they are instead of going through
 * buildExplainContext. What it must not do is re-implement the transport —
 * same endpoint, same auth, same SSE reader as above.
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
export async function chatWithOpenAICompatible(request, config) {
  const base = (config.apiBaseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
  const model = config.model || DEFAULT_OPENAI_MODEL;
  if (!config.apiKey) throw new Error("API key is required for chat.");
  const messages = request.messages || [];
  const stream = Boolean(config.onChunk);
  const withImages = hasImageAttachments(messages);

  const deadline = createRequestTimeout({ externalSignal: config.signal });
  const res = await fetchWithTimeout(
    () =>
      fetch(`${base}/chat/completions`, {
        method: "POST",
        signal: deadline.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.5,
          max_tokens: 900,
          stream,
          messages: [
            { role: "system", content: request.system },
            ...toProviderMessages(messages),
          ],
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
    // A 4xx on an image turn is almost always a text-only model or a provider
    // that does not accept the multimodal content form — say that, rather than
    // handing the user a raw upstream payload.
    if (withImages && res.status >= 400 && res.status < 500) {
      throw new Error(
        `Chat failed (${res.status}). The model "${model}" may not accept images — switch to a vision-capable model in Options → AI access. Upstream: ${body.slice(0, 160)}`
      );
    }
    throw new Error(`Chat failed (${res.status}): ${body.slice(0, 200)}`);
  }

  if (stream && res.body) {
    try {
      const text = await readSSE(
        res,
        config.onChunk,
        undefined,
        deadline,
        "Empty streamed chat response."
      );
      return { reply: text, runtime: "openai-compatible" };
    } catch (err) {
      throw deadline.signal.aborted ? describeAbort(deadline) : err;
    } finally {
      deadline.settle();
    }
  }

  const data = await res.json().finally(() => deadline.settle());
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty chat response.");
  if (config.onChunk) config.onChunk(text);
  return { reply: text, runtime: "openai-compatible" };
}

/**
 * Connectivity probe for "Test connection" — the cheapest real round trip that
 * still proves key, base URL and model all work together.
 *
 * @param {{ apiBaseUrl?: string, apiKey?: string, model?: string }} config
 * @returns {Promise<{ ok: boolean, message: string, code?: string }>}
 */
export async function pingOpenAICompatible(config) {
  const base = (config.apiBaseUrl || "").replace(/\/$/, "");
  const model = config.model || DEFAULT_OPENAI_MODEL;
  if (!base) {
    return { ok: false, code: "missing_byok_base", message: "API base URL is required." };
  }
  if (!config.apiKey?.trim()) {
    return { ok: false, code: "missing_byok_key", message: "API key is required." };
  }

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        temperature: 0,
        messages: [
          { role: "system", content: "Reply with the single word: ok" },
          { role: "user", content: "ping" },
        ],
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
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
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

/** @param {string} mode */
function tokenBudgetForMode(mode) {
  if (mode === "more" || mode === "research" || mode === "probe") return 900;
  if (mode === "verify" || mode === "opportunity") return 750;
  if (mode === "why_it_matters") return 700;
  return 650;
}

/**
 * @param {Response} res
 * @param {(t: string) => void} [onChunk]
 * @param {(u: { promptTokens: number, completionTokens: number }) => void} [onUsage]
 * @param {{ chunkReceived: () => void }} [deadline]
 * @param {string} [emptyMessage]
 */
async function readSSE(
  res,
  onChunk,
  onUsage,
  deadline,
  emptyMessage = "Empty streamed response from model."
) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // A chunk proves the stream is alive; restart the stall clock.
    deadline?.chunkReceived();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk?.(delta);
        }
        // With stream_options.include_usage the provider sends one final
        // choice-less frame carrying the totals.
        if (json.usage) {
          onUsage?.({
            promptTokens: Number(json.usage.prompt_tokens) || 0,
            completionTokens: Number(json.usage.completion_tokens) || 0,
          });
        }
      } catch {
        /* skip */
      }
    }
  }

  if (!full.trim()) throw new Error(emptyMessage);
  return full.trim();
}

// Re-export for tests / tooling that want the same messages the runtime sends.
export { buildExplainContext, buildModelMessages } from "../explain-context.js";
