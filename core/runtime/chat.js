/**
 * Multi-turn page chat execution (Issue #13).
 * Supports optional WEB EVIDENCE and SSE streaming (same settings as explain).
 */

import { buildChatSystemPrompt } from "../chat-prompt.js";
import {
  attachmentsWithData,
  describeAttachments,
  hasImageAttachments,
  toProviderMessages,
} from "../images.js";
import {
  createRequestTimeout,
  describeAbort,
} from "../request-timeout.js";
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_ANTHROPIC_MODEL,
  anthropicHeaders,
  flattenContent,
  readAnthropicTextStream,
} from "./anthropic.js";
import { explainWithMock } from "./mock.js";
import { chatWithWdimtmCloud } from "./wdimtm-cloud.js";

/**
 * @param {{
 *   selection: string,
 *   page: { url: string, title: string, context?: string },
 *   lens?: { id: string, instructions?: string },
 *   memories?: Array<{ type: string, content: string }>,
 *   messages: Array<{ role: 'user' | 'assistant', content: string }>,
 *   answerLanguage?: string,
 *   webEvidence?: string,
 *   webSearchMeta?: { used?: boolean, provider?: string, error?: string, resultCount?: number },
 * }} request
 * @param {{
 *   runtime: string,
 *   apiBaseUrl?: string,
 *   apiKey?: string,
 *   model?: string,
 *   anthropicBaseUrl?: string,
 *   anthropicApiKey?: string,
 *   anthropicModel?: string,
 *   promptaasBaseUrl?: string,
 *   promptaasApiKey?: string,
 *   promptaasAgentId?: string,
 *   cloudBaseUrl?: string,
 *   cloudAccessToken?: string,
 *   languageInstruction?: string,
 *   onChunk?: (text: string) => void,
 * }} config
 */
export async function runChat(request, config) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  if (!messages.length) {
    throw new Error("Chat requires at least one user message.");
  }
  const last = messages[messages.length - 1];
  const lastHasImages = attachmentsWithData(last?.attachments).length > 0;
  if (!last || last.role !== "user") {
    throw new Error("Last chat message must be a user message.");
  }
  // An image on its own is a complete question ("what is this?") — only reject
  // a turn that carries neither text nor an attachment.
  if (!String(last.content || "").trim() && !lastHasImages) {
    throw new Error("Last chat message must have text or an image.");
  }

  const hasAttachments = hasImageAttachments(messages);
  const system = buildChatSystemPrompt({
    selection: request.selection,
    page: request.page,
    lens: request.lens,
    memories: request.memories,
    languageInstruction: config.languageInstruction,
    webEvidence: request.webEvidence,
    webSearchMeta: request.webSearchMeta,
    hasAttachments,
  });

  /** @type {{ reply: string, runtime: string }} */
  let result;
  if (config.runtime === "openai-compatible") {
    result = await chatOpenAI(system, messages, config);
  } else if (config.runtime === "anthropic") {
    result = await chatAnthropic(system, messages, config);
  } else if (config.runtime === "promptaas") {
    result = await chatPromptaaS(system, request, messages, config);
  } else if (config.runtime === "wdimtm-cloud") {
    result = await chatWithWdimtmCloud(
      { system, messages: /** @type {any} */ (messages) },
      {
        baseUrl: config.cloudBaseUrl || "",
        accessToken: config.cloudAccessToken,
        ...(config.onChunk ? { onChunk: config.onChunk } : {}),
        ...(config.signal ? { signal: config.signal } : {}),
      }
    );
  } else {
    result = await chatMock(request, String(last.content || ""), config, last.attachments);
  }

  return {
    ...result,
    webSearch: request.webSearchMeta || { used: false },
  };
}

/**
 * @param {string} system
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} config
 */
async function chatOpenAI(system, messages, config) {
  const base = (config.apiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!config.apiKey) throw new Error("API key is required for chat.");
  const stream = Boolean(config.onChunk);
  const withImages = hasImageAttachments(messages);
  const deadline = createRequestTimeout({ externalSignal: config.signal });
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: deadline.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || "gpt-4o-mini",
      temperature: 0.5,
      max_tokens: 900,
      stream,
      messages: [{ role: "system", content: system }, ...toProviderMessages(messages)],
    }),
  }).catch((err) => {
    deadline.settle();
    throw deadline.signal.aborted ? describeAbort(deadline) : err;
  });
  deadline.firstByteReceived();
  if (!res.ok) {
    deadline.settle();
    const body = await res.text().catch(() => "");
    // A 4xx on an image turn is almost always a text-only model or a provider
    // that does not accept the multimodal content form — say that, rather than
    // handing the user a raw upstream payload.
    if (withImages && res.status >= 400 && res.status < 500) {
      throw new Error(
        `Chat failed (${res.status}). The model "${config.model || "gpt-4o-mini"}" may not accept images — switch to a vision-capable model in Options → AI access. Upstream: ${body.slice(0, 160)}`
      );
    }
    throw new Error(`Chat failed (${res.status}): ${body.slice(0, 200)}`);
  }

  if (stream && res.body) {
    try {
      const text = await readOpenAISSE(res, config.onChunk, deadline);
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
 * Native Anthropic Messages API chat (#64): system is top-level, no temperature.
 * @param {string} system
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} config
 */
async function chatAnthropic(system, messages, config) {
  const base = (config.anthropicBaseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/$/, "");
  if (!config.anthropicApiKey) throw new Error("API key is required for chat.");
  const stream = Boolean(config.onChunk);
  const deadline = createRequestTimeout({ externalSignal: config.signal });
  let res;
  try {
    res = await fetch(`${base}/messages`, {
      method: "POST",
      signal: deadline.signal,
      headers: anthropicHeaders(config.anthropicApiKey),
      body: JSON.stringify({
        model: config.anthropicModel || DEFAULT_ANTHROPIC_MODEL,
        // Headroom for adaptive thinking, which shares the max_tokens ceiling.
        max_tokens: 5000,
        stream,
        system,
        messages: messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content || ""),
        })),
      }),
    });
  } catch (err) {
    deadline.settle();
    throw deadline.signal.aborted ? describeAbort(deadline) : err;
  }
  deadline.firstByteReceived();
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
 * @param {string} system
 * @param {object} request
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} config
 */
