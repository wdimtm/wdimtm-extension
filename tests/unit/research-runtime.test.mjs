import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import {
  cancelResearchJob,
  createResearchJobFromExplain,
  getResearchJob,
  listResearchJobs,
  startResearch,
} from "../../core/research-client.js";
import { publicSettings } from "../../extension/lib/settings.js";
import {
  createMockResearchRuntime,
  createPromptAASResearchRuntime,
  mapPromptaasState,
  runResearchToCompletion,
} from "../../core/runtime/research/index.js";

const INPUT = {
  goal: "Research sovereign AI budgets",
  selection: "Sovereign AI budgets are rising",
  page: { url: "https://example.com", title: "T" },
  mode: "deep_research",
};

/**
 * @param {http.RequestListener} handler
 */
async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe("ResearchRuntime interface", () => {
  it("mock runtime implements start / get / cancel", async () => {
    const runtime = createMockResearchRuntime({ ticksToFinish: 2 });
    const ref = await runtime.start(INPUT);
    assert.equal(ref.provider, "mock");
    assert.ok(ref.executionId);

    let state = await runtime.get(ref.executionId);
    assert.equal(state.state, "running");
    state = await runtime.get(ref.executionId);
    assert.equal(state.state, "running");
    state = await runtime.get(ref.executionId);
    assert.equal(state.state, "succeeded");
    assert.ok(state.result.summary);
    assert.ok(state.result.sources.length >= 1);
  });

  it("mock runtime cancels a running execution", async () => {
    const runtime = createMockResearchRuntime({ ticksToFinish: 10 });
    const ref = await runtime.start(INPUT);
    await runtime.cancel(ref.executionId);
    const state = await runtime.get(ref.executionId);
    assert.equal(state.state, "canceled");
  });

  it("runResearchToCompletion drives a job through its lifecycle", async () => {
    const runtime = createMockResearchRuntime({ ticksToFinish: 1 });
    const job = await runResearchToCompletion(runtime, INPUT, { pollMs: 0 });
    assert.equal(job.state, "succeeded");
    assert.match(job.id, /^job_/);
    assert.equal(job.runtime.provider, "mock");
    assert.ok(job.result.sources.length >= 1);
  });
});

