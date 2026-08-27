/**
 * Light explain modes / intents for dogfood single-shot runtime.
 *
 * Today almost all modes stay single OpenAI-compatible call.
 * capabilityForMode() documents future multi-step / tool routing
 * (likely via PromptaaS) without implementing a router yet.
 */

/** @typedef {import('./types.js').ExplainMode} ExplainMode */

/** Canonical modes supported by the dogfood runtime. */
export const EXPLAIN_MODES = /** @type {const} */ ([
  "explain",
  "more",
  "simplify",
  "why_it_matters",
  "verify",
  "research",
  "opportunity",
  "probe",
  "summarize",
  "summarize-page",
]);

/**
 * Normalize UI / legacy mode strings to a canonical ExplainMode.
 * @param {string} [mode]
 * @param {{ lensId?: string }} [opts]
 * @returns {ExplainMode}
 */
export function normalizeMode(mode, opts = {}) {
  const raw = String(mode || "explain").trim().toLowerCase();
  const aliases = {
    why: "why_it_matters",
    "why-it-matters": "why_it_matters",
    whyitmatters: "why_it_matters",
    opportunities: "opportunity",
    opp: "opportunity",
    factcheck: "verify",
    "fact-check": "verify",
    deeper: "more",
    expand: "more",
    ask: "probe",
    question: "probe",
  };
  let next = /** @type {string} */ (aliases[raw] || raw);

  // Soft lens→mode only when caller used bare "explain" is intentionally NOT done:
  // lens stays orthogonal; opportunity mode is explicit or via follow-up intent.

  if (!EXPLAIN_MODES.includes(/** @type {any} */ (next))) {
    next = "explain";
  }

  // If user forced opportunity lens with opportunities intent already mapped.
  if (opts.lensId === "opportunities" && next === "explain" && mode === "opportunities") {
    next = "opportunity";
  }

  return /** @type {ExplainMode} */ (next);
}

/**
 * Future capability boundary (not executed today).
 * @param {ExplainMode | string} mode
 * @returns {{
 *   kind: 'single_shot' | 'tools' | 'workflow',
 *   status: 'current' | 'future',
 *   tools?: string[],
 *   note?: string,
 * }}
 */
export function capabilityForMode(mode) {
  const m = normalizeMode(mode);
  switch (m) {
    case "verify":
      return {
        kind: "tools",
        status: "current",
        tools: ["web_search"],
        note: "When web search is configured: search then single model call with WEB EVIDENCE. Else page-only verify.",
      };
    case "research":
      return {
        kind: "tools",
        status: "current",
        tools: ["web_search"],
        note: "When web search is configured: search then single model call. Multi-step agent loops still future.",
      };
    case "opportunity":
      return {
        kind: "tools",
        status: "future",
        tools: ["market_data"],
        note: "Today: single-shot opportunity framing. Future: market/data tools.",
      };
    default:
      return {
        kind: "single_shot",
        status: "current",
        note: "Resolved in one OpenAI-compatible (or mock) model call.",
      };
  }
}

/**
 * Short instruction fragment for the active mode (system prompt).
 * @param {ExplainMode | string} mode
 * @returns {string}
 */
export function modeInstruction(mode) {
  const m = normalizeMode(mode);
  const map = {
    explain:
      "Default pass: answer “what does this mean to me?” — brief grounding + personal relevance when earned. Skip encyclopedic basics the user likely already knows.",
    more:
      "User asked for more depth: mechanisms, implications, edge cases. Stay scannable; still personalize only when profile/memories support it.",
    simplify:
      "Simpler pass: short sentences, less jargon, one concrete example. Stay accurate.",
    why_it_matters:
      "Prioritize personal/practical relevance given profile + memories + lens. If no personal link is honest, say so briefly and still clarify the claim.",
    verify:
      "Verification posture: discrete checkable claims, what would confirm/refute, confidence. Use WEB EVIDENCE when provided and cite URLs. If no web evidence, say verification is limited to the page.",
    research:
      "Research posture with optional WEB EVIDENCE: key findings from sources, open questions, known unknowns. One-shot synthesis — not a multi-agent loop.",
    opportunity:
      "Opportunity posture: separate facts vs speculative opportunity hypotheses; label testable next steps. Do not invent market data.",
    probe:
      "Answer the user’s specific follow-up question tightly, still grounded in selection + page context + profile/memories.",
    summarize:
      "Tight scannable summary of the selection: claim, key details, open checks.",
    "summarize-page":
      "Tight scannable summary of bounded page context (not full DOM).",
  };
  return map[m] || map.explain;
}

/**
 * Whether this mode is expected to stay single-shot in dogfood.
 * @param {ExplainMode | string} mode
 */
export function isSingleShotMode(mode) {
  return capabilityForMode(mode).kind === "single_shot" || capabilityForMode(mode).status === "current";
}
