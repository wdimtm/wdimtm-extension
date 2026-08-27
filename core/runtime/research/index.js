/**
 * ResearchRuntime — the replaceable execution side of a research AgentJob (#52).
 *
 *   interface ResearchRuntime {
 *     start(input): Promise<RuntimeExecutionRef>
 *     get(executionId): Promise<RuntimeExecutionState>
 *     cancel(executionId): Promise<void>
 *   }
 *
 * PromptaaS is the *default* adapter, not a hard dependency: it already owns
 * agents, workflows, provider execution, quota and analytics, so WDIMTM does not
 * rebuild that. Anything WDIMTM-specific — intent, personal context, job
 * lifecycle, result presentation — stays on the WDIMTM side of this boundary.
 *
 * See docs/research-agent-contract.md.
 */

import {
  appendStep,
  attachRuntimeRef,
  createAgentJob,
  isTerminal,
  normalizeRuntimeError,
  normalizeSources,
  transitionJob,
} from "../../agent-job.js";

/**
 * @typedef {Object} RuntimeExecutionRef
 * @property {string} provider
 * @property {string} executionId
 * @property {string} [capabilityId]
 */

/**
 * @typedef {Object} RuntimeExecutionState
 * @property {import('../../lib/agent-job.js').AgentJobState} state
 * @property {number} [progress]
 * @property {Array<{ label: string, status?: string }>} [steps]
 * @property {{ summary?: string, detail?: string, sources: Array<object> }} [result]
 * @property {{ code: string, message: string, retryable?: boolean }} [error]
 */

/**
 * PromptaaS run states → AgentJob states. Unknown states are treated as
 * `running`: an unrecognized state is not a reason to declare a job finished.
 * @param {string} status
 * @returns {import('../../lib/agent-job.js').AgentJobState}
 */
export function mapPromptaasState(status) {
  const s = String(status || "").trim().toLowerCase();
  if (["pending", "queued", "created", "scheduled"].includes(s)) return "queued";
  if (["completed", "succeeded", "success", "done"].includes(s)) return "succeeded";
  if (["error", "failed", "failure"].includes(s)) return "failed";
  if (["cancelled", "canceled", "aborted"].includes(s)) return "canceled";
  return "running";
}

/**
 * The inputs a PromptaaS research capability receives. This is the contract a
 * prompt template or workflow is written against, so it is flat and readable
 * rather than a nested WDIMTM object.
 * @param {object} input from buildResearchInput()
 */
export function toPromptaasInputs(input) {
  return {
    goal: input.goal || "",
    mode: input.mode || "deep_research",
    selection: input.selection || "",
    page_url: input.page?.url || "",
    page_title: input.page?.title || "",
    page_context: input.page?.context || "",
    lens: input.lens?.id || "",
    lens_instructions: input.lens?.instructions || "",
    profile: input.profile || "",
    memories: (input.memories || []).map((m) => `${m.type}: ${m.content}`).join("\n"),
    question: input.question || "",
  };
}

/**
 * Default adapter: PromptaaS Single Agent (or Workflow) runtime.
 *
 * Reality check on the real API (docs/api/api-reference.md in the promptaas
 * repo): execution is a **blocking** call to
 * `POST /api/app/{slug}/completion-messages` or `/workflows/run`. There is no
 * run-status endpoint and no cancel endpoint. So this adapter reports itself as
 * `execution: "blocking"` and returns the finished state from `start()` —
 * inventing a polling API that the runtime does not have would only move the
 * waiting somewhere less honest.
 *
 * Durability therefore belongs to WDIMTM Cloud: it holds the AgentJob in D1 and
 * runs this call in the background, which is exactly the split #52 asks for.
 *
 * @param {{
 *   baseUrl: string,
 *   appSlug: string,
 *   publicToken?: string,
 *   endpoint?: 'completion' | 'workflow',
 *   userId?: string,
 * }} config
 */
