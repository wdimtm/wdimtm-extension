/**
 * PromptaaS / Agent-as-a-Business runtime adapter (Issue #4).
 *
 * Optional dogfood path — ordinary Explain should use openai-compatible.
 * PromptaaS remains the future extension point for:
 *   capability routing, multi-step workflows, provider/model routing,
 *   auth/quota/billing/analytics.
 *
 * Contract: POST {baseUrl}/v1/agents/{agentId}/run
 * with ExplainRequest JSON, returns { explanation, followUps?, summary?, memorySuggestion? }.
 */

import { hasImageAttachments, toProviderMessages } from "../images.js";
import { createRequestTimeout, describeAbort } from "../request-timeout.js";
import { classifyRuntimeError } from "../runtime-errors.js";

export const DEFAULT_PROMPTAAS_AGENT_ID = "wdimtm-explainer";

/**
 * @param {string} baseUrl
 * @param {string} agentId
 */
function agentRunUrl(baseUrl, agentId) {
  return `${baseUrl}/v1/agents/${encodeURIComponent(agentId)}/run`;
}

/**
 * @param {string} [apiKey]
 * @returns {Record<string, string>}
 */
function promptaasHeaders(apiKey) {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  return headers;
}

/**
 * @param {import('../lib/types.js').ExplainRequest & { mode?: string }} request
 * @param {{
 *   baseUrl: string,
 *   apiKey?: string,
 *   agentId: string,
 *   onChunk?: (text: string) => void,
 *   signal?: AbortSignal,
 * }} config
 * @returns {Promise<import('../lib/types.js').ExplainResponse>}
 */
export async function explainWithPromptaaS(request, config) {
  const base = (config.baseUrl || "").replace(/\/$/, "");
  const agentId = config.agentId || DEFAULT_PROMPTAAS_AGENT_ID;
  if (!base) {
    throw new Error("PromptaaS base URL is required.");
  }

  const headers = promptaasHeaders(config.apiKey);

  const deadline = createRequestTimeout({ externalSignal: config.signal });
  const res = await fetch(agentRunUrl(base, agentId), {
    method: "POST",
    signal: deadline.signal,
    headers,
    body: JSON.stringify({
      input: request,
      stream: Boolean(config.onChunk),
    }),
  }).catch((err) => {
    deadline.settle();
    throw deadline.signal.aborted ? describeAbort(deadline) : err;
  });
  deadline.firstByteReceived();

  if (!res.ok) {
    deadline.settle();
    const body = await res.text().catch(() => "");
    throw new Error(`PromptaaS request failed (${res.status}): ${body.slice(0, 240)}`);
  }

  const contentType = res.headers.get("content-type") || "";

  // Optional SSE stream: data: {"delta":"..."} / data: {"done":true,"explanation":"..."}
  if (config.onChunk && contentType.includes("text/event-stream") && res.body) {
    try {
      return await readPromptaaSStream(res, config.onChunk, deadline);
    } catch (err) {
      throw deadline.signal.aborted ? describeAbort(deadline) : err;
    } finally {
      deadline.settle();
    }
  }

  const data = await res.json().finally(() => deadline.settle());
  const explanation =
    data.explanation ||
    data.output?.explanation ||
    data.result?.explanation ||
    data.message ||
    data.content;
  if (!explanation || typeof explanation !== "string") {
    throw new Error("PromptaaS response missing explanation string.");
  }

  if (config.onChunk) {
    config.onChunk(explanation);
  }

  return {
    explanation,
    summary: data.summary,
    whyItMatters: data.whyItMatters || data.why_it_matters,
    followUps: data.followUps || data.follow_ups || [],
    memorySuggestion: data.memorySuggestion || data.memory_suggestion || null,
    runtime: "promptaas",
    meta: data.meta,
  };
}

/**
 * Multi-turn page chat against the same agent endpoint (mode "chat").
 *
 * @param {{
 *   system: string,
 *   messages: Array<{ role: 'user' | 'assistant', content: string }>,
 *   selection?: string,
 *   page?: { url: string, title: string, context?: string },
 *   lens?: { id: string, instructions?: string },
 *   webEvidence?: string,
 * }} request
 * @param {{
 *   baseUrl?: string,
 *   apiKey?: string,
 *   agentId?: string,
 *   onChunk?: (text: string) => void,
 *   signal?: AbortSignal,
 * }} config
 * @returns {Promise<{ reply: string, runtime: string }>}
 */
