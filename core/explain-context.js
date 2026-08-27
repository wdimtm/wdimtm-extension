/**
 * Explain context builder — structures model input so the LLM can tell
 * page facts from user profile / memories / lens preferences.
 *
 * Used by openai-compatible (primary dogfood path). Mock/PromptaaS may
 * use the same sections for consistency.
 */

import { modeInstruction, normalizeMode } from "./modes.js";

/**
 * @typedef {import('./types.js').ExplainRequest} ExplainRequest
 * @typedef {import('./types.js').MemoryItem} MemoryItem
 * @typedef {import('./types.js').ExplainMode} ExplainMode
 *
 * @typedef {Object} ExplainContext
 * @property {ExplainMode} mode
 * @property {string} [answerLanguage]
 * @property {string} [answerDepth]  // short | normal | detailed
 * @property {string} [languageInstruction]
 * @property {string} selection
 * @property {{ url: string, title: string, context?: string }} page
 * @property {{ id: string, instructions?: string }} lens
 * @property {string} [profile]
 * @property {MemoryItem[]} memories  // non-profile durable items
 * @property {string} [followUpQuestion]
 * @property {string} [webEvidence]  // formatted search hits for verify/research
 * @property {{ used?: boolean, provider?: string, error?: string }} [webSearchMeta]
 * @property {{ hasProfile: boolean, hasMemories: boolean, personalization: 'none' | 'light' | 'rich', hasWebEvidence: boolean }} flags
 */

/**
 * Build a structured explain context from a (possibly partial) request.
 * @param {ExplainRequest & {
 *   mode?: string,
 *   answerLanguage?: string,
 *   answerDepth?: string,
 *   languageInstruction?: string,
 *   followUpQuestion?: string,
 *   profile?: string,
 *   webEvidence?: string,
 *   webSearchMeta?: { used?: boolean, provider?: string, error?: string },
 * }} request
 * @returns {ExplainContext}
 */
export function buildExplainContext(request) {
  const mode = normalizeMode(request.mode, { lensId: request.lens?.id });
  const rawMemories = Array.isArray(request.memories) ? request.memories : [];

  let profile = (request.profile || "").trim();
  /** @type {MemoryItem[]} */
  const memories = [];
  for (const m of rawMemories) {
    if (!m || !m.content) continue;
    const type = String(m.type || "note");
    const content = String(m.content).trim();
    if (!content) continue;
    if (type === "profile" && !profile) {
      profile = content;
      continue;
    }
    if (type === "profile") {
      // Secondary profile snippets → treat as preference-ish memory
      memories.push({ type: "preference", content });
      continue;
    }
    memories.push({ type, content });
  }

  const hasProfile = Boolean(profile);
  const hasMemories = memories.length > 0;
  const webEvidence = String(request.webEvidence || "").trim();
  const hasWebEvidence = Boolean(webEvidence) && !webEvidence.startsWith("(no web");
  const personalization =
    hasProfile && hasMemories ? "rich" : hasProfile || hasMemories ? "light" : "none";

  return {
    mode,
    answerLanguage: request.answerLanguage,
    answerDepth: request.answerDepth || "normal",
    languageInstruction: request.languageInstruction,
    selection: String(request.selection || "").trim(),
    page: {
      url: request.page?.url || "",
      title: request.page?.title || "",
      context: request.page?.context || undefined,
    },
    lens: {
      id: request.lens?.id || "general",
      instructions: request.lens?.instructions,
    },
    profile: profile || undefined,
    memories,
    followUpQuestion: request.followUpQuestion
      ? String(request.followUpQuestion).slice(0, 400)
      : undefined,
    webEvidence: webEvidence || undefined,
    webSearchMeta: request.webSearchMeta,
    flags: { hasProfile, hasMemories, personalization, hasWebEvidence },
  };
}

/**
 * Default system prompt for the single-shot personalized explainer.
 * @param {ExplainContext} ctx
 * @returns {string}
 */
