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

import { createRequestTimeout, describeAbort } from "../request-timeout.js";

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
  const agentId = config.agentId || "wdimtm-explainer";
  if (!base) {
    throw new Error("PromptaaS base URL is required.");
  }

  const url = `${base}/v1/agents/${encodeURIComponent(agentId)}/run`;
  /** @type {Record<string, string>} */
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const deadline = createRequestTimeout({ externalSignal: config.signal });
  const res = await fetch(url, {
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
 * @param {Response} res
 * @param {(text: string) => void} onChunk
 */
async function readPromptaaSStream(res, onChunk, deadline) {
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
        if (json.explanation && json.done) {
          explanation = json.explanation;
        }
        if (json.followUps) followUps = json.followUps;
      } catch {
        // ignore malformed chunks
      }
    }
  }

  if (!explanation) {
    throw new Error("Empty PromptaaS stream.");
  }

  return {
    explanation,
    followUps: followUps || [],
    runtime: "promptaas",
  };
}
