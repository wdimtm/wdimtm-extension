/**
 * Output ceilings and cut-off detection, shared by every runtime.
 *
 * Answer length is steered by the system prompt's depth line, not by
 * max_tokens — max_tokens is only the point at which the provider stops
 * mid-sentence. The old per-runtime budgets (650–900) sat below what a
 * Chinese answer with a code block and its trailers actually needs, so
 * answers were cut short and nothing said so.
 */

/**
 * Reasoning tokens count against the same ceiling as the visible answer. A
 * reasoning model given only the answer budget can spend all of it thinking
 * and return nothing — so it gets this much on top.
 */
export const REASONING_HEADROOM_TOKENS = 4096;

/** Page chat ceiling for the visible reply. */
export const CHAT_MAX_TOKENS = 2000;

/**
 * Visible-answer ceiling per explain mode.
 * @param {string} [mode]
 * @returns {number}
 */
export function tokenBudgetForMode(mode) {
  if (mode === "more" || mode === "research" || mode === "probe") return 2000;
  if (mode === "verify" || mode === "opportunity") return 1700;
  if (mode === "why_it_matters") return 1600;
  return 1500;
}

/**
 * OpenAI-compatible servers do not say whether a model reasons before it
 * answers, so this goes by name: OpenAI o-series / gpt-5, DeepSeek R1 and
 * reasoner, QwQ, and anything that calls itself a thinking or reasoning model.
 * @param {string} [model]
 * @returns {boolean}
 */
export function looksLikeReasoningModel(model) {
  const id = String(model || "").toLowerCase();
  return (
    /(^|[/:])o\d/.test(id) ||
    /(^|[/:])gpt-5/.test(id) ||
    /(^|[^a-z0-9])r1([^0-9]|$)/.test(id) ||
    /reason|thinking|qwq/.test(id)
  );
}

/**
 * OpenAI's own reasoning models (o-series, gpt-5 and later) reject both
 * `max_tokens` and `temperature` on Chat Completions — they take
 * `max_completion_tokens` and fixed sampling. Only a bare OpenAI id counts:
 * a routed id such as OpenRouter's `openai/gpt-5.6-luna` goes to a server that
 * speaks the classic parameters and translates them itself.
 * @param {string} [model]
 * @returns {boolean}
 */
export function wantsOpenAIReasoningParams(model) {
  return /^(o\d|gpt-5)/.test(String(model || "").toLowerCase());
}

/**
 * The output-ceiling and sampling fields of an OpenAI-compatible request.
 * @param {number} answerBudget ceiling for the visible answer
 * @param {string} [model]
 * @param {number} [temperature] dropped where the model rejects it
 * @returns {{ max_tokens: number, temperature?: number } | { max_completion_tokens: number }}
 */
export function openAIOutputParams(answerBudget, model, temperature) {
  const ceiling =
    answerBudget + (looksLikeReasoningModel(model) ? REASONING_HEADROOM_TOKENS : 0);
  if (wantsOpenAIReasoningParams(model)) return { max_completion_tokens: ceiling };
  return {
    max_tokens: ceiling,
    ...(temperature === undefined ? {} : { temperature }),
  };
}

/**
 * What to say when the ceiling was hit before any visible text arrived —
 * almost always a reasoning model that spent the whole budget thinking.
 */
export const CUT_OFF_BEFORE_ANSWER =
  "The model used its whole output budget before writing an answer. Try a shorter selection, or a model that does not reason at length.";

/**
 * True when the provider stopped because it hit the output ceiling rather
 * than because the answer was finished. Covers OpenAI's finish_reason and
 * Anthropic's stop_reason.
 * @param {unknown} reason
 * @returns {boolean}
 */
export function isCutOff(reason) {
  return (
    reason === "length" ||
    reason === "max_tokens" ||
    reason === "model_context_window_exceeded"
  );
}
