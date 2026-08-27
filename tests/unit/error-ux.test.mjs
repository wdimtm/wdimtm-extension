import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { classifyRuntimeError } from "../../core/runtime-errors.js";
import { publicSettings, topUpUrlFor } from "../../extension/lib/settings.js";
import { explainWithOpenAICompatible } from "../../core/runtime/openai-compatible.js";

const REQUEST = {
  selection: "Sovereign AI budgets are rising",
  page: { url: "https://example.com", title: "T" },
};

/** @param {http.RequestListener} handler */
async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

describe("request deadlines reach the runtimes", () => {
  it("gives up on a server that never answers, instead of hanging forever", async () => {
    const err = await withServer(
      () => {
        /* accept the request and never respond */
      },
      (baseUrl) =>
        explainWithOpenAICompatible(REQUEST, {
          apiBaseUrl: baseUrl,
          apiKey: "sk-test",
          model: "m",
          // Short deadlines are the point of the test; the shipped defaults are
          // covered in request-timeout.test.mjs.
          timeouts: { firstByteMs: 80 },
        }).catch((e) => e)
    );
    assert.ok(err instanceof Error);
    // Whatever the wording, it must not be a bare AbortError.
    assert.doesNotMatch(err.message, /^AbortError/);
    assert.match(err.message, /timed out/i);
    assert.equal(classifyRuntimeError(err, "byok").code, "timeout");
  });

  it("stops the request when the user cancels", async () => {
    let sawRequest = false;
    const controller = new AbortController();
    const err = await withServer(
      () => {
        sawRequest = true;
        controller.abort();
      },
      (baseUrl) =>
        explainWithOpenAICompatible(REQUEST, {
          apiBaseUrl: baseUrl,
          apiKey: "sk-test",
          model: "m",
          signal: controller.signal,
        }).catch((e) => e)
    );
    assert.ok(sawRequest, "the request was actually sent");
    assert.ok(err instanceof Error);
    assert.match(err.message, /cancel/i);
  });

  it("does not cut off an answer that is still streaming", async () => {
    const chunks = [];
    const res = await withServer(
      async (_req, response) => {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const d of ["Sov", "ereign", " spend."]) {
          response.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`
          );
          await new Promise((r) => setTimeout(r, 40));
        }
        response.end("data: [DONE]\n\n");
      },
      (baseUrl) =>
        explainWithOpenAICompatible(REQUEST, {
          apiBaseUrl: baseUrl,
          apiKey: "sk-test",
          model: "m",
          onChunk: (c) => chunks.push(c),
        })
    );
    assert.deepEqual(chunks, ["Sov", "ereign", " spend."]);
    assert.equal(res.explanation, "Sovereign spend.");
  });
});

describe("quota exhaustion offers a way out (#41)", () => {
  it("classifies a hosted 402 as a quota problem in cloud mode", () => {
    const classified = classifyRuntimeError(
      new Error("WDIMTM Cloud request failed (402): insufficient_credits"),
      "cloud"
    );
    assert.equal(classified.code, "quota");
    assert.match(classified.message, /credits/i);
    // Never a dead end: the copy names the alternatives.
    assert.match(classified.message, /own API key|plan|reset/i);
  });

  it("points top-up at whichever paid path the user is actually on", () => {
    assert.equal(
      topUpUrlFor({ runtime: "wdimtm-cloud", cloudSignUpUrl: "https://cloud.example/plan" }),
      "https://cloud.example/plan"
    );
    assert.equal(
      topUpUrlFor({ runtime: "promptaas", promptaasSubscribeUrl: "https://p.example/sub" }),
      "https://p.example/sub"
    );
    // BYOK and mock have nothing to top up — the popover must not pretend they do.
    assert.equal(topUpUrlFor({ runtime: "openai-compatible", cloudSignUpUrl: "x" }), "");
    assert.equal(topUpUrlFor({ runtime: "mock" }), "");
  });

  it("hands the content script a top-up destination without any secret", () => {
    const pub = publicSettings({
      runtime: "wdimtm-cloud",
      cloudSignUpUrl: "https://cloud.example/plan",
      cloudAccessToken: "secret-token",
      apiKey: "sk-secret",
    });
    assert.equal(pub.topUpUrl, "https://cloud.example/plan");
    assert.ok(!JSON.stringify(pub).includes("secret-token"));
    assert.ok(!JSON.stringify(pub).includes("sk-secret"));
  });
});