export async function chatWithPromptaaS(request, config) {
  const base = (config.baseUrl || "").replace(/\/$/, "");
  const agentId = config.agentId || DEFAULT_PROMPTAAS_AGENT_ID;
  if (!base) throw new Error("PromptaaS base URL is required.");
  const messages = request.messages || [];
  const withImages = hasImageAttachments(messages);

  const deadline = createRequestTimeout({ externalSignal: config.signal });
  const res = await fetch(agentRunUrl(base, agentId), {
    method: "POST",
    signal: deadline.signal,
    headers: promptaasHeaders(config.apiKey),
    body: JSON.stringify({
      input: {
        mode: "chat",
        system: request.system,
        selection: request.selection,
        page: request.page,
        lens: request.lens,
        messages: toProviderMessages(messages),
        webEvidence: request.webEvidence,
      },
      stream: Boolean(config.onChunk),
    }),
  }).catch((err) => {
    deadline.settle();
    throw deadline.signal.aborted ? describeAbort(deadline) : err;
  });
  deadline.firstByteReceived();

  if (!res.ok) {
    deadline.settle();
    const body = await res.text().catch(() => "");
    if (withImages && res.status >= 400 && res.status < 500) {
      throw new Error(
        `PromptaaS chat failed (${res.status}). This path may not accept images yet. Upstream: ${body.slice(0, 160)}`
      );
    }
    throw new Error(`PromptaaS chat failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (config.onChunk && contentType.includes("text/event-stream") && res.body) {
    try {
      const streamed = await readPromptaaSStream(res, config.onChunk, deadline, {
        replyField: true,
      });
      return { reply: streamed.explanation.trim(), runtime: "promptaas" };
    } catch (err) {
      throw deadline.signal.aborted ? describeAbort(deadline) : err;
    } finally {
      deadline.settle();
    }
  }

  const data = await res.json().finally(() => deadline.settle());
  const text =
    data.reply || data.explanation || data.output?.reply || data.message || data.content;
  if (!text || typeof text !== "string") throw new Error("PromptaaS chat missing reply.");
  if (config.onChunk) config.onChunk(text);
  return { reply: text, runtime: "promptaas" };
}

/**
 * Connectivity probe for "Test connection".
 *
 * PromptaaS is the one runtime whose probe has no button behind it: the
 * shipped Options UI never offers it (runtime-presets.js maps the access mode
 * onto WDIMTM Cloud). It stays reachable through the TEST_RUNTIME message so
 * the local mock server and the Cloud backend can still be pinged by hand.
 *
 * @param {{ baseUrl?: string, apiKey?: string, agentId?: string }} config
 * @returns {Promise<{ ok: boolean, message: string, code?: string }>}
 */
export async function pingPromptaaS(config) {
  const base = (config.baseUrl || "").replace(/\/$/, "");
  const agentId = config.agentId || DEFAULT_PROMPTAAS_AGENT_ID;
  if (!base) {
    return {
      ok: false,
      code: "missing_promptaas_base",
      message: "PromptaaS base URL is required.",
    };
  }

  try {
    const res = await fetch(agentRunUrl(base, agentId), {
      method: "POST",
      headers: promptaasHeaders(config.apiKey),
      body: JSON.stringify({
        input: {
          selection: "connectivity test",
          page: { url: "https://wdimtm.local/test", title: "WDIMTM test" },
          mode: "explain",
          lens: { id: "general" },
        },
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const classified = classifyRuntimeError(
        new Error(`PromptaaS request failed (${res.status}): ${body.slice(0, 120)}`),
        "promptaas"
      );
      return { ok: false, code: classified.code, message: classified.message };
    }
    const data = await res.json();
    const explanation =
      data.explanation || data.output?.explanation || data.message || data.content || "";
    return {
      ok: true,
      code: "ready",
      message: explanation
        ? `Connected to agent “${agentId}”.`
        : `HTTP OK from agent “${agentId}” (empty explanation field).`,
    };
  } catch (err) {
    const classified = classifyRuntimeError(err, "promptaas");
    return { ok: false, code: classified.code, message: classified.message };
  }
}

/**
 * @param {Response} res
 * @param {(text: string) => void} onChunk
 * @param {{ chunkReceived?: () => void }} [deadline]
 * @param {{ replyField?: boolean }} [opts] chat frames close with `reply`,
 *   explain frames with `explanation`
 */
async function readPromptaaSStream(res, onChunk, deadline, opts = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let explanation = "";
  /** @type {string[] | undefined} */
  let followUps;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    deadline?.chunkReceived();
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        if (json.delta) {
          explanation += json.delta;
          onChunk(json.delta);
        }
        const closing = opts.replyField ? json.reply || json.explanation : json.explanation;
        if (json.done && closing) {
          explanation = closing;
        }
        if (json.followUps) followUps = json.followUps;
      } catch {
        // ignore malformed chunks
      }
    }
  }

  if (opts.replyField ? !explanation.trim() : !explanation) {
    throw new Error(opts.replyField ? "Empty PromptaaS chat stream." : "Empty PromptaaS stream.");
  }

  return {
    explanation,
    followUps: followUps || [],
    runtime: "promptaas",
  };
}
