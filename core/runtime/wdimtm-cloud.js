/**
 * WDIMTM Cloud runtime adapter (Issue #51).
 *
 * Same ExplainRequest / ExplainResponse contract as every other runtime — the
 * only difference is that inference credentials live on the server, so the user
 * never pastes an API key. Switching a user from BYOK to Cloud must not change
 * the Explain UX in any way.
 *
 * Contract: POST {cloudBaseUrl}/v1/explain  { input: ExplainRequest, stream }
 *           POST {cloudBaseUrl}/v1/chat     { input: ChatRequest, stream }
 */

import { cloudFetch } from "../cloud.js";
import { createRequestTimeout, describeAbort } from "../request-timeout.js";

/**
 * @param {import('../lib/types.js').ExplainRequest & { mode?: string }} request
 * @param {{
 *   baseUrl: string,
 *   accessToken?: string,
 *   onChunk?: (text: string) => void,
 *   signal?: AbortSignal,
 * }} config
 * @returns {Promise<import('../lib/types.js').ExplainResponse>}
 */
export async function explainWithWdimtmCloud(request, config) {
  const wantStream = typeof config.onChunk === "function";
  const deadline = createRequestTimeout({ externalSignal: config.signal });
  const res = await cloudFetch(
    { baseUrl: config.baseUrl, accessToken: config.accessToken },
    "/explain",
    {
      method: "POST",
      accept: wantStream ? "text/event-stream, application/json" : "application/json",
      body: { ...request, stream: wantStream },
      signal: deadline.signal,
    }
  ).catch((err) => {
    deadline.settle();
    throw deadline.signal.aborted ? describeAbort(deadline) : err;
  });
  deadline.firstByteReceived();

  const contentType = res.headers.get("content-type") || "";
  if (wantStream && contentType.includes("text/event-stream") && res.body) {
    try {
      return await readCloudStream(
        res,
        /** @type {(t: string) => void} */ (config.onChunk),
        deadline
      );
    } catch (err) {
      throw deadline.signal.aborted ? describeAbort(deadline) : err;
    } finally {
      deadline.settle();
    }
  }

  const data = await res.json().finally(() => deadline.settle());
  const explanation =
    data.explanation || data.output?.explanation || data.result?.explanation || data.content;
  if (!explanation || typeof explanation !== "string") {
    throw new Error("WDIMTM Cloud response missing explanation string.");
  }
  if (config.onChunk) config.onChunk(explanation);

  return {
    explanation,
    summary: data.summary,
    whyItMatters: data.whyItMatters || data.why_it_matters,
    followUps: data.followUps || data.follow_ups || [],
    memorySuggestion: data.memorySuggestion || data.memory_suggestion || null,
    runtime: "wdimtm-cloud",
    meta: data.meta,
  };
}

/**
 * Page chat over the same cloud contract.
 * @param {{
 *   system: string,
 *   messages: Array<{ role: 'user' | 'assistant', content: string }>,
 * }} request
 * @param {{
 *   baseUrl: string,
 *   accessToken?: string,
 *   onChunk?: (text: string) => void,
 *   signal?: AbortSignal,
 * }} config
 * @returns {Promise<{ reply: string, runtime: string }>}
 */
export async function chatWithWdimtmCloud(request, config) {
  const wantStream = typeof config.onChunk === "function";
  const deadline = createRequestTimeout({ externalSignal: config.signal });
  const res = await cloudFetch(
    { baseUrl: config.baseUrl, accessToken: config.accessToken },
    "/chat",
    {
      method: "POST",
      accept: wantStream ? "text/event-stream, application/json" : "application/json",
      body: { system: request.system, messages: request.messages, stream: wantStream },
      signal: deadline.signal,
    }
  ).catch((err) => {
    deadline.settle();
    throw deadline.signal.aborted ? describeAbort(deadline) : err;
  });
  deadline.firstByteReceived();

  const contentType = res.headers.get("content-type") || "";
  if (wantStream && contentType.includes("text/event-stream") && res.body) {
    try {
      const streamed = await readCloudStream(
        res,
        /** @type {(t: string) => void} */ (config.onChunk),
        deadline
      );
      return { reply: streamed.explanation, runtime: "wdimtm-cloud" };
    } catch (err) {
      throw deadline.signal.aborted ? describeAbort(deadline) : err;
    } finally {
      deadline.settle();
    }
  }

  const data = await res.json().finally(() => deadline.settle());
  const reply = data.reply || data.explanation || data.content || "";
  if (!reply) throw new Error("WDIMTM Cloud chat response was empty.");
  return { reply, runtime: "wdimtm-cloud" };
}

/**
 * SSE: data: {"delta":"…"} … data: {"done":true,"explanation"?,"followUps"?}
 * @param {Response} res
 * @param {(text: string) => void} onChunk
 * @param {{ chunkReceived: () => void }} [deadline]
 * @returns {Promise<import('../lib/types.js').ExplainResponse>}
 */
async function readCloudStream(res, onChunk, deadline) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let explanation = "";
  /** @type {unknown[] | undefined} */
  let followUps;
  /** @type {unknown} */
  let meta;
  /** @type {string} */
  let streamError = "";

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
        if (json.done && json.explanation) explanation = json.explanation;
        if (json.followUps) followUps = json.followUps;
        if (json.meta) meta = json.meta;
        // The response was already committed as 200 before the server hit
        // trouble, so failures arrive as a frame rather than a status code.
        if (json.error) streamError = String(json.error);
      } catch {
        // ignore malformed chunks
      }
    }
  }

  if (streamError) {
    throw new Error(`WDIMTM Cloud stream failed: ${streamError}`);
  }
  if (!explanation) {
    throw new Error("Empty WDIMTM Cloud stream.");
  }

  return {
    explanation,
    followUps: /** @type {any} */ (followUps || []),
    runtime: "wdimtm-cloud",
    meta: /** @type {any} */ (meta),
  };
}