export function buildSystemPrompt(ctx) {
  const depthLine =
    ctx.answerDepth === "short"
      ? "Length: very short (2–4 lines)."
      : ctx.answerDepth === "detailed"
        ? "Length: thorough but scannable (up to ~12 short lines or a tight list)."
        : "Length: concise (about 3–8 short lines).";

  const personalizationLine =
    ctx.flags.personalization === "none"
      ? "Personalization: no user profile/memories provided. Explain clearly for a general reader; do not invent a persona."
      : ctx.flags.personalization === "rich"
        ? "Personalization: profile + memories are present. Prefer implications that honestly connect to them; never force a weak link."
        : "Personalization: limited user context. Use it when relevant; otherwise explain normally.";

  return [
    "You are WDIMTM (What Does It Mean To Me?) — a browser-native explainer.",
    "The user selected text on a web page. Your job is NOT a generic encyclopedia summary.",
    "Primary question to answer: “What does this mean to me?”",
    "",
    "Input sections you will receive (treat boundaries as hard):",
    "- PAGE FACTS: title, URL, selected text, bounded surrounding context — only these are webpage evidence.",
    "- WEB EVIDENCE (optional): live search snippets with URLs — external evidence, not the page itself.",
    "- USER PROFILE: stable self-description (expertise, role, preferences).",
    "- RELEVANT MEMORIES: durable interests / knowledge / goals / preferences — not the full chat history.",
    "- LENS: how to frame the answer (engineering, investing, opportunities, etc.).",
    "- MODE: which posture to take (explain, why_it_matters, verify, …).",
    "",
    "Behavioral rules:",
    "- Infer what the user likely already knows from profile/memories; avoid re-teaching basics they clearly know.",
    "- Surface the context they are most likely missing for this selection.",
    "- Prioritize implications that matter for THIS user when evidence supports it.",
    "- Separate facts (from page) vs web evidence vs inferences vs opportunity hypotheses. Label speculation.",
    "- When WEB EVIDENCE is present: cite URLs for claims that rely on it; do not invent sources.",
    "- When WEB EVIDENCE is missing or failed: say verification is limited to page text only.",
    "- Do not force personalization: if nothing personal applies, give a clean general explanation.",
    "- Do not invent page facts, citations, or market data.",
    "- Do not open with filler (“Sure!”, “Great question”).",
    "- Markdown is allowed (bold, short lists, links).",
    depthLine,
    personalizationLine,
    ctx.languageInstruction ? `Language: ${ctx.languageInstruction}` : "",
    "",
    `Mode (${ctx.mode}): ${modeInstruction(ctx.mode)}`,
    ctx.lens.instructions
      ? `Lens “${ctx.lens.id}”: ${ctx.lens.instructions}`
      : `Lens: ${ctx.lens.id}`,
    "",
    "Suggested answer shape (adapt freely):",
    "1) Grounding — what the selection is saying (brief).",
    "2) For you — why it might matter given profile/memories (omit if none applies).",
    "3) Facts vs inference — only when useful; for verify, list claims + what web evidence supports/refutes.",
    "4) Optional: one concrete next question or check.",
    "",
    "After the visible answer, always end with 2–3 content-specific follow-up chip labels",
    "(concrete questions about THIS selection — not generic “Explain more”).",
    "Optional: one durable memory suggestion (interest/preference/knowledge/goal only — never dump the whole answer).",
    "Trailers must appear only at the very end:",
    "<<<WDIMTM_FOLLOWUPS>>>",
    "Concrete follow-up question 1?",
    "Concrete follow-up question 2?",
    "<<<END>>>",
    "<<<WDIMTM_MEMORY>>>",
    '{"type":"interest","content":"durable fact about the user","reason":"why suggest"}',
    "<<<END>>>",
    "If no memory is worth saving, omit the MEMORY trailer entirely.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Structured user message with clear section headers.
 * @param {ExplainContext} ctx
 * @returns {string}
 */
export function buildUserPrompt(ctx) {
  /** @type {string[]} */
  const parts = [];

  parts.push("## PAGE FACTS");
  parts.push(`Title: ${ctx.page.title || "(none)"}`);
  parts.push(`URL: ${ctx.page.url || "(none)"}`);
  parts.push("");
  parts.push("### Selected content");
  parts.push(ctx.selection || "(empty selection)");

  if (ctx.page.context) {
    parts.push("");
    parts.push("### Bounded surrounding context");
    parts.push("(Neighborhood text only — not the full page DOM.)");
    parts.push(ctx.page.context);
  }

  parts.push("");
  parts.push("## WEB EVIDENCE");
  parts.push("(Live web search — external sources, not the page. Cite URLs when used.)");
  if (ctx.webEvidence) {
    if (ctx.webSearchMeta?.provider) {
      parts.push(`provider: ${ctx.webSearchMeta.provider}`);
    }
    if (ctx.webSearchMeta?.error && !ctx.flags.hasWebEvidence) {
      parts.push(`status: failed (${ctx.webSearchMeta.error})`);
    }
    parts.push(ctx.webEvidence);
  } else {
    parts.push("(none — no live search for this request)");
  }

  parts.push("");
  parts.push("## USER PROFILE");
  if (ctx.profile) {
    parts.push(ctx.profile);
  } else {
    parts.push("(none provided)");
  }

  parts.push("");
  parts.push("## RELEVANT MEMORIES");
  if (ctx.memories.length) {
    for (const m of ctx.memories) {
      parts.push(`- (${m.type}) ${m.content}`);
    }
  } else {
    parts.push("(none)");
  }

  parts.push("");
  parts.push("## LENS");
  parts.push(`id: ${ctx.lens.id}`);
  if (ctx.lens.instructions) {
    parts.push(`instructions: ${ctx.lens.instructions}`);
  }

  parts.push("");
  parts.push("## MODE / TASK");
  parts.push(`mode: ${ctx.mode}`);
  if (ctx.mode === "probe" || ctx.followUpQuestion) {
    parts.push(
      "Answer this specific follow-up about the selection:",
      ctx.followUpQuestion || "(follow-up)"
    );
  } else if (ctx.mode === "why_it_matters") {
    parts.push(
      "Emphasize personal/practical relevance using PROFILE and MEMORIES when honest."
    );
  } else if (ctx.mode === "verify") {
    parts.push(
      "List checkable claims. Use WEB EVIDENCE when present; cite URLs. No invented sources. If web evidence is missing, say so."
    );
  } else if (ctx.mode === "research") {
    parts.push(
      "Research posture: use WEB EVIDENCE when present; outline open questions and what is supported by sources vs still unknown."
    );
  } else if (ctx.mode === "opportunity") {
    parts.push(
      "Frame opportunity hypotheses separately from facts; label what would falsify them."
    );
  } else if (ctx.mode === "more") {
    parts.push("Go deeper on mechanisms and implications.");
  } else if (ctx.mode === "simplify") {
    parts.push("Explain more simply for a general reader.");
  } else if (ctx.mode === "summarize" || ctx.mode === "summarize-page") {
    parts.push("Summarize for quick scanning.");
  } else {
    parts.push(
      'Answer: what does this selected content mean to me, given profile/memories if any?'
    );
  }

  return parts.join("\n");
}

/**
 * @param {ExplainContext} ctx
 * @returns {{ role: 'system' | 'user', content: string }[]}
 */
export function buildModelMessages(ctx) {
  return [
    { role: "system", content: buildSystemPrompt(ctx) },
    { role: "user", content: buildUserPrompt(ctx) },
  ];
}

/**
 * Diff helper for tests: whether personalization sections are non-empty.
 * @param {ExplainContext} ctx
 */
export function personalizationSummary(ctx) {
  return {
    mode: ctx.mode,
    personalization: ctx.flags.personalization,
    hasProfile: ctx.flags.hasProfile,
    memoryCount: ctx.memories.length,
    lensId: ctx.lens.id,
    userPromptHasProfileSection: buildUserPrompt(ctx).includes("## USER PROFILE"),
    userPromptHasMemoriesSection: buildUserPrompt(ctx).includes("## RELEVANT MEMORIES"),
  };
}
