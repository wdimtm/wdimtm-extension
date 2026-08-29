/**
 * Plain chat completion against the configured OpenAI-compatible endpoint.
 *
 * `explainWithOpenAICompatible` is explain-shaped: it builds page/lens/memory
 * context and parses follow-up trailers out of the reply. Distillation and
 * merging (#49) need neither — they send their own system prompt and want the
 * raw text back — so they get their own narrow entry point rather than
 * threading special cases through the explain path.
 */

import { classifyRuntimeError } from "../runtime-errors.js";
import { completionSupportOf } from "./registry.js";

/**
 * @param {{ system: string, user: string }} prompt
 * @param {{ apiBaseUrl: string, apiKey: string, model: string, maxTokens?: number, signal?: AbortSignal }} config
 * @returns {Promise<string>}
 */
export async function complete(prompt, config) {
  const base = (config.apiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = config.model || "gpt-4o-mini";

  if (!config.apiKey) {
    throw new Error(classifyRuntimeError(new Error("API key is required"), "byok").message);
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    signal: config.signal,
    body: JSON.stringify({
      model,
      // Extraction, not creative writing — low temperature keeps the JSON shape
      // and the wording stable across batches.
      temperature: 0.1,
      max_tokens: config.maxTokens || 1200,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      classifyRuntimeError(
        new Error(`LLM request failed (${res.status}): ${body.slice(0, 200)}`),
        "byok"
      ).message
    );
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Empty response from model.");
  }
  return text;
}

/**
 * Whether import can run at all.
 *
 * Import needs a general chat completion. The `mock` runtime has no model
 * behind it, and PromptaaS exposes a fixed explainer agent rather than an open
 * completion endpoint, so neither can serve this pipeline. A fresh install
 * defaults to `mock`, which makes this a routine path rather than an edge case:
 * the UI sends the user to configure a model and keeps their parsed file.
 *
 * Which runtimes can serve this, and which key they need, is declared once on
 * the registry entry (`completion`) rather than re-derived here.
 *
 * @param {{ runtime: string, apiKey: string }} settings
 * @returns {{ ready: boolean, reason?: 'mock' | 'promptaas' | 'missing_key' }}
 */
export function importRuntimeStatus(settings) {
  const support = completionSupportOf(settings?.runtime);
  if (!support.ok) return { ready: false, reason: support.reason };
  if (!String(settings?.[support.keyField] || "").trim()) {
    return { ready: false, reason: support.missingReason };
  }
  return { ready: true };
}
