import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { classifyRuntimeError } from "../../core/runtime-errors.js";
import {
  BYOK_PRESETS,
  accessModeToRuntime,
  byokProviderForSettings,
  isRuntimeReady,
  runtimeToAccessMode,
} from "../../core/runtime-presets.js";
import { testRuntimeConnection } from "../../core/runtime-test.js";

describe("runtime presets", () => {
  it("maps product access modes ↔ runtime ids", () => {
    assert.equal(accessModeToRuntime("byok"), "openai-compatible");
    assert.equal(accessModeToRuntime("byok", "openai"), "openai-compatible");
    assert.equal(accessModeToRuntime("byok", "anthropic"), "anthropic");
    assert.equal(accessModeToRuntime("cloud"), "wdimtm-cloud");
    assert.equal(accessModeToRuntime("mock"), "mock");
    // Legacy aliases collapse onto product modes.
    assert.equal(accessModeToRuntime("promptaas"), "wdimtm-cloud");
    assert.equal(accessModeToRuntime("anthropic"), "anthropic");

    assert.equal(runtimeToAccessMode("openai-compatible"), "byok");
    assert.equal(runtimeToAccessMode("anthropic"), "byok");
    assert.equal(runtimeToAccessMode("wdimtm-cloud"), "cloud");
    assert.equal(runtimeToAccessMode("promptaas"), "cloud");
    assert.equal(runtimeToAccessMode("mock"), "mock");
  });

  it("includes common BYOK providers including Anthropic", () => {
    const ids = BYOK_PRESETS.map((p) => p.id);
    assert.ok(ids.includes("openai"));
    assert.ok(ids.includes("openrouter"));
    assert.ok(ids.includes("anthropic"));
    assert.ok(ids.includes("ollama"));
    assert.ok(ids.includes("custom"));
    assert.equal(BYOK_PRESETS.find((p) => p.id === "anthropic")?.protocol, "anthropic");
  });

  it("infers BYOK provider from settings", () => {
    assert.equal(byokProviderForSettings({ runtime: "anthropic" }), "anthropic");
    assert.equal(
      byokProviderForSettings({
        runtime: "openai-compatible",
        apiBaseUrl: "https://api.openai.com/v1",
      }),
      "openai"
    );
    assert.equal(
      byokProviderForSettings({
        runtime: "openai-compatible",
        apiBaseUrl: "https://example.com/v1",
      }),
      "custom"
    );
  });

  it("isRuntimeReady for mock / byok / cloud / anthropic", () => {
    assert.equal(isRuntimeReady({ runtime: "mock" }).ok, false);
    assert.equal(isRuntimeReady({ runtime: "mock" }).reason, "mock");

    assert.equal(
      isRuntimeReady({
        runtime: "openai-compatible",
        apiKey: "",
        apiBaseUrl: "https://api.openai.com/v1",
      }).reason,
      "missing_byok_key"
    );
    assert.equal(
      isRuntimeReady({
        runtime: "openai-compatible",
        apiKey: "sk-test",
        apiBaseUrl: "https://api.openai.com/v1",
      }).ok,
      true
    );

    assert.equal(
      isRuntimeReady({
        runtime: "anthropic",
        anthropicApiKey: "sk-ant",
        anthropicBaseUrl: "https://api.anthropic.com/v1",
      }).ok,
      true
    );

    // Legacy direct Agentaab client path — steer to Cloud.
    assert.equal(isRuntimeReady({ runtime: "promptaas", promptaasBaseUrl: "http://x" }).ok, false);
    assert.equal(
      isRuntimeReady({ runtime: "promptaas", promptaasBaseUrl: "http://x" }).reason,
      "use_cloud"
    );

    assert.equal(
      isRuntimeReady({
        runtime: "wdimtm-cloud",
        cloudBaseUrl: "https://c.example",
        cloudAccessToken: "tok",
      }).ok,
      true
    );
  });
});

describe("classifyRuntimeError", () => {
  it("classifies auth / quota / offline", () => {
    assert.equal(classifyRuntimeError(new Error("401 unauthorized"), "byok").code, "unauthorized");
    assert.equal(
      classifyRuntimeError(new Error("429 rate limit"), "promptaas").code,
      "quota"
    );
    assert.equal(classifyRuntimeError(new Error("Failed to fetch"), "byok").code, "offline");
    assert.equal(classifyRuntimeError(new Error("API key is required"), "byok").code, "missing_key");
    assert.ok(
      classifyRuntimeError(new Error("401"), "promptaas").message.toLowerCase().includes("subscription")
    );
  });
});

describe("connection tests", () => {
  it("testByokConnection requires key and base", async () => {
    const a = await testRuntimeConnection("byok", { apiBaseUrl: "", apiKey: "x", model: "m" });
    assert.equal(a.ok, false);
    assert.equal(a.code, "missing_byok_base");
    const b = await testRuntimeConnection("byok", {
      apiBaseUrl: "https://example.com/v1",
      apiKey: "",
      model: "m",
    });
    assert.equal(b.ok, false);
    assert.equal(b.code, "missing_byok_key");
  });

  it("testByokConnection hits chat completions", async () => {
    const server = http.createServer((req, res) => {
      assert.equal(req.method, "POST");
      assert.match(req.url || "", /\/chat\/completions$/);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        })
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const result = await testRuntimeConnection("byok", {
        apiBaseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "sk-test",
        model: "gpt-test",
      });
      assert.equal(result.ok, true);
      assert.match(result.message, /Connected/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("testByokConnection classifies HTTP errors", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid api key" }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const result = await testRuntimeConnection("byok", {
        apiBaseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "bad",
        model: "m",
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, "unauthorized");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("testPromptaasConnection still works for cloud backend / mocks", async () => {
    const missing = await testRuntimeConnection("promptaas", {
      promptaasBaseUrl: "",
      promptaasAgentId: "wdimtm-explainer",
    });
    assert.equal(missing.ok, false);

    const server = http.createServer((req, res) => {
      assert.match(req.url || "", /\/v1\/agents\/wdimtm-explainer\/run/);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ explanation: "hello" }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const result = await testRuntimeConnection("promptaas", {
        promptaasBaseUrl: `http://127.0.0.1:${port}`,
        promptaasAgentId: "wdimtm-explainer",
        promptaasApiKey: "tok",
      });
      assert.equal(result.ok, true);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
