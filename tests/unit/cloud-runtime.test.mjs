import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import {
  cloudPath,
  exchangeGoogleToken,
  fetchCloudAccount,
  pullCloudSnapshot,
  pushCloudSnapshot,
  resolveCloudConfig,
} from "../../core/cloud.js";
import { classifyRuntimeError } from "../../core/runtime-errors.js";
import {
  accessModeToRuntime,
  isRuntimeReady,
  runtimeToAccessMode,
} from "../../core/runtime-presets.js";
import { testCloudConnection } from "../../core/runtime-test.js";
import { explainWithWdimtmCloud } from "../../core/runtime/wdimtm-cloud.js";

/**
 * @param {(req: http.IncomingMessage, res: http.ServerResponse, body: any) => void} handler
 */
async function withServer(handler, run) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      body = {};
    }
    handler(req, res, body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const REQUEST = {
  selection: "Sovereign AI budgets are rising",
  page: { url: "https://example.com/a", title: "Example" },
  lens: { id: "general" },
  mode: "explain",
};

describe("cloud config", () => {
  it("resolves base URL and token, trimming trailing slash", () => {
    const cfg = resolveCloudConfig({
      cloudBaseUrl: "https://cloud.wdimtm.com/ ",
      cloudAccessToken: " tok ",
    });
    assert.equal(cfg.baseUrl, "https://cloud.wdimtm.com");
    assert.equal(cfg.accessToken, "tok");
    assert.equal(cfg.configured, true);
  });

  it("uses the production Cloud origin when base URL is empty", () => {
    const cfg = resolveCloudConfig({});
    assert.equal(cfg.configured, true);
    assert.equal(cfg.baseUrl, "https://cloud.wdimtm.com");
  });

  it("builds versioned paths", () => {
    assert.equal(cloudPath("https://c.example", "/explain"), "https://c.example/v1/explain");
    assert.equal(cloudPath("https://c.example", "explain"), "https://c.example/v1/explain");
  });
});

describe("wdimtm-cloud runtime adapter", () => {
  it("requires a configured base URL", async () => {
    await assert.rejects(
      () => explainWithWdimtmCloud(REQUEST, { baseUrl: "" }),
      /base URL/i
    );
  });

  it("posts the ExplainRequest and normalizes the response", async () => {
    /** @type {any} */
    let seen = null;
    /** @type {string | undefined} */
    let auth;
    const res = await withServer(
      (req, response, body) => {
        seen = body;
        auth = req.headers.authorization;
        assert.equal(req.method, "POST");
        assert.equal(req.url, "/v1/explain");
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            explanation: "Cloud answer",
            summary: "short",
            why_it_matters: "because",
            follow_ups: ["More?"],
            memory_suggestion: { type: "interest", content: "sovereign AI" },
            meta: { entitlement: { plan: "cloud", quotaRemaining: 41 } },
          })
        );
      },
      (baseUrl) =>
        explainWithWdimtmCloud(REQUEST, { baseUrl, accessToken: "tok-123" })
    );

    assert.equal(seen.selection, REQUEST.selection);
    assert.equal(seen.mode, "explain");
    assert.equal(auth, "Bearer tok-123");
    assert.equal(res.explanation, "Cloud answer");
    assert.equal(res.whyItMatters, "because");
    assert.deepEqual(res.followUps, ["More?"]);
    assert.equal(res.memorySuggestion.type, "interest");
    assert.equal(res.runtime, "wdimtm-cloud");
    assert.equal(res.meta.entitlement.quotaRemaining, 41);
  });

  it("streams SSE deltas through onChunk", async () => {
    const chunks = [];
    const res = await withServer(
      (_req, response) => {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write('data: {"delta":"Hel"}\n\n');
        response.write('data: {"delta":"lo"}\n\n');
        response.write('data: {"done":true,"followUps":["Next?"]}\n\n');
        response.end();
      },
      (baseUrl) =>
        explainWithWdimtmCloud(REQUEST, {
          baseUrl,
          accessToken: "tok",
          onChunk: (t) => chunks.push(t),
        })
    );
    assert.deepEqual(chunks, ["Hel", "lo"]);
    assert.equal(res.explanation, "Hello");
    assert.deepEqual(res.followUps, ["Next?"]);
    assert.equal(res.runtime, "wdimtm-cloud");
  });

  it("throws when the stream carries an error frame", async () => {
    // The status line is already 200 by the time upstream fails, so the only
    // way to report it is in-band — the user must still see a real error.
    const err = await withServer(
      (_req, response) => {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write('data: {"delta":"partial"}\n\n');
        response.write('data: {"error":"upstream chat failed (503)"}\n\n');
        response.end();
      },
      (baseUrl) =>
        explainWithWdimtmCloud(REQUEST, {
          baseUrl,
          accessToken: "tok",
          onChunk: () => {},
        }).catch((e) => e)
    );
    assert.ok(err instanceof Error);
    assert.match(err.message, /503/);
  });

  it("surfaces quota errors with cloud-specific copy", async () => {
    await withServer(
      (_req, response) => {
        response.writeHead(429, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "quota exceeded" }));
      },
      async (baseUrl) => {
        const err = await explainWithWdimtmCloud(REQUEST, { baseUrl }).catch((e) => e);
        assert.ok(err instanceof Error);
        const classified = classifyRuntimeError(err, "cloud");
        assert.equal(classified.code, "quota");
        assert.match(classified.message, /WDIMTM Cloud/i);
      }
    );
  });
});

