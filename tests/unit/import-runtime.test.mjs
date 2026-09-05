import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importRuntimeStatus } from "../../core/runtime/completion.js";

describe("importRuntimeStatus", () => {
  it("blocks the default fresh install, which runs on the mock runtime", () => {
    const status = importRuntimeStatus({ runtime: "mock", apiKey: "" });
    assert.equal(status.ready, false);
    assert.equal(status.reason, "mock");
  });

  it("blocks an OpenAI-compatible runtime with no key", () => {
    const status = importRuntimeStatus({ runtime: "openai-compatible", apiKey: "   " });
    assert.equal(status.ready, false);
    assert.equal(status.reason, "missing_key");
  });

  it("allows a configured OpenAI-compatible runtime", () => {
    assert.deepEqual(importRuntimeStatus({ runtime: "openai-compatible", apiKey: "sk-live" }), {
      ready: true,
    });
  });
});
