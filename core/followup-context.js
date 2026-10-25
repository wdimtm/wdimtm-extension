/**
 * What a follow-up carries from the turns before it — pure, so the content
 * script, the runtime and the tests share one answer.
 *
 * A follow-up chip used to be a fresh single-shot request: the model never saw
 * its own earlier answer, so it re-explained the selection every time. Opening
 * page chat seeded only the last answer, as an assistant turn with no question.
 * The popover trail below is the record both of them build on now.
 */

/** Earlier popover turns a follow-up request carries. */
export const MAX_PRIOR_TURNS = 4;
/** Per earlier answer — enough to refer back to, not a full re-send. */
export const MAX_PRIOR_ANSWER = 1500;
export const MAX_PRIOR_QUESTION = 400;
/** Popover turns kept per selection on the client. */
export const MAX_TRAIL_TURNS = 6;

/** Stands in for the question a seeded answer had none of (legacy threads). */
export const DEFAULT_SEED_QUESTION = "Explain the selected text.";

/**
 * @typedef {Object} TrailTurn
 * @property {string} id
 * @property {string} mode
 * @property {string} [question]  // the chip's question or label; empty for the first explain
 * @property {string} answer
 *
 * @typedef {Object} PriorTurn
 * @property {string} mode
 * @property {string} [question]
 * @property {string} answer
 */

/**
 * Bound and clean the earlier turns a request claims. Runs on whatever the
 * client sent — WDIMTM Cloud pays for every character of it.
 * @param {unknown} raw
 * @returns {PriorTurn[]}
 */
export function normalizePriorTurns(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {PriorTurn[]} */
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const rec = /** @type {Record<string, unknown>} */ (t);
    const answer = clip(rec.answer, MAX_PRIOR_ANSWER);
    if (!answer) continue;
    const question = clip(rec.question, MAX_PRIOR_QUESTION);
    out.push({
      mode: String(rec.mode || "explain").slice(0, 40),
      ...(question ? { question } : {}),
      answer,
    });
  }
  return out.slice(-MAX_PRIOR_TURNS);
}

/**
 * The trail as a request field: the newest few turns, bounded.
 * @param {TrailTurn[]} turns
 * @returns {PriorTurn[]}
 */
export function priorTurnsFromTrail(turns) {
  return normalizePriorTurns(
    (Array.isArray(turns) ? turns : []).map((t) => ({
      mode: t.mode,
      question: t.question,
      answer: t.answer,
    }))
  );
}

/**
 * Append one finished popover answer; the oldest fall off past the cap.
 * @param {TrailTurn[]} turns
 * @param {{ mode?: string, question?: string, answer?: string }} turn
 * @returns {TrailTurn[]}
 */
export function appendTrailTurn(turns, turn) {
  const answer = String(turn?.answer || "").trim();
  const list = Array.isArray(turns) ? turns : [];
  if (!answer) return list;
  const id = `pt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const question = String(turn.question || "").trim();
  return [
    ...list,
    { id, mode: String(turn.mode || "explain"), ...(question ? { question } : {}), answer },
  ].slice(-MAX_TRAIL_TURNS);
}

/**
 * Chat messages for popover turns the thread does not hold yet — each answer
 * after the question that produced it, so chat never opens on an assistant
 * turn nobody asked for, and a resumed thread picks up what the popover added.
 *
 * @param {Array<{ role: string, content: string, seedTurnId?: string }>} messages
 * @param {TrailTurn[]} turns
 * @param {{ seedQuestion?: string }} [opts] the UI-language stand-in for a first explain
 * @returns {Array<{ role: 'user' | 'assistant', content: string, seedTurnId: string }>}
 */
export function seedMessagesFor(messages, turns, opts = {}) {
  const have = new Set(
    (Array.isArray(messages) ? messages : []).map((m) => m?.seedTurnId).filter(Boolean)
  );
  const seedQuestion = opts.seedQuestion || DEFAULT_SEED_QUESTION;
  /** @type {Array<{ role: 'user' | 'assistant', content: string, seedTurnId: string }>} */
  const out = [];
  for (const t of Array.isArray(turns) ? turns : []) {
    if (!t?.id || have.has(t.id) || !String(t.answer || "").trim()) continue;
    out.push({ role: "user", content: t.question || seedQuestion, seedTurnId: t.id });
    out.push({ role: "assistant", content: t.answer, seedTurnId: t.id });
  }
  return out;
}

/**
 * The thread as the model should see it.
 *
 * - Error bubbles are UI, not something the assistant said.
 * - Turns a stopped stream left empty are dropped.
 * - What remains is merged so roles alternate: a question whose answer failed
 *   joins the next one instead of standing unanswered.
 * - A thread that opens on an assistant turn (seeded before seeds carried their
 *   question) gets the question back.
 *
 * @template {{ role: string, content?: string, attachments?: Array<any>, error?: boolean }} M
 * @param {M[]} messages
 * @returns {Array<{ role: string, content: string, attachments?: Array<any> }>}
 */
export function chatTurnsForModel(messages) {
  /** @type {Array<{ role: string, content: string, attachments?: Array<any> }>} */
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
    const content = String(m.content || "");
    const attachments = Array.isArray(m.attachments) && m.attachments.length ? m.attachments : null;
    if (role === "assistant" && (m.error === true || !content.trim())) continue;
    if (!content.trim() && !attachments) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) {
      prev.content = [prev.content, content].filter((s) => s.trim()).join("\n\n");
      if (attachments) prev.attachments = [...(prev.attachments || []), ...attachments];
      continue;
    }
    out.push({ role, content, ...(attachments ? { attachments } : {}) });
  }
  const firstTurn = out.findIndex((m) => m.role !== "system");
  if (firstTurn >= 0 && out[firstTurn].role === "assistant") {
    out.splice(firstTurn, 0, { role: "user", content: DEFAULT_SEED_QUESTION });
  }
  return out;
}

/** @param {unknown} v @param {number} max */
function clip(v, max) {
  const s = String(v ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