describe("PromptAAS research runtime adapter", () => {
  it("maps runtime states onto AgentJob states", () => {
    assert.equal(mapPromptaasState("pending"), "queued");
    assert.equal(mapPromptaasState("queued"), "queued");
    assert.equal(mapPromptaasState("in_progress"), "running");
    assert.equal(mapPromptaasState("running"), "running");
    assert.equal(mapPromptaasState("completed"), "succeeded");
    assert.equal(mapPromptaasState("succeeded"), "succeeded");
    assert.equal(mapPromptaasState("error"), "failed");
    assert.equal(mapPromptaasState("cancelled"), "canceled");
    assert.equal(mapPromptaasState("canceled"), "canceled");
    assert.equal(mapPromptaasState("who-knows"), "running");
  });

  it("runs a Single Agent through the real completion-messages endpoint", async () => {
    /** @type {string[]} */
    const calls = [];
    /** @type {any} */
    let sent = null;
    /** @type {Record<string, string>} */
    let headers = {};

    const ref = await withServer(
      async (req, res) => {
        calls.push(`${req.method} ${req.url}`);
        headers = req.headers;
        const chunks = [];
        for await (const c of req) chunks.push(c);
        sent = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "invocation-uuid",
            answer: JSON.stringify({
              summary: "Findings",
              detail: "The long version.",
              sources: [{ url: "https://a.example", title: "A" }],
            }),
            created_at: "2026-08-13T00:00:00Z",
            metadata: { usage: { input_tokens: 400, output_tokens: 900 } },
          })
        );
      },
      async (baseUrl) => {
        const runtime = createPromptAASResearchRuntime({
          baseUrl,
          appSlug: "wdimtm-research",
          publicToken: "pk_app_token",
          userId: "usr_1",
        });
        assert.equal(runtime.execution, "blocking");
        return runtime.start(INPUT);
      }
    );

    // Chat is the default: agentaab's OpenAI-compatible providers send
    // completion-mode requests to `/completions`, which those endpoints do not
    // serve. Chat mode still substitutes `inputs`, and additionally requires a
    // non-empty `query`.
    assert.deepEqual(calls, ["POST /api/app/wdimtm-research/chat-messages"]);
    assert.equal(sent.query, INPUT.goal);
    assert.equal(sent.inputs.goal, INPUT.goal);
    assert.equal(headers.authorization, "Bearer pk_app_token");
    // PromptaaS runs blocking, so the whole result comes back from start().
    assert.equal(ref.provider, "promptaas");
    assert.equal(ref.executionId, "invocation-uuid");
    assert.equal(ref.capabilityId, "wdimtm-research");
    assert.equal(ref.state.state, "succeeded");
    assert.equal(ref.state.result.summary, "Findings");
    assert.equal(ref.state.result.sources[0].url, "https://a.example");
    assert.equal(ref.state.usage.inputTokens, 400);

    // A stable user id is what makes PromptaaS quota and credits work per user.
    assert.equal(sent.user, "auth:wdimtm:usr_1");
    assert.equal(sent.response_mode, "blocking");
    assert.equal(sent.inputs.goal, INPUT.goal);
    assert.equal(sent.inputs.selection, INPUT.selection);
    assert.equal(sent.inputs.mode, "deep_research");
  });

  it("can target a Workflow app instead of a Single Agent", async () => {
    /** @type {string[]} */
    const calls = [];
    await withServer(
      async (req, res) => {
        calls.push(req.url);
        for await (const _c of req) void _c;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "x", answer: "text" }));
      },
      (baseUrl) =>
        createPromptAASResearchRuntime({
          baseUrl,
          appSlug: "r",
          publicToken: "pk",
          endpoint: "workflow",
        }).start(INPUT)
    );
    assert.deepEqual(calls, ["/api/app/r/workflows/run"]);
  });

  it("reads a prose answer and lifts its markdown links as sources", async () => {
    const ref = await withServer(
      async (req, res) => {
        for await (const _c of req) void _c;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "run-2",
            answer:
              "EU sovereign AI spend is growing.\n\nSee [the budget note](https://eu.example/budget) and [the same one](https://eu.example/budget).",
          })
        );
      },
      (baseUrl) =>
        createPromptAASResearchRuntime({ baseUrl, appSlug: "r", publicToken: "pk" }).start(
          INPUT
        )
    );
    assert.equal(ref.state.state, "succeeded");
    assert.match(ref.state.result.summary, /EU sovereign AI spend/);
    assert.equal(ref.state.result.sources.length, 1, "duplicate urls collapse");
    assert.equal(ref.state.result.sources[0].title, "the budget note");
  });

  it("maps a PromptaaS 402 onto the quota and budget codes", async () => {
    for (const [reason, code] of [
      ["free_quota_exhausted", "quota"],
      ["budget_cap_exhausted", "budget_exhausted"],
    ]) {
      await withServer(
        (_req, res) => {
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Payment required",
              reason,
              runtime_access: { allowed: false, reason, payment_required: true },
            })
          );
        },
        async (baseUrl) => {
          const runtime = createPromptAASResearchRuntime({
            baseUrl,
            appSlug: "r",
            publicToken: "pk",
          });
          const ref = await runtime.start(INPUT);
          assert.equal(ref.state.state, "failed");
          assert.equal(ref.state.error.code, code);
        }
      );
    }
  });

  it("normalizes runtime failures instead of leaking execution internals", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "exec_42 blew up in worker-7" }));
      },
      async (baseUrl) => {
        const runtime = createPromptAASResearchRuntime({
          baseUrl,
          appSlug: "r",
          publicToken: "pk",
        });
        const ref = await runtime.start(INPUT);
        assert.equal(ref.state.state, "failed");
        assert.ok(!JSON.stringify(ref.state).includes("worker-7"));
      }
    );
  });

  it("cannot really cancel a blocking run and says so", async () => {
    const runtime = createPromptAASResearchRuntime({
      baseUrl: "https://p.example",
      appSlug: "r",
      publicToken: "pk",
    });
    // PromptaaS has no cancel endpoint; WDIMTM stops waiting, it does not stop
    // the run. Pretending otherwise would bill a user for work they canceled
    // and told them it was stopped.
    assert.equal(runtime.canCancel, false);
    await runtime.cancel("anything");
  });

  it("runResearchToCompletion does not poll a blocking runtime", async () => {
    let requests = 0;
    const job = await withServer(
      async (req, res) => {
        requests += 1;
        for await (const _c of req) void _c;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "run-3", answer: "Done." }));
      },
      (baseUrl) =>
        runResearchToCompletion(
          createPromptAASResearchRuntime({ baseUrl, appSlug: "r", publicToken: "pk" }),
          INPUT,
          { pollMs: 0 }
        )
    );
    assert.equal(requests, 1, "one call, not a poll loop");
    assert.equal(job.state, "succeeded");
    assert.equal(job.runtime.provider, "promptaas");
    assert.equal(job.runtime.executionId, "run-3");
    assert.notEqual(job.id, job.runtime.executionId);
  });
});

