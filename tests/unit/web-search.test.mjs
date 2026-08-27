import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSearchQuery,
  formatSearchStatusLabel,
  formatWebEvidence,
  humanizeSearchError,
  isWebSearchConfigured,
  modeWantsWebSearch,
  runWebSearch,
} from "../../core/web-search.js";
import { buildExplainContext, buildUserPrompt } from "../../core/explain-context.js";
import { capabilityForMode } from "../../core/modes.js";

describe("web search helpers", () => {
  it("modeWantsWebSearch for verify/research/chat and fact-check lens", () => {
    assert.equal(modeWantsWebSearch("verify"), true);
    assert.equal(modeWantsWebSearch("research"), true);
    assert.equal(modeWantsWebSearch("chat"), true);
    assert.equal(modeWantsWebSearch("explain", "fact-check"), true);
    assert.equal(modeWantsWebSearch("explain", "general"), false);
  });

  it("buildSearchQuery prefers selection", () => {
    const q = buildSearchQuery("hot key overload on one shard", "Caching docs");
    assert.match(q, /hot key/);
  });

  it("runWebSearch tavily with mock fetch", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Hot keys",
              url: "https://example.com/hot",
              content: "A hot key concentrates load.",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    const r = await runWebSearch({
      provider: "tavily",
      apiKey: "tvly-test",
      query: "hot key cache",
      fetchImpl,
    });
    assert.equal(r.used, true);
    assert.equal(r.hits.length, 1);
    assert.match(formatWebEvidence(r), /example.com\/hot/);
  });

  it("runWebSearch default fetch is invokable without Illegal invocation", async () => {
    // Simulate service-worker style: unbound method would throw Illegal invocation.
    const realFetch = globalThis.fetch;
    let called = false;
    /** @type {typeof fetch} */
    const boundLike = Object.assign(
      function fakeFetch(input, init) {
        // If caller does `const f = globalThis.fetch; f(...)` with a method that
        // requires `this`, it throws — our wrapper must not do that.
        if (this == null || this === globalThis) {
          called = true;
          return Promise.resolve(
            new Response(JSON.stringify({ results: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        throw new TypeError(
          "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation"
        );
      },
      { preconnect: realFetch?.preconnect }
    );
    // Assign as global fetch without auto-bind (like WorkerGlobalScope).
    // @ts-ignore
    globalThis.fetch = boundLike;
    try {
      const r = await runWebSearch({
        provider: "tavily",
        apiKey: "tvly-test",
        query: "x",
      });
      assert.equal(called, true);
      assert.equal(r.error, undefined);
      assert.equal(r.used, false); // empty results, not a throw
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("runWebSearch degrades without key", async () => {
    const r = await runWebSearch({
      provider: "tavily",
      apiKey: "",
      query: "x",
    });
    assert.equal(r.used, false);
    assert.equal(r.error, "missing_api_key");
  });

  it("injects WEB EVIDENCE into user prompt", () => {
    const ctx = buildExplainContext({
      selection: "claim about market size",
      page: { url: "https://x.com/a", title: "post" },
      mode: "verify",
      webEvidence: "[1] Source\nURL: https://news.example/a\nSnippet here",
      webSearchMeta: { used: true, provider: "tavily" },
    });
    const user = buildUserPrompt(ctx);
    assert.match(user, /## WEB EVIDENCE/);
    assert.match(user, /news.example/);
    assert.equal(ctx.flags.hasWebEvidence, true);
  });

  it("marks verify capability as current tools", () => {
    const c = capabilityForMode("verify");
    assert.equal(c.kind, "tools");
    assert.equal(c.status, "current");
    assert.ok(c.tools?.includes("web_search"));
  });

  it("isWebSearchConfigured requires enable + provider + key", () => {
    assert.equal(
      isWebSearchConfigured({
        webSearchEnabled: true,
        webSearchProvider: "tavily",
        webSearchApiKey: "k",
      }),
      true
    );
    assert.equal(
      isWebSearchConfigured({
        webSearchEnabled: false,
        webSearchProvider: "tavily",
        webSearchApiKey: "k",
      }),
      false
    );
    assert.equal(
      isWebSearchConfigured({
        webSearchEnabled: true,
        webSearchProvider: "none",
        webSearchApiKey: "k",
      }),
      false
    );
  });

  it("humanizeSearchError and status labels", () => {
    assert.match(humanizeSearchError("missing_api_key", { zh: true }), /API Key/);
    assert.match(
      formatSearchStatusLabel({ status: "not_configured" }, { zh: true }),
      /未开启/
    );
    assert.match(
      formatSearchStatusLabel({ status: "ok", used: true, provider: "tavily", resultCount: 3 }),
      /tavily/
    );
  });
});