describe("cloud account and memory sync", () => {
  it("reads entitlement from /v1/me", async () => {
    const account = await withServer(
      (req, response) => {
        assert.equal(req.url, "/v1/me");
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            userId: "u1",
            plan: "cloud",
            entitlements: ["explain", "memory_sync"],
            quota: { used: 9, limit: 500, resetAt: "2026-09-01T00:00:00Z" },
          })
        );
      },
      (baseUrl) => fetchCloudAccount({ baseUrl, accessToken: "tok" })
    );
    assert.equal(account.plan, "cloud");
    assert.deepEqual(account.entitlements, ["explain", "memory_sync"]);
    assert.equal(account.quota.limit, 500);
  });

  it("pulls a snapshot and returns null when the cloud has none", async () => {
    const snapshot = await withServer(
      (req, response) => {
        assert.equal(req.url, "/v1/memory");
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            snapshot: { version: 1, updatedAt: "2026-08-01T00:00:00Z", memories: [{ id: "m1" }] },
          })
        );
      },
      (baseUrl) => pullCloudSnapshot({ baseUrl, accessToken: "tok" })
    );
    assert.equal(snapshot.memories.length, 1);

    const empty = await withServer(
      (_req, response) => {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "no snapshot" }));
      },
      (baseUrl) => pullCloudSnapshot({ baseUrl, accessToken: "tok" })
    );
    assert.equal(empty, null);
  });

  it("never pushes secrets in the snapshot", async () => {
    /** @type {any} */
    let sent = null;
    await withServer(
      (req, response, body) => {
        assert.equal(req.method, "POST");
        assert.equal(req.url, "/v1/memory");
        sent = body;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, updatedAt: "2026-08-13T00:00:00Z" }));
      },
      (baseUrl) =>
        pushCloudSnapshot(
          { baseUrl, accessToken: "tok" },
          {
            version: 1,
            updatedAt: "2026-08-13T00:00:00Z",
            memories: [{ id: "m1" }],
            preferences: { apiKey: "sk-leak", cloudAccessToken: "tok", theme: "dark" },
          }
        )
    );
    assert.equal(sent.snapshot.preferences.theme, "dark");
    assert.equal(sent.snapshot.preferences.apiKey, undefined);
    assert.equal(sent.snapshot.preferences.cloudAccessToken, undefined);
  });
});

describe("cloud sign-in exchange", () => {
  it("posts the Google token and returns a WDIMTM session", async () => {
    /** @type {any} */
    let sent = null;
    const out = await withServer(
      (req, response, body) => {
        assert.equal(req.method, "POST");
        assert.equal(req.url, "/v1/auth/google");
        sent = body;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            accessToken: "sess_1",
            expiresAt: "2026-12-01T00:00:00.000Z",
            user: { id: "usr_1", email: "user@example.com" },
            plan: "cloud",
            quota: { used: 0, limit: 1200 },
          })
        );
      },
      (baseUrl) => exchangeGoogleToken({ baseUrl }, "ya29.fake")
    );
    assert.equal(sent.googleAccessToken, "ya29.fake");
    assert.equal(out.accessToken, "sess_1");
    assert.equal(out.user.email, "user@example.com");
  });

  it("classifies an insufficient-credits response as a quota problem", () => {
    const err = new Error("WDIMTM Cloud request failed (402): insufficient_credits");
    const classified = classifyRuntimeError(err, "cloud");
    assert.equal(classified.code, "quota");
    assert.match(classified.message, /credit/i);
  });
});

describe("cloud access mode wiring", () => {
  it("maps the cloud access mode to the wdimtm-cloud runtime", () => {
    assert.equal(accessModeToRuntime("cloud"), "wdimtm-cloud");
    assert.equal(runtimeToAccessMode("wdimtm-cloud"), "cloud");
  });

  it("isRuntimeReady for Cloud requires sign-in token, not a typed base URL", () => {
    // Empty base falls back to production Cloud origin.
    assert.equal(
      isRuntimeReady({ runtime: "wdimtm-cloud", cloudBaseUrl: "" }).reason,
      "missing_cloud_token"
    );
    assert.equal(
      isRuntimeReady({ runtime: "wdimtm-cloud", cloudBaseUrl: "https://c.example" }).reason,
      "missing_cloud_token"
    );
    assert.equal(
      isRuntimeReady({
        runtime: "wdimtm-cloud",
        cloudBaseUrl: "https://c.example",
        cloudAccessToken: "tok",
      }).ok,
      true
    );
    assert.equal(
      isRuntimeReady({
        runtime: "wdimtm-cloud",
        cloudBaseUrl: "",
        cloudAccessToken: "tok",
      }).ok,
      true
    );
  });

  it("testCloudConnection reports plan and quota", async () => {
    // Empty base uses the product default; missing token is the usual failure.
    const missing = await testCloudConnection({ cloudBaseUrl: "", cloudAccessToken: "" });
    assert.equal(missing.ok, false);

    const result = await withServer(
      (req, response) => {
        assert.equal(req.url, "/v1/me");
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ userId: "u1", plan: "cloud", quota: { used: 3, limit: 100 } })
        );
      },
      (baseUrl) => testCloudConnection({ cloudBaseUrl: baseUrl, cloudAccessToken: "tok" })
    );
    assert.equal(result.ok, true);
    assert.match(result.message, /cloud/i);
  });
});
