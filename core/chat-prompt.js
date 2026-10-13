/**
 * The page-chat system prompt — pure, so it can be built anywhere.
 *
 * Split out of chat.js, whose other half persists threads in
 * chrome.storage.session. Building the prompt never needed storage, and the
 * runtime that uses it has to work server-side too.
 */

export function buildChatSystemPrompt(ctx) {
  const lens = ctx.lens;
  const lensBlock = lens?.instructions
    ? `Active lens "${lens.id}": ${lens.instructions}`
    : `Active lens: ${lens?.id || "general"}`;

  const parts = [
    "You are WDIMTM page chat — a deeper follow-up conversation after a quick in-page explanation.",
    "Stay grounded in the selected text and bounded page context. Do not invent page content.",
    "Be concise but allow multi-step reasoning when the user asks for depth.",
    "Separate facts from hypotheses. Markdown is allowed.",
    "When WEB EVIDENCE has real sources (URLs + snippets), use them and cite URLs.",
    "Never invent news headlines, sources, or claim a search API failed unless WEB SEARCH STATUS says so.",
    ctx.hasAttachments
      ? "The user attached one or more images (screenshots or uploads). Read them as primary evidence alongside the selection, describe only what is actually visible, and say so plainly if an image is unreadable."
      : "",
    ctx.languageInstruction ? ctx.languageInstruction : "",
    lensBlock,
    "",
    `Page: ${ctx.page?.title || "(none)"}`,
    `URL: ${ctx.page?.url || "(none)"}`,
    "",
    "Selected text:",
    ctx.selection || "(none)",
  ];
  if (ctx.page?.context) {
    parts.push("", "Bounded page context:", ctx.page.context);
  }
  if (ctx.memories?.length) {
    parts.push(
      "",
      "User context:",
      ...ctx.memories.map((m) => `- (${m.type}) ${m.content}`)
    );
  }

  // Always declare search state so the model does not hallucinate "technical
  // errors". The one exception is WDIMTM Cloud, which searches server-side and
  // appends this section itself (#141): the client marks that "delegated".
  if (ctx.webSearchMeta?.status !== "delegated") {
    parts.push(buildChatWebSearchSection(ctx.webSearchMeta, ctx.webEvidence));
  }

  return parts.filter(Boolean).join("\n");
}

/**
 * The WEB SEARCH STATUS (and, when there are hits, WEB EVIDENCE) section of the
 * chat system prompt. Exported so WDIMTM Cloud can append it after running the
 * search itself.
 *
 * @param {{ used?: boolean, status?: string, provider?: string, query?: string,
 *   resultCount?: number, error?: string, humanError?: string } | undefined} webSearchMeta
 * @param {string | undefined} webEvidence
 * @param {{ cloud?: boolean }} [opts] cloud: search is included with WDIMTM
 *   Cloud, so there is no provider or API key for the user to fix
 * @returns {string}
 */
export function buildChatWebSearchSection(webSearchMeta, webEvidence, opts = {}) {
  const meta = webSearchMeta || { status: "not_configured", used: false };
  const status = meta.status || (meta.used ? "ok" : meta.error ? "failed" : "not_configured");
  const parts = ["## WEB SEARCH STATUS", `status: ${status}`];
  if (meta.provider) parts.push(`provider: ${meta.provider}`);
  if (meta.query) parts.push(`query: ${meta.query}`);
  if (typeof meta.resultCount === "number") {
    parts.push(`resultCount: ${meta.resultCount}`);
  }

  if (status === "ok" && webEvidence) {
    parts.push(
      "## WEB EVIDENCE",
      "(Live web search — external sources, not the page. Cite URLs when used.)",
      webEvidence
    );
  } else if (status === "failed") {
    parts.push(
      `error: ${meta.humanError || meta.error || "unknown"}`,
      opts.cloud
        ? "Instruction: Tell the user live web search failed with this error. Answer only from the page/selection. Do not invent news or pretend results exist. Search is included with WDIMTM Cloud, so do not ask them for an API key; suggest trying again later."
        : "Instruction: Tell the user live web search failed with this error. Answer only from the page/selection. Do not invent news or pretend results exist. Suggest checking Options → Web search (provider + API key)."
    );
  } else if (status === "empty") {
    parts.push(
      "Instruction: Live search returned no hits. Say so briefly; do not invent sources. Ground the answer in page/selection only."
    );
  } else {
    // not_configured / off
    parts.push(
      opts.cloud
        ? "Instruction: Live web search is OFF for page chat. If they ask you to search the web or news, clearly say WDIMTM web search is off and they can turn on \"Enable web search\" in extension Options → Web search (included with WDIMTM Cloud, no API key needed). Do NOT invent a search API technical error. Answer from page/selection only."
        : "Instruction: Live web search is NOT configured for this user. If they ask you to search the web or news, clearly say WDIMTM web search is off and they should enable it in extension Options (provider + API key + enable checkbox). Do NOT invent a search API technical error. Answer from page/selection only."
    );
  }
  return parts.filter(Boolean).join("\n");
}
