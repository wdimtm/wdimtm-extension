import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS } from "../../core/settings-defaults.js";
import { isRuntimeReady } from "../../core/runtime-presets.js";
import { importRuntimeStatus } from "../../core/runtime/completion.js";
import { runChat } from "../../core/runtime/chat.js";
import {
  DEFAULT_RUNTIME_ID,
  RUNTIMES,
  RUNTIME_IDS,
  completionSupportOf,
  getRuntime,
  readinessOf,
  runtimeForExecution,
} from "../../core/runtime/registry.js";

/**
 * @param {http.RequestListener} handler
 * @param {(baseUrl: string, seen: { url?: string, body?: any }) => Promise<void>} run
 */
async function withServer(handler, run) {
  /** @type {{ url?: string, body?: any }} */
  const seen = {};
  const server = http.createServer((req, res) => {
    seen.url = req.url;
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        seen.body = JSON.parse(raw || "{}");
      } catch {
        seen.body = raw;
      }
      handler(req, res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}/v1`, seen);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe("runtime registry", () => {
  it("registers every runtime the settings type allows", () => {
    assert.deepEqual(
      [...RUNTIME_IDS].sort(),
      ["anthropic", "mock", "openai-compatible", "wdimtm-cloud"]
    );
    assert.equal(DEFAULT_RUNTIME_ID, DEFAULT_SETTINGS.runtime);
  });

  it("every entry answers the whole contract", () => {
    for (const entry of RUNTIMES) {
      assert.equal(typeof entry.id, "string", `${entry.id}: id`);
      assert.ok(Array.isArray(entry.settingsKeys), `${entry.id}: settingsKeys`);
      for (const fn of ["configFromSettings", "ready", "ping", "explain", "chat"]) {
        assert.equal(typeof entry[fn], "function", `${entry.id}: ${fn}`);
      }
      assert.equal(typeof entry.completion?.ok, "boolean", `${entry.id}: completion`);
    }
  });

  it("declares only real settings keys", () => {
    for (const entry of RUNTIMES) {
      for (const key of entry.settingsKeys) {
        assert.ok(key in DEFAULT_SETTINGS, `${entry.id}: unknown settings key ${key}`);
      }
    }
  });

  it("configFromSettings renames keys without inventing values", () => {
    // A probe has to be able to tell "not set" from "set to the default", so a
    // blank stays blank here and each runtime applies its own fallback.
    assert.deepEqual(getRuntime("openai-compatible").configFromSettings({}), {
      apiBaseUrl: "",
      apiKey: "",
      model: "",
    });
    assert.deepEqual(
      getRuntime("openai-compatible").configFromSettings(
        { apiBaseUrl: "https://api.example/v1", apiKey: "sk-1", model: "m" },
        { languageInstruction: "Write in English." }
      ),
      {
        apiBaseUrl: "https://api.example/v1",
        apiKey: "sk-1",
        model: "m",
        languageInstruction: "Write in English.",
      }
    );
    assert.deepEqual(
      getRuntime("wdimtm-cloud").configFromSettings({
        cloudBaseUrl: "https://c.example",
        cloudAccessToken: "tok",
      }),
      { baseUrl: "https://c.example", accessToken: "tok" }
    );
      });

  it("mock is told the answer language explicitly, false included", () => {
    const mock = getRuntime("mock");
    // `false` is not the same as absent: it also turns off CJK autodetection.
    assert.equal(mock.configFromSettings({}, { answerLanguage: "en" }).forceZh, false);
    assert.equal(mock.configFromSettings({}, { answerLanguage: "zh_CN" }).forceZh, true);
  });

  it("execution falls back to mock for an unknown runtime", () => {
    assert.equal(runtimeForExecution("nope").id, "mock");
    assert.equal(runtimeForExecution(undefined).id, "mock");
    assert.equal(runtimeForExecution("anthropic").id, "anthropic");
    assert.equal(getRuntime("nope"), undefined);
  });
});

describe("registry readiness", () => {
  // One table, checked against the rule the AI status banner has always used.
  const cases = [
    [{ runtime: "mock" }, false, "mock"],
    [{ runtime: "openai-compatible", apiKey: "", apiBaseUrl: "x" }, false, "missing_byok_key"],
    [{ runtime: "openai-compatible", apiKey: "k", apiBaseUrl: "" }, false, "missing_byok_base"],
    [{ runtime: "openai-compatible", apiKey: "k", apiBaseUrl: "x" }, true, "ready"],
    [
      { runtime: "anthropic", anthropicApiKey: "", anthropicBaseUrl: "x" },
      false,
      "missing_anthropic_key",
    ],
    [
      { runtime: "anthropic", anthropicApiKey: "k", anthropicBaseUrl: "" },
      false,
      "missing_anthropic_base",
    ],
    [{ runtime: "anthropic", anthropicApiKey: "k", anthropicBaseUrl: "x" }, true, "ready"],
    [{ runtime: "wdimtm-cloud", cloudAccessToken: "" }, false, "missing_cloud_token"],
    [{ runtime: "wdimtm-cloud", cloudAccessToken: "t" }, true, "ready"],
    // Legacy client runtime: the UI offers Cloud instead, and says so.
    [{ runtime: "made-up" }, false, "unknown"],
  ];

  it("reproduces the readiness table", () => {
    for (const [settings, ok, reason] of cases) {
      assert.deepEqual(readinessOf(settings), { ok, reason }, JSON.stringify(settings));
    }
  });

  it("is the same rule isRuntimeReady exposes", () => {
    for (const [settings] of cases) {
      assert.deepEqual(isRuntimeReady(settings), readinessOf(settings));
    }
  });
});

describe("registry completion support", () => {
  it("asks for the BYOK key whatever runtime is selected", () => {
    // Import posts its own system prompt to the OpenAI-compatible endpoint, so
    // that is the key it needs — even under Cloud or Anthropic.
    for (const runtime of ["openai-compatible", "anthropic", "wdimtm-cloud", "made-up"]) {
      assert.deepEqual(completionSupportOf(runtime), {
        ok: true,
        keyField: "apiKey",
        missingReason: "missing_key",
      });
      assert.deepEqual(importRuntimeStatus({ runtime, apiKey: "  " }), {
        ready: false,
        reason: "missing_key",
      });
      assert.deepEqual(importRuntimeStatus({ runtime, apiKey: "sk-live" }), { ready: true });
    }
    assert.deepEqual(importRuntimeStatus({ runtime: "mock", apiKey: "sk-live" }), {
      ready: false,
      reason: "mock",
    });
  });
});

describe("registry-routed chat transports", () => {
  it("sends an openai-compatible chat turn through the shared transport", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ choices: [{ message: { content: "Chat reply." } }] })
        );
      },
      async (base, seen) => {
        const result = await runChat(
          {
            selection: "fee switch",
            page: { url: "https://example.com", title: "t" },
            lens: { id: "general" },
            messages: [{ role: "user", content: "who benefits?" }],
          },
          {
            runtime: "openai-compatible",
            apiBaseUrl: base,
            apiKey: "sk-test",
            model: "gpt-4o-mini",
          }
        );
        assert.equal(seen.url, "/v1/chat/completions");
        assert.equal(seen.body.messages[0].role, "system");
        assert.equal(result.runtime, "openai-compatible");
        assert.equal(result.reply, "Chat reply.");
      }
    );
  });

  it("routes an unknown runtime to mock rather than failing", async () => {
    const result = await runChat(
      {
        selection: "hot key overload",
        page: { url: "https://example.com", title: "cache" },
        messages: [{ role: "user", content: "Does this hold up?" }],
        answerLanguage: "en",
      },
      { runtime: "not-a-runtime" }
    );
    assert.equal(result.runtime, "mock");
  });
});