export function createPromptAASResearchRuntime(config) {
  const base = String(config?.baseUrl || "").replace(/\/+$/, "");
  const appSlug = String(config?.appSlug || "").trim();
  if (!base) throw new Error("PromptaaS base URL is required for research.");
  if (!appSlug) throw new Error("PromptaaS app slug is required for research.");

  const path =
    config.endpoint === "workflow"
      ? `/api/app/${encodeURIComponent(appSlug)}/workflows/run`
      : `/api/app/${encodeURIComponent(appSlug)}/completion-messages`;

  /** @type {Map<string, RuntimeExecutionState>} */
  const finished = new Map();

  return {
    provider: "promptaas",
    /** PromptaaS answers in one blocking call — see the note above. */
    execution: "blocking",
    /** PromptaaS exposes no cancel endpoint. */
    canCancel: false,

    /**
     * @param {object} input
     * @returns {Promise<RuntimeExecutionRef & { state: RuntimeExecutionState }>}
     */
    async start(input) {
      /** @type {Record<string, string>} */
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      if (config.publicToken) headers.Authorization = `Bearer ${config.publicToken}`;

      const body = {
        inputs: toPromptaasInputs(input),
        response_mode: "blocking",
        // Stable per-user id so PromptaaS quota, credits and analytics land on
        // the right account. `auth:` marks it as an authenticated end user.
        ...(config.userId ? { user: `auth:wdimtm:${config.userId}` } : {}),
      };

      let executionId = "";
      /** @type {RuntimeExecutionState} */
      let state;
      try {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        executionId = String(data?.id || data?.invocation_id || "").trim();

        if (!res.ok) {
          state = { state: "failed", error: promptaasError(res.status, data) };
        } else {
          const answer = typeof data?.answer === "string" ? data.answer : "";
          if (!answer.trim()) {
            state = {
              state: "failed",
              error: normalizeRuntimeError(new Error("research runtime returned no answer")),
            };
          } else {
            state = {
              state: "succeeded",
              progress: 1,
              result: parseResearchAnswer(answer),
              usage: {
                inputTokens: Number(data?.metadata?.usage?.input_tokens) || 0,
                outputTokens: Number(data?.metadata?.usage?.output_tokens) || 0,
              },
            };
          }
        }
      } catch (err) {
        state = { state: "failed", error: normalizeRuntimeError(err) };
      }

      if (!executionId) executionId = `promptaas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      finished.set(executionId, state);
      return { provider: "promptaas", executionId, capabilityId: appSlug, state };
    },

    /**
     * @param {string} executionId
     * @returns {Promise<RuntimeExecutionState>}
     */
    async get(executionId) {
      const state = finished.get(executionId);
      if (!state) throw new Error("Unknown research execution.");
      return state;
    },

    /** No-op by necessity: the run is already in flight upstream. */
    async cancel(executionId) {
      finished.set(executionId, { state: "canceled" });
    },
  };
}

/**
 * PromptaaS denies runtime access with 402 before it spends anything, and
 * distinguishes an end-user quota stop from a creator budget stop.
 * @param {number} status
 * @param {any} data
 */
function promptaasError(status, data) {
  if (status === 402) {
    const reason = String(data?.reason || data?.runtime_access?.reason || "");
    if (reason.includes("budget")) {
      return normalizeRuntimeError(new Error("research budget exhausted"));
    }
    return normalizeRuntimeError(new Error("research quota exhausted"));
  }
  // Never surface the upstream body: it can name executions, workers, providers.
  return normalizeRuntimeError(new Error(`research runtime ${status}`));
}

/**
 * A research capability may answer with structured JSON or with prose. Both are
 * acceptable — WDIMTM normalizes them into one result shape, and prose keeps
 * its citations by lifting markdown links.
 * @param {string} answer
 */
export function parseResearchAnswer(answer) {
  const text = answer.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/);
  const candidate = fenced ? fenced[1] : text;

  if (candidate.startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return {
          summary: String(parsed.summary || parsed.explanation || "").trim(),
          detail: String(parsed.detail || parsed.body || "").trim(),
          sources: normalizeSources(parsed.sources || parsed.citations),
        };
      }
    } catch {
      /* fall through to prose */
    }
  }

  const firstParagraph = text.split(/\n\s*\n/)[0].trim();
  /** @type {Array<{ url: string, title: string }>} */
  const links = [];
  for (const m of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
    links.push({ title: m[1], url: m[2] });
  }
  return {
    summary: firstParagraph,
    detail: text,
    sources: normalizeSources(links),
  };
}

/**
 * Offline / CI runtime. Also what the Local service mode would use if research
 * were ever offered without a backend.
 * @param {{ ticksToFinish?: number }} [opts]
 */
export function createMockResearchRuntime(opts = {}) {
  const ticksToFinish = Math.max(1, opts.ticksToFinish ?? 2);
  /** @type {Map<string, { ticks: number, goal: string, canceled: boolean }>} */
  const runs = new Map();
  let seq = 0;

  return {
    provider: "mock",

    async start(input) {
      seq += 1;
      const executionId = `mock_exec_${seq}`;
      runs.set(executionId, { ticks: 0, goal: input?.goal || "research", canceled: false });
      return { provider: "mock", executionId };
    },

    async get(executionId) {
      const run = runs.get(executionId);
      if (!run) throw new Error("Unknown research execution.");
      if (run.canceled) return { state: "canceled" };
      run.ticks += 1;
      if (run.ticks <= ticksToFinish) {
        return {
          state: "running",
          progress: run.ticks / (ticksToFinish + 1),
          steps: [{ label: `Mock step ${run.ticks}`, status: "succeeded" }],
        };
      }
      return {
        state: "succeeded",
        progress: 1,
        result: {
          summary: `Mock research result for: ${run.goal}`,
          detail: "Offline fixture — no model or search was called.",
          sources: normalizeSources([
            { url: "https://example.com/source-1", title: "Mock source" },
          ]),
        },
      };
    },

    async cancel(executionId) {
      const run = runs.get(executionId);
      if (run) run.canceled = true;
    },
  };
}

/**
 * Drive a runtime through one full AgentJob lifecycle. Used by tests and by a
 * server-side worker; the extension itself only polls `GET /v1/jobs/:id`.
 *
 * @param {{ start: Function, get: Function, cancel: Function }} runtime
 * @param {object} input          from buildResearchInput()
 * @param {{ pollMs?: number, maxPolls?: number }} [opts]
 * @returns {Promise<import('../../lib/agent-job.js').AgentJob>}
 */
export async function runResearchToCompletion(runtime, input, opts = {}) {
  const pollMs = opts.pollMs ?? 1000;
  const maxPolls = opts.maxPolls ?? 120;

  let job = createAgentJob({
    goal: input.goal,
    mode: input.mode,
    sourceContext: { selection: input.selection, page: input.page, lens: input.lens },
    personalContext: input.profile || input.memories ? { profile: input.profile, memories: input.memories } : undefined,
    budget: input.budget,
  });

  /** @type {RuntimeExecutionState | undefined} */
  let settled;
  try {
    const ref = await runtime.start(input);
    job = attachRuntimeRef(job, ref);
    job = transitionJob(job, "running");
    // A blocking runtime (PromptaaS) already finished inside start(); polling it
    // would only re-read a value we are holding.
    if (ref.state && isTerminal(ref.state.state)) settled = ref.state;
  } catch (err) {
    return transitionJob(job, "failed", { error: normalizeRuntimeError(err) });
  }

  if (settled) {
    for (const step of settled.steps || []) job = appendStep(job, step);
    return transitionJob(job, settled.state, {
      ...(settled.result ? { result: settled.result } : {}),
      ...(settled.error ? { error: settled.error } : {}),
    });
  }

  for (let i = 0; i < maxPolls; i += 1) {
    /** @type {RuntimeExecutionState} */
    let state;
    try {
      state = await runtime.get(job.runtime.executionId);
    } catch (err) {
      return transitionJob(job, "failed", { error: normalizeRuntimeError(err) });
    }

    for (const step of state.steps || []) {
      job = appendStep(job, step);
    }

    if (isTerminal(state.state)) {
      return transitionJob(job, state.state, {
        ...(state.result ? { result: state.result } : {}),
        ...(state.error ? { error: state.error } : {}),
      });
    }

    if (pollMs > 0) await new Promise((r) => setTimeout(r, pollMs));
  }

  return transitionJob(job, "failed", {
    error: normalizeRuntimeError(new Error("research timed out")),
  });
}
