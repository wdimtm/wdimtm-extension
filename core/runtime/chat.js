/**
 * Multi-turn page chat execution (Issue #13).
 *
 * This module owns what is the same for every runtime — validating the turn,
 * building the system prompt, attaching the web-search verdict — and nothing
 * else. The wire protocols live with the runtimes that speak them
 * (openai-compatible.js, anthropic.js, wdimtm-cloud.js,
 * mock.js); which one to use, and how to configure it, is the registry's.
 */

import { buildChatSystemPrompt } from "../chat-prompt.js";
import { attachmentsWithData, hasImageAttachments } from "../images.js";
import { runtimeForExecution } from "./registry.js";

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
 *   cloudBaseUrl?: string,
 *   cloudAccessToken?: string,
 *   languageInstruction?: string,
 *   onChunk?: (text: string) => void,
 *   signal?: AbortSignal,
 * }} config settings-shaped: the same keys the registry reads off settings
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

  const system = buildChatSystemPrompt({
    selection: request.selection,
    page: request.page,
    lens: request.lens,
    memories: request.memories,
    languageInstruction: config.languageInstruction,
    webEvidence: request.webEvidence,
    webSearchMeta: request.webSearchMeta,
    hasAttachments: hasImageAttachments(messages),
  });

  const runtime = runtimeForExecution(config.runtime);
  const result = await runtime.chat(
    { ...request, system, messages },
    {
      ...runtime.configFromSettings(config, {
        answerLanguage: request.answerLanguage,
        languageInstruction: config.languageInstruction,
      }),
      ...(config.onChunk ? { onChunk: config.onChunk } : {}),
      ...(config.signal ? { signal: config.signal } : {}),
    }
  );

  return {
    ...result,
    webSearch: request.webSearchMeta || { used: false },
  };
}