describe("extension research client (WDIMTM Cloud contract)", () => {
  it("posts /v1/research and returns a WDIMTM AgentJob", async () => {
    /** @type {any} */
    let body = null;
    const job = await withServer(
      async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        assert.equal(req.url, "/v1/research");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            job: {
              id: "job_abc",
              state: "queued",
              goal: INPUT.goal,
              createdAt: "2026-08-13T00:00:00Z",
              updatedAt: "2026-08-13T00:00:00Z",
            },
          })
        );
      },
      (baseUrl) => startResearch({ baseUrl, accessToken: "tok" }, INPUT)
    );
    assert.equal(job.id, "job_abc");
    assert.equal(job.state, "queued");
    assert.equal(body.input.goal, INPUT.goal);
    // The extension must not send runtime routing details.
    assert.equal(body.runtime, undefined);
    assert.equal(body.capabilityId, undefined);
  });

  it("reads and cancels a job by WDIMTM id", async () => {
    /** @type {string[]} */
    const calls = [];
    await withServer(
      async (req, res) => {
        calls.push(`${req.method} ${req.url}`);
        for await (const _c of req) void _c;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            job: {
              id: "job_abc",
              state: req.method === "POST" ? "canceled" : "running",
              progress: 0.5,
              goal: INPUT.goal,
              result: null,
            },
          })
        );
      },
      async (baseUrl) => {
        const cfg = { baseUrl, accessToken: "tok" };
        const running = await getResearchJob(cfg, "job_abc");
        assert.equal(running.state, "running");
        const canceled = await cancelResearchJob(cfg, "job_abc");
        assert.equal(canceled.state, "canceled");
      }
    );
    assert.deepEqual(calls, ["GET /v1/jobs/job_abc", "POST /v1/jobs/job_abc/cancel"]);
  });

  it("lists jobs so a durable job survives the tab that started it", async () => {
    /** @type {string[]} */
    const calls = [];
    const jobs = await withServer(
      async (req, res) => {
        calls.push(`${req.method} ${req.url}`);
        for await (const _c of req) void _c;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobs: [{ id: "job_1", state: "running", goal: "G" }] }));
      },
      (baseUrl) => listResearchJobs({ baseUrl, accessToken: "tok" })
    );
    assert.deepEqual(calls, ["GET /v1/jobs"]);
    assert.equal(jobs[0].id, "job_1");
  });

  it("only offers research when a signed-in cloud can actually run it", () => {
    const base = { cloudBaseUrl: "", cloudAccessToken: "" };
    assert.equal(publicSettings({ ...base }).researchReady, false);
    assert.equal(
      publicSettings({ ...base, cloudBaseUrl: "https://cloud.test" }).researchReady,
      false,
      "a base URL without a session is not enough"
    );
    assert.equal(
      publicSettings({ cloudBaseUrl: "https://cloud.test", cloudAccessToken: "tok" })
        .researchReady,
      true
    );
  });

  it("refuses to start research when the cloud is not configured", async () => {
    await assert.rejects(
      () => startResearch({ baseUrl: "" }, INPUT),
      /WDIMTM Cloud/i
    );
  });

  it("escalates an explain moment into a research job request", async () => {
    /** @type {any} */
    let body = null;
    await withServer(
      async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ job: { id: "job_1", state: "queued" } }));
      },
      (baseUrl) =>
        createResearchJobFromExplain(
          { baseUrl, accessToken: "tok" },
          {
            selection: "Sovereign AI budgets are rising",
            page: { url: "https://example.com", title: "T", context: "ctx" },
            lens: { id: "opportunities" },
            profile: "Indie founder",
            memories: [{ type: "interest", content: "AI infra" }],
            mode: "opportunity",
          }
        )
    );
    assert.equal(body.input.mode, "opportunity_research");
    assert.equal(body.input.lens.id, "opportunities");
    assert.equal(body.input.profile, "Indie founder");
    assert.ok(body.input.goal.length > 0);
  });
});
