import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_JOB_STATES,
  RESEARCH_MODES,
  appendStep,
  attachRuntimeRef,
  buildResearchInput,
  canTransition,
  createAgentJob,
  isTerminal,
  normalizeRuntimeError,
  normalizeSources,
  transitionJob,
} from "../../core/agent-job.js";

const SOURCE_CONTEXT = {
  selection: "Sovereign AI budgets are rising in the EU",
  page: { url: "https://example.com/post", title: "EU AI spend" },
};

describe("AgentJob identity and lifecycle", () => {
  it("owns its own id — a runtime execution id is never the primary key", () => {
    const job = createAgentJob({ goal: "Research this", sourceContext: SOURCE_CONTEXT });
    assert.match(job.id, /^job_/);
    assert.equal(job.state, "queued");
    assert.equal(job.runtime, undefined);

    const attached = attachRuntimeRef(job, {
      provider: "promptaas",
      executionId: "exec_999",
      capabilityId: "wdimtm-research",
    });
    assert.equal(attached.id, job.id);
    assert.equal(attached.runtime.executionId, "exec_999");
    assert.equal(attached.runtime.provider, "promptaas");
    assert.notEqual(attached.id, attached.runtime.executionId);
  });

  it("requires a goal and a source context", () => {
    assert.throws(() => createAgentJob({ sourceContext: SOURCE_CONTEXT }), /goal/i);
    assert.throws(() => createAgentJob({ goal: "x" }), /source context/i);
  });

  it("defaults to deep research and accepts opportunity research", () => {
    assert.equal(createAgentJob({ goal: "g", sourceContext: SOURCE_CONTEXT }).mode, "deep_research");
    assert.equal(
      createAgentJob({ goal: "g", sourceContext: SOURCE_CONTEXT, mode: "opportunity_research" })
        .mode,
      "opportunity_research"
    );
    assert.throws(
      () => createAgentJob({ goal: "g", sourceContext: SOURCE_CONTEXT, mode: "watch" }),
      /mode/i
    );
    assert.deepEqual([...RESEARCH_MODES], ["deep_research", "opportunity_research"]);
  });

  it("allows only the documented transitions", () => {
    assert.deepEqual(
      [...AGENT_JOB_STATES],
      ["queued", "running", "succeeded", "failed", "canceled"]
    );
    assert.equal(canTransition("queued", "running"), true);
    assert.equal(canTransition("queued", "canceled"), true);
    assert.equal(canTransition("running", "succeeded"), true);
    assert.equal(canTransition("running", "failed"), true);
    assert.equal(canTransition("running", "canceled"), true);

    assert.equal(canTransition("succeeded", "running"), false);
    assert.equal(canTransition("queued", "succeeded"), false);
    assert.equal(canTransition("canceled", "running"), false);
  });

  it("marks terminal states", () => {
    assert.equal(isTerminal("succeeded"), true);
    assert.equal(isTerminal("failed"), true);
    assert.equal(isTerminal("canceled"), true);
    assert.equal(isTerminal("running"), false);
    assert.equal(isTerminal("queued"), false);
  });

  it("transitions immutably and stamps updatedAt", async () => {
    const job = createAgentJob({ goal: "g", sourceContext: SOURCE_CONTEXT });
    await new Promise((r) => setTimeout(r, 2));
    const running = transitionJob(job, "running");
    assert.equal(job.state, "queued", "original job is not mutated");
    assert.equal(running.state, "running");
    assert.ok(Date.parse(running.updatedAt) >= Date.parse(job.updatedAt));

    const done = transitionJob(running, "succeeded", { result: { summary: "done" } });
    assert.equal(done.result.summary, "done");
    assert.throws(() => transitionJob(done, "running"), /succeeded.*running/i);
  });

  it("records progress steps without losing order", () => {
    let job = createAgentJob({ goal: "g", sourceContext: SOURCE_CONTEXT });
    job = transitionJob(job, "running");
    job = appendStep(job, { label: "Searching" });
    job = appendStep(job, { label: "Reading sources", status: "running" });
    assert.equal(job.steps.length, 2);
    assert.equal(job.steps[0].label, "Searching");
    assert.equal(job.steps[1].status, "running");
    assert.ok(job.steps[0].at);
  });
});

describe("research input contract", () => {
  it("serializes selection, page and personal context within bounds", () => {
    const input = buildResearchInput({
      selection: "x".repeat(5000),
      page: { url: "https://example.com", title: "T", context: "y".repeat(4000) },
      lens: { id: "opportunities" },
      profile: "Indie founder",
      memories: [
        { type: "interest", content: "AI infra" },
        { type: "profile", content: "duplicate profile row" },
      ],
      mode: "opportunity_research",
    });

    assert.ok(input.selection.length <= 4000);
    assert.ok(input.page.context.length <= 2500);
    assert.equal(input.mode, "opportunity_research");
    assert.equal(input.lens.id, "opportunities");
    assert.equal(input.profile, "Indie founder");
    // profile rows are folded into `profile`, not repeated as memories
    assert.deepEqual(
      input.memories.map((m) => m.type),
      ["interest"]
    );
  });

  it("derives a goal from the selection when none is given", () => {
    const input = buildResearchInput({
      selection: "Sovereign AI budgets are rising",
      page: { url: "https://example.com", title: "T" },
    });
    assert.ok(input.goal.includes("Sovereign AI budgets"));
    assert.equal(input.mode, "deep_research");
  });

  it("never carries credentials or full DOM", () => {
    const input = buildResearchInput({
      selection: "s",
      page: { url: "https://example.com", title: "T", context: "c" },
      apiKey: "sk-secret",
      cloudAccessToken: "tok",
    });
    assert.ok(!JSON.stringify(input).includes("sk-secret"));
    assert.ok(!JSON.stringify(input).includes("tok"));
  });
});

describe("result normalization", () => {
  it("normalizes and dedupes sources", () => {
    const sources = normalizeSources([
      { url: "https://a.example/x", title: "A", snippet: "s1" },
      { link: "https://a.example/x", name: "A dup" },
      { url: "https://b.example", title: "B", published_at: "2026-01-01" },
      { title: "no url" },
      "https://c.example",
    ]);
    assert.deepEqual(
      sources.map((s) => s.url),
      ["https://a.example/x", "https://b.example", "https://c.example"]
    );
    assert.equal(sources[0].title, "A");
    assert.equal(sources[1].publishedAt, "2026-01-01");
  });

  it("normalizes runtime errors into product-stable codes", () => {
    assert.equal(normalizeRuntimeError(new Error("429 quota exceeded")).code, "quota");
    assert.equal(normalizeRuntimeError(new Error("request timed out")).code, "timeout");
    assert.equal(normalizeRuntimeError(new Error("401 unauthorized")).code, "unauthorized");
    assert.equal(normalizeRuntimeError(new Error("budget exhausted")).code, "budget_exhausted");
    assert.equal(normalizeRuntimeError(new Error("kaboom")).code, "runtime_error");
    assert.equal(normalizeRuntimeError(new Error("429 quota")).retryable, true);
    assert.equal(normalizeRuntimeError(new Error("401")).retryable, false);
    // Runtime internals must not leak into product copy.
    assert.ok(!normalizeRuntimeError(new Error("promptaas exec_1 crashed")).message.includes("exec_1"));
  });
});
