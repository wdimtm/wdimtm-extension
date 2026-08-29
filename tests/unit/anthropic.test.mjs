import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import {
  ANTHROPIC_VERSION,
  explainWithAnthropic,
  flattenContent,
  splitSystemMessages,
} from "../../core/runtime/anthropic.js";
import { runChat } from "../../core/runtime/chat.js";
import {
  ANTHROPIC_DEFAULTS,
  accessModeToRuntime,
  isRuntimeReady,
  runtimeToAccessMode,
} from "../../core/runtime-presets.js";
import { testRuntimeConnection } from "../../core/runtime-test.js";

const REQUEST = {
  selection: "the fee switch activates next week",
  page: { url: "https://example.com/post", title: "Fee switch" },
  lens: { id: "general" },
};

/**
 * Start a one-shot server that records the request it received.
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} handler
 */
async function withServer(handler, run) {
  /** @type {{ method?: string, url?: string, headers?: object, body?: any }} */
  const seen = {};
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.method = req.method;
      seen.url = req.url;
      seen.headers = req.headers;
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

function jsonMessage(text) {
  return JSON.stringify({
    id: "msg_1",
    type: "message",
    role: "assistant",
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
  });
}

describe("anthropic runtime", () => {
  it("POSTs /messages with x-api-key, version header, and hoisted system", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(jsonMessage("Claude says hello."));
      },
      async (base, seen) => {
        const result = await explainWithAnthropic(REQUEST, {
          apiBaseUrl: base,
          apiKey: "sk-ant-test",
          model: "claude-opus-5",
        });

        assert.equal(seen.method, "POST");
        assert.equal(seen.url, "/v1/messages");
        assert.equal(seen.headers["x-api-key"], "sk-ant-test");
        assert.equal(seen.headers["anthropic-version"], ANTHROPIC_VERSION);
        assert.equal(seen.headers.authorization, undefined);

        // system is a top-level field, never a message role
        assert.ok(typeof seen.body.system === "string" && seen.body.system.includes("WDIMTM"));
        assert.ok(seen.body.messages.every((m) => m.role !== "system"));
        assert.equal(seen.body.messages.length, 1);
        assert.equal(seen.body.messages[0].role, "user");
        assert.ok(seen.body.messages[0].content.includes("PAGE FACTS"));

        // sampling params are rejected by current Claude models
        assert.equal("temperature" in seen.body, false);
        assert.equal("top_p" in seen.body, false);
        assert.ok(seen.body.max_tokens > 900);

        assert.equal(result.runtime, "anthropic");
        assert.equal(result.explanation, "Claude says hello.");
        assert.equal(result.meta.lensId, "general");
      }
    );
  });

  it("flattens content[] blocks and parses follow-up trailers", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            content: [
              { type: "thinking", thinking: "" },
              { type: "text", text: "First half. " },
              {
                type: "text",
                text:
                  "Second half.\n<<<WDIMTM_FOLLOWUPS>>>\nWho pays the fee?\nWhen does it ship?\n<<<END>>>",
              },
            ],
          })
        );
      },
      async (base) => {
        const result = await explainWithAnthropic(REQUEST, {
          apiBaseUrl: base,
          apiKey: "sk-ant-test",
          model: "claude-opus-5",
        });
        assert.equal(result.explanation, "First half. Second half.");
        assert.deepEqual(
          result.followUps.map((f) => f.question),
          ["Who pays the fee?", "When does it ship?"]
        );
      }
    );
  });

  it("streams content_block_delta text through onChunk", async () => {
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Streamed "}}\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer."}}\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n',
    ].join("\n");

    await withServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sse);
      },
      async (base, seen) => {
        const chunks = [];
        const result = await explainWithAnthropic(REQUEST, {
          apiBaseUrl: base,
          apiKey: "sk-ant-test",
          model: "claude-opus-5",
          onChunk: (t) => chunks.push(t),
        });
        assert.equal(seen.body.stream, true);
        assert.deepEqual(chunks, ["Streamed ", "answer."]);
        assert.equal(result.explanation, "Streamed answer.");
        assert.equal(result.runtime, "anthropic");
      }
    );
  });

  it("classifies HTTP errors through classifyRuntimeError", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "authentication_error" } }));
      },
      async (base) => {
        await assert.rejects(
          () =>
            explainWithAnthropic(REQUEST, {
              apiBaseUrl: base,
              apiKey: "bad",
              model: "claude-opus-5",
            }),
          /API key rejected \(401\)/
        );
      }
    );
  });

  it("requires an API key before touching the network", async () => {
    await assert.rejects(
      () =>
        explainWithAnthropic(REQUEST, {
          apiBaseUrl: "http://127.0.0.1:1/v1",
          apiKey: "",
          model: "claude-opus-5",
        }),
      /API key is required/
    );
  });

  it("surfaces a safety refusal instead of an empty answer", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ stop_reason: "refusal", content: [] }));
      },
      async (base) => {
        await assert.rejects(
          () =>
            explainWithAnthropic(REQUEST, {
              apiBaseUrl: base,
              apiKey: "sk-ant-test",
              model: "claude-opus-5",
            }),
          /declined/
        );
      }
    );
  });
});