async function chatPromptaaS(system, request, messages, config) {
  const base = (config.promptaasBaseUrl || "").replace(/\/$/, "");
  const agentId = config.promptaasAgentId || "wdimtm-explainer";
  if (!base) throw new Error("PromptaaS base URL is required.");
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (config.promptaasApiKey) headers.Authorization = `Bearer ${config.promptaasApiKey}`;
  const withImages = hasImageAttachments(messages);
  const deadline = createRequestTimeout({ externalSignal: config.signal });
  const res = await fetch(`${base}/v1/agents/${encodeURIComponent(agentId)}/run`, {
    method: "POST",
    signal: deadline.signal,
    headers,
    body: JSON.stringify({
      input: {
        mode: "chat",
        system,
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
      const text = await readPromptaaSChatStream(res, config.onChunk, deadline);
      return { reply: text, runtime: "promptaas" };
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
 * Offline chat: reuse mock explainer framing on the latest user question.
 * @param {object} request
 * @param {string} userText
 * @param {object} config
 * @param {import('../lib/images.js').ImageAttachment[]} [attachments]
 */
async function chatMock(request, userText, config, attachments) {
  const forceZh =
    config.languageInstruction?.includes("Chinese") ||
    request.answerLanguage === "zh_CN" ||
    /[\u4e00-\u9fff]/.test(userText + (request.selection || ""));

  const mock = await explainWithMock(
    {
      selection: request.selection || userText || "(image only)",
      page: request.page || { url: "", title: "" },
      lens: request.lens,
      memories: request.memories,
      mode: /simpl|简单/i.test(userText)
        ? "simplify"
        : /verify|核实|核验|hold up|sanity|fact/i.test(userText)
          ? "verify"
          : /why|为什么|重要/i.test(userText)
            ? "why"
            : "more",
      answerLanguage: forceZh ? "zh_CN" : "en",
      webEvidence: request.webEvidence,
      webSearchMeta: request.webSearchMeta,
    },
    { forceZh }
  );

  const header = forceZh
    ? `**深入对话（mock）**\n\n你问：${userText.slice(0, 200)}\n\n`
    : `**Deeper chat (mock)**\n\nYou asked: ${userText.slice(0, 200)}\n\n`;

  // Mock cannot see pixels — say so instead of pretending to read the image.
  const attachmentNote = attachmentsWithData(attachments).length
    ? forceZh
      ? `\n\n_${describeAttachments(attachments, true)} mock 运行时无法读取图片 —— 接入支持视觉的模型后才会真正分析。_\n`
      : `\n\n_${describeAttachments(attachments, false)} The mock runtime cannot read images — connect a vision-capable model to analyze them._\n`
    : "";

  let webNote = "";
  const st = request.webSearchMeta?.status;
  if (request.webEvidence && (st === "ok" || request.webSearchMeta?.used)) {
    webNote = forceZh
      ? `\n\n_已注入 WEB EVIDENCE（${request.webSearchMeta?.provider || "search"} · ${request.webSearchMeta?.resultCount ?? "?"} 条）。_\n`
      : `\n\n_WEB EVIDENCE injected (${request.webSearchMeta?.provider || "search"} · ${request.webSearchMeta?.resultCount ?? "?"} hits)._\n`;
  } else if (st === "failed") {
    webNote = forceZh
      ? `\n\n_网页搜索失败：${request.webSearchMeta?.humanError || request.webSearchMeta?.error || "未知"}。_\n`
      : `\n\n_Web search failed: ${request.webSearchMeta?.humanError || request.webSearchMeta?.error || "unknown"}._\n`;
  } else if (st === "not_configured" || st === "off") {
    webNote = forceZh
      ? `\n\n_网页搜索未开启（Options → Web search）。_\n`
      : `\n\n_Web search is off (Options → Web search)._\n`;
  }

  const reply = header + attachmentNote + webNote + mock.explanation;

  if (config.onChunk) {
    await streamText(reply, config.onChunk);
  }

  return {
    reply,
    runtime: "mock",
  };
}

/**
 * @param {Response} res
 * @param {(t: string) => void} [onChunk]
 */
async function readOpenAISSE(res, onChunk, deadline) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
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
      } catch {
        /* skip */
      }
    }
  }

  if (!full.trim()) throw new Error("Empty streamed chat response.");
  return full.trim();
}

/**
 * @param {Response} res
 * @param {(t: string) => void} onChunk
 */
async function readPromptaaSChatStream(res, onChunk, deadline) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

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
          full += json.delta;
          onChunk(json.delta);
        }
        if (json.done && (json.reply || json.explanation)) {
          full = json.reply || json.explanation;
        }
      } catch {
        /* skip */
      }
    }
  }

  if (!full.trim()) throw new Error("Empty PromptaaS chat stream.");
  return full.trim();
}

/**
 * @param {string} text
 * @param {(t: string) => void} onChunk
 */
async function streamText(text, onChunk) {
  const chunkSize = 24;
  for (let i = 0; i < text.length; i += chunkSize) {
    onChunk(text.slice(i, i + chunkSize));
    await new Promise((r) => setTimeout(r, 8));
  }
}
