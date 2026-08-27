/**
 * WDIMTM AgentJob — the product-owned model for durable research (Issue #52).
 *
 * The rule this file exists to enforce:
 *
 *   **A runtime execution id is never WDIMTM's primary key.**
 *
 * WDIMTM owns the job lifecycle, the goal, the context it was created from and
 * the result the user sees. Whatever executes the work (PromptaaS today, maybe
 * something else later) is referenced through `runtime.executionId` only, so the
 * runtime can be replaced without changing the product contract.
 *
 * See docs/research-agent-contract.md.
 */

import { assertBoundedRequest } from "./context-bounds.js";

/** @typedef {'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'} AgentJobState */
/** @typedef {'deep_research' | 'opportunity_research'} ResearchMode */

export const AGENT_JOB_STATES = /** @type {const} */ ([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);

export const RESEARCH_MODES = /** @type {const} */ ([
  "deep_research",
  "opportunity_research",
]);

/** Allowed transitions. Terminal states are terminal — no resurrection. */
const TRANSITIONS = {
  queued: ["running", "canceled", "failed"],
  running: ["succeeded", "failed", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
};

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/**
 * Explain-mode → research-mode escalation map.
 * @param {string} [mode]
 * @returns {ResearchMode}
 */
export function toResearchMode(mode) {
  const raw = String(mode || "").trim().toLowerCase();
  if (raw === "opportunity" || raw === "opportunity_research" || raw === "opportunities") {
    return "opportunity_research";
  }
  return "deep_research";
}

function newJobId() {
  const rand =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 16) ||
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `job_${rand}`;
}

/**
 * @typedef {Object} AgentJob
 * @property {string} id                       WDIMTM-owned id.
 * @property {string} [userId]
 * @property {string} goal
 * @property {ResearchMode} mode
 * @property {object} sourceContext            selection + page the job came from
 * @property {object} [personalContext]        profile + memories used for relevance
 * @property {AgentJobState} state
 * @property {Array<{ label: string, status?: string, at: string }>} steps
 * @property {string[]} [tools]
 * @property {{ maxSteps?: number, maxSeconds?: number, maxCostUsd?: number }} [budget]
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {{ provider: string, executionId: string, capabilityId?: string }} [runtime]
 * @property {object} [result]
 * @property {{ code: string, message: string, retryable?: boolean }} [error]
 */

/**
 * @param {{
 *   goal: string,
 *   sourceContext: object,
 *   personalContext?: object,
 *   mode?: string,
 *   tools?: string[],
 *   budget?: object,
 *   userId?: string,
 * }} input
 * @returns {AgentJob}
 */
export function createAgentJob(input) {
  const goal = String(input?.goal || "").trim();
  if (!goal) throw new Error("AgentJob requires a goal.");
  if (!input?.sourceContext) throw new Error("AgentJob requires a source context.");

  const mode = input.mode ? String(input.mode) : "deep_research";
  if (!RESEARCH_MODES.includes(/** @type {any} */ (mode))) {
    throw new Error(
      `Unsupported research mode "${mode}". Expected one of: ${RESEARCH_MODES.join(", ")}.`
    );
  }

  const now = new Date().toISOString();
  return {
    id: newJobId(),
    userId: input.userId,
    goal,
    mode: /** @type {ResearchMode} */ (mode),
    sourceContext: input.sourceContext,
    personalContext: input.personalContext,
    state: "queued",
    steps: [],
    tools: input.tools,
    budget: input.budget,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * @param {AgentJobState | string} from
 * @param {AgentJobState | string} to
 */
export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(/** @type {any} */ (to)));
}

/**
 * @param {AgentJobState | string} state
 */
export function isTerminal(state) {
  return TERMINAL.has(String(state));
}

/**
 * Immutable transition — callers keep the previous job for diffing/undo.
 * @param {AgentJob} job
 * @param {AgentJobState} next
 * @param {Partial<AgentJob>} [patch]
 * @returns {AgentJob}
 */
export function transitionJob(job, next, patch = {}) {
  if (!canTransition(job.state, next)) {
    throw new Error(`Invalid AgentJob transition: ${job.state} → ${next}.`);
  }
  return {
    ...job,
    ...patch,
    state: next,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Attach the external execution reference. The job id never changes.
 * @param {AgentJob} job
 * @param {{ provider: string, executionId: string, capabilityId?: string }} ref
 * @returns {AgentJob}
 */
export function attachRuntimeRef(job, ref) {
  if (!ref?.provider || !ref?.executionId) {
    throw new Error("Runtime reference requires provider and executionId.");
  }
  return {
    ...job,
    runtime: {
      provider: ref.provider,
      executionId: ref.executionId,
      ...(ref.capabilityId ? { capabilityId: ref.capabilityId } : {}),
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * @param {AgentJob} job
 * @param {{ label: string, status?: string }} step
 * @returns {AgentJob}
 */
export function appendStep(job, step) {
  const label = String(step?.label || "").trim();
  if (!label) return job;
  return {
    ...job,
    steps: [...(job.steps || []), { label, status: step.status || "running", at: new Date().toISOString() }],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Selection / page / personal context serialization for a research job.
 * Same privacy bounds as Explain: bounded neighborhood, never the full DOM,
 * and never a credential.
 *
 * @param {{
 *   selection?: string,
 *   page?: { url?: string, title?: string, context?: string },
 *   lens?: { id?: string, instructions?: string },
 *   profile?: string,
 *   memories?: Array<{ type?: string, content?: string }>,
 *   mode?: string,
 *   goal?: string,
 *   question?: string,
 *   budget?: object,
 * }} params
 */
export function buildResearchInput(params) {
  const selection = String(params?.selection || "").slice(0, 4000);
  const page = {
    url: params?.page?.url || "",
    title: params?.page?.title || "",
    ...(params?.page?.context
      ? { context: String(params.page.context).slice(0, 2500) }
      : {}),
  };

  // Re-check the shared bounds so a research path can never widen them.
  assertBoundedRequest({ selection, page });

  let profile = String(params?.profile || "").trim();
  /** @type {Array<{ type: string, content: string }>} */
  const memories = [];
  for (const m of params?.memories || []) {
    const content = String(m?.content || "").trim();
    if (!content) continue;
    if (m?.type === "profile") {
      if (!profile) profile = content;
      continue;
    }
    memories.push({ type: String(m?.type || "note"), content });
  }

  const goal =
    String(params?.goal || "").trim() ||
    `Research this and report what it means for me: “${selection.slice(0, 180)}${
      selection.length > 180 ? "…" : ""
    }”`;

  return {
    goal,
    mode: toResearchMode(params?.mode),
    selection,
    page,
    ...(params?.lens?.id ? { lens: { id: params.lens.id, instructions: params.lens.instructions } } : {}),
    ...(profile ? { profile } : {}),
    ...(memories.length ? { memories } : {}),
    ...(params?.question ? { question: String(params.question).slice(0, 400) } : {}),
    ...(params?.budget ? { budget: params.budget } : {}),
  };
}

/**
 * Citations, normalized across runtimes and deduped by URL.
 * @param {unknown} raw
 * @returns {Array<{ url: string, title?: string, snippet?: string, publishedAt?: string }>}
 */
export function normalizeSources(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Map<string, { url: string, title?: string, snippet?: string, publishedAt?: string }>} */
  const seen = new Map();
  for (const item of raw) {
    if (typeof item === "string") {
      if (/^https?:\/\//.test(item) && !seen.has(item)) seen.set(item, { url: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = /** @type {Record<string, unknown>} */ (item);
    const url = String(rec.url || rec.link || rec.href || "").trim();
    if (!url || seen.has(url)) continue;
    const title = String(rec.title || rec.name || "").trim();
    const snippet = String(rec.snippet || rec.summary || rec.description || "").trim();
    const publishedAt = String(rec.publishedAt || rec.published_at || rec.date || "").trim();
    seen.set(url, {
      url,
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    });
  }
  return [...seen.values()];
}

/**
 * Runtime failures → product-stable error codes. Execution internals stay out
 * of user-facing copy.
 * @param {unknown} err
 * @returns {{ code: string, message: string, retryable: boolean }}
 */
export function normalizeRuntimeError(err) {
  const raw = err instanceof Error ? err.message : String(err || "");
  const lower = raw.toLowerCase();

  if (lower.includes("429") || lower.includes("quota") || lower.includes("rate limit")) {
    return {
      code: "quota",
      message: "Research stopped: the quota for this plan is used up.",
      retryable: true,
    };
  }
  if (lower.includes("budget")) {
    return {
      code: "budget_exhausted",
      message: "Research stopped: this job hit its budget before finishing.",
      retryable: false,
    };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return {
      code: "timeout",
      message: "Research timed out. Try a narrower goal.",
      retryable: true,
    };
  }
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return {
      code: "unauthorized",
      message: "Research could not start: sign in to WDIMTM Cloud again.",
      retryable: false,
    };
  }
  if (lower.includes("cancel")) {
    return { code: "canceled", message: "Research was canceled.", retryable: false };
  }
  if (!raw || lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return {
      code: "offline",
      message: "Cannot reach WDIMTM Cloud to run research.",
      retryable: true,
    };
  }
  return {
    code: "runtime_error",
    message: "Research failed while running. Try again.",
    retryable: true,
  };
}