describe("anthropic protocol helpers", () => {
  it("splitSystemMessages hoists system and keeps turn order", () => {
    const split = splitSystemMessages([
      { role: "system", content: "rules" },
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "" },
    ]);
    assert.equal(split.system, "rules");
    assert.deepEqual(split.messages, [
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("flattenContent ignores non-text blocks", () => {
    assert.equal(flattenContent([{ type: "thinking", thinking: "x" }, { type: "text", text: "a" }]), "a");
    assert.equal(flattenContent(undefined), "");
  });
});

describe("anthropic page chat", () => {
  it("routes chat to the Messages API instead of falling back to mock", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(jsonMessage("Chat reply."));
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
            runtime: "anthropic",
            anthropicBaseUrl: base,
            anthropicApiKey: "sk-ant-test",
            anthropicModel: "claude-opus-5",
          }
        );
        assert.equal(seen.url, "/v1/messages");
        assert.ok(typeof seen.body.system === "string" && seen.body.system.length > 0);
        assert.equal("temperature" in seen.body, false);
        assert.equal(result.runtime, "anthropic");
        assert.equal(result.reply, "Chat reply.");
      }
    );
  });
});

describe("anthropic registration", () => {
  it("maps Anthropic as a BYOK provider, not a product access mode", () => {
    assert.equal(accessModeToRuntime("byok", "anthropic"), "anthropic");
    assert.equal(runtimeToAccessMode("anthropic"), "byok");
    // default BYOK stays OpenAI-compatible
    assert.equal(accessModeToRuntime("byok"), "openai-compatible");
    assert.equal(runtimeToAccessMode("openai-compatible"), "byok");
  });

  it("isRuntimeReady reports missing anthropic key / base", () => {
    assert.equal(
      isRuntimeReady({
        runtime: "anthropic",
        anthropicApiKey: "",
        anthropicBaseUrl: ANTHROPIC_DEFAULTS.apiBaseUrl,
      }).reason,
      "missing_anthropic_key"
    );
    assert.equal(
      isRuntimeReady({ runtime: "anthropic", anthropicApiKey: "sk-ant-test", anthropicBaseUrl: "" })
        .reason,
      "missing_anthropic_base"
    );
    assert.equal(
      isRuntimeReady({
        runtime: "anthropic",
        anthropicApiKey: "sk-ant-test",
        anthropicBaseUrl: ANTHROPIC_DEFAULTS.apiBaseUrl,
      }).ok,
      true
    );
  });

  it("the registry dispatches the anthropic runtime", async () => {
    const { getRuntime } = await import("../../core/runtime/registry.js");
    const { explainWithAnthropic, chatWithAnthropic } = await import(
      "../../core/runtime/anthropic.js"
    );
    const entry = getRuntime("anthropic");
    assert.equal(entry.explain, explainWithAnthropic);
    assert.equal(entry.chat, chatWithAnthropic);
    assert.deepEqual(
      entry.configFromSettings({
        anthropicBaseUrl: "https://api.anthropic.com/v1",
        anthropicApiKey: "sk-ant-test",
        anthropicModel: "claude-opus-5",
      }),
      {
        apiBaseUrl: "https://api.anthropic.com/v1",
        apiKey: "sk-ant-test",
        model: "claude-opus-5",
      }
    );
  });

  it("manifest grants api.anthropic.com host permission", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve(import.meta.dirname, "../..");
    const manifest = JSON.parse(
      await fs.readFile(path.join(root, "extension/manifest.json"), "utf8")
    );
    assert.ok(manifest.host_permissions.includes("https://api.anthropic.com/*"));
  });

  it("options page surfaces the anthropic access mode", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve(import.meta.dirname, "../..");
    const html = await fs.readFile(path.join(root, "extension/options/options.html"), "utf8");
    assert.ok(html.includes('value="anthropic"'));
    assert.ok(html.includes('id="anthropic-fields"'));
    assert.ok(html.includes('name="anthropicApiKey"'));
  });
});

describe("anthropic connection test", () => {
  it("requires base URL and key", async () => {
    const a = await testRuntimeConnection("anthropic", {
      anthropicBaseUrl: "",
      anthropicApiKey: "sk-ant-test",
      anthropicModel: "claude-opus-5",
    });
    assert.equal(a.ok, false);
    assert.equal(a.code, "missing_anthropic_base");

    const b = await testRuntimeConnection("anthropic", {
      anthropicBaseUrl: ANTHROPIC_DEFAULTS.apiBaseUrl,
      anthropicApiKey: "",
      anthropicModel: "claude-opus-5",
    });
    assert.equal(b.ok, false);
    assert.equal(b.code, "missing_anthropic_key");
  });

  it("pings /messages and reports the reply", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(jsonMessage("ok"));
      },
      async (base, seen) => {
        const result = await testRuntimeConnection("anthropic", {
          anthropicBaseUrl: base,
          anthropicApiKey: "sk-ant-test",
          anthropicModel: "claude-opus-5",
        });
        assert.equal(seen.url, "/v1/messages");
        assert.equal(seen.headers["anthropic-version"], ANTHROPIC_VERSION);
        assert.equal(result.ok, true);
        assert.match(result.message, /Connected/);
      }
    );
  });

  it("classifies a rejected key", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { type: "authentication_error" } }));
      },
      async (base) => {
        const result = await testRuntimeConnection("anthropic", {
          anthropicBaseUrl: base,
          anthropicApiKey: "bad",
          anthropicModel: "claude-opus-5",
        });
        assert.equal(result.ok, false);
        assert.equal(result.code, "unauthorized");
      }
    );
  });
});
