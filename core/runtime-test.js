/**
 * One-click connectivity tests for BYOK / Anthropic / PromptaaS / WDIMTM Cloud.
 */

import {
  DEFAULT_ANTHROPIC_MODEL,
  anthropicHeaders,
  flattenContent,
} from "./runtime/anthropic.js";
import { DEFAULT_CLOUD_BASE_URL, fetchCloudAccount } from "./cloud.js";
import { classifyRuntimeError } from "./runtime-errors.js";

/**
 * @param {{ apiBaseUrl: string, apiKey: string, model: string }} config
 * @returns {Promise<{ ok: boolean, message: string, code?: string }>}
 */
export async function testByokConnection(config) {
  const base = (config.apiBaseUrl || "").replace(/\/$/, "");
  const model = config.model || "gpt-4o-mini";
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

/**
 * Native Anthropic Messages API ping (#64).
 * @param {{ anthropicBaseUrl: string, anthropicApiKey: string, anthropicModel: string }} config
 * @returns {Promise<{ ok: boolean, message: string, code?: string }>}
 */
export async function testAnthropicConnection(config) {
  const base = (config.anthropicBaseUrl || "").replace(/\/$/, "");
  const model = config.anthropicModel || DEFAULT_ANTHROPIC_MODEL;
  if (!base) {
    return {
      ok: false,
      code: "missing_anthropic_base",
      message: "Anthropic base URL is required.",
    };
  }
  if (!config.anthropicApiKey?.trim()) {
    return { ok: false, code: "missing_anthropic_key", message: "Anthropic API key is required." };
  }

  try {
    const res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: anthropicHeaders(config.anthropicApiKey.trim()),
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
 * @param {{ promptaasBaseUrl: string, promptaasApiKey?: string, promptaasAgentId: string }} config
 */
export async function testPromptaasConnection(config) {
  const base = (config.promptaasBaseUrl || "").replace(/\/$/, "");
  const agentId = config.promptaasAgentId || "wdimtm-explainer";
  if (!base) {
    return {
      ok: false,
      code: "missing_promptaas_base",
      message: "PromptaaS base URL is required.",
    };
  }

  /** @type {Record<string, string>} */
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.promptaasApiKey?.trim()) {
    headers.Authorization = `Bearer ${config.promptaasApiKey.trim()}`;
  }

  try {
    const res = await fetch(`${base}/v1/agents/${encodeURIComponent(agentId)}/run`, {
      method: "POST",
      headers,
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
 * WDIMTM Cloud probe (#51). Uses the entitlement endpoint rather than burning
 * an inference call, so "Test connection" stays free.
 * @param {{ cloudBaseUrl: string, cloudAccessToken?: string }} config
 * @returns {Promise<{ ok: boolean, message: string, code?: string }>}
 */
export async function testCloudConnection(config) {
  const baseUrl = (config.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!baseUrl) {
    return {
      ok: false,
      code: "missing_cloud_base",
      message: "WDIMTM Cloud base URL is required.",
    };
  }

  try {
    const account = await fetchCloudAccount({
      baseUrl,
      accessToken: (config.cloudAccessToken || "").trim(),
    });
    const plan = account.plan || "cloud";
    const quota = account.quota;
    const quotaText =
      quota && typeof quota.limit === "number"
        ? ` — ${quota.used ?? 0}/${quota.limit} used`
        : "";
    return {
      ok: true,
      code: "ready",
      message: `Connected to WDIMTM Cloud (plan: ${plan})${quotaText}.`,
    };
  } catch (err) {
    const classified = classifyRuntimeError(err, "cloud");
    return { ok: false, code: classified.code, message: classified.message };
  }
}
