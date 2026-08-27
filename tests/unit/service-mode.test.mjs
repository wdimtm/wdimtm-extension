import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAPABILITIES,
  CLOUD_TRIGGERS,
  SERVICE_MODES,
  capabilityAvailability,
  capabilityMatrix,
  cloudTriggerFor,
  isCloudConfigured,
  resolveServiceMode,
  serviceModeLabel,
} from "../../core/service-mode.js";

describe("service mode resolution", () => {
  it("exposes exactly local | byok | cloud", () => {
    assert.deepEqual([...SERVICE_MODES], ["local", "byok", "cloud"]);
  });

  it("maps runtime ids onto service modes", () => {
    assert.equal(resolveServiceMode({ runtime: "mock" }), "local");
    assert.equal(resolveServiceMode({ runtime: "openai-compatible" }), "byok");
    assert.equal(resolveServiceMode({ runtime: "anthropic" }), "byok");
    // Legacy Agentaab client runtime — product path is Cloud, Agentaab is internal.
    assert.equal(resolveServiceMode({ runtime: "promptaas" }), "cloud");
    assert.equal(resolveServiceMode({ runtime: "wdimtm-cloud" }), "cloud");
  });

  it("falls back to local for unknown or missing runtime", () => {
    assert.equal(resolveServiceMode({}), "local");
    assert.equal(resolveServiceMode({ runtime: "something-new" }), "local");
    assert.equal(resolveServiceMode(null), "local");
  });

  it("labels modes in en and zh_CN", () => {
    assert.equal(serviceModeLabel("cloud", "en"), "WDIMTM Cloud");
    assert.match(serviceModeLabel("byok", "zh_CN"), /密钥|自带/);
  });

  it("isCloudConfigured treats production default as configured", () => {
    // Empty base still resolves to the product Cloud origin.
    assert.equal(isCloudConfigured({ runtime: "wdimtm-cloud", cloudBaseUrl: "" }), true);
    assert.equal(
      isCloudConfigured({ runtime: "wdimtm-cloud", cloudBaseUrl: "https://cloud.example" }),
      true
    );
    // Configured is about the endpoint, not about the selected runtime.
    assert.equal(
      isCloudConfigured({ runtime: "mock", cloudBaseUrl: "https://cloud.example" }),
      true
    );
  });
});

describe("capability availability", () => {
  it("has unique capability ids", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("keeps the core loop free in every mode", () => {
    for (const mode of SERVICE_MODES) {
      for (const id of ["explain", "local_memory", "custom_lens", "chat_import"]) {
        assert.equal(capabilityAvailability(id, mode).level, "full", `${id} in ${mode}`);
      }
    }
  });

  it("marks cloud-only capabilities unavailable in local and byok", () => {
    for (const id of ["no_api_key", "memory_sync", "cross_device_context", "watch", "durable_agent"]) {
      assert.equal(capabilityAvailability(id, "local").level, "unavailable", id);
      assert.equal(capabilityAvailability(id, "byok").level, "unavailable", id);
      assert.equal(capabilityAvailability(id, "cloud").level, "full", id);
    }
  });

  it("treats research as partial in byok — provider dependent", () => {
    assert.equal(capabilityAvailability("deep_research", "byok").level, "partial");
    assert.equal(capabilityAvailability("deep_research", "local").level, "unavailable");
    assert.equal(capabilityAvailability("deep_research", "cloud").level, "full");
  });

  it("keeps a user's own model available outside cloud", () => {
    assert.equal(capabilityAvailability("own_model", "byok").level, "full");
    assert.equal(capabilityAvailability("own_model", "cloud").level, "partial");
  });

  it("separates what a mode could offer from what WDIMTM has built", () => {
    // The matrix describes the business model, but it also ships in the client.
    // Saying "available" about something nobody can use today is the same
    // false promise as an upgrade wall, just pointing the other way.
    const shipped = capabilityAvailability("explain", "local");
    assert.equal(shipped.status, "shipped");
    assert.equal(shipped.available, true);

    for (const id of ["chat_import", "watch", "durable_agent"]) {
      const state = capabilityAvailability(id, "cloud");
      assert.equal(state.status, "planned", `${id} is not built yet`);
      assert.equal(state.available, false, `${id} must not read as usable`);
      assert.ok(state.why.length > 10, `${id} needs to say why not`);
    }

    // Research is the one that actually shipped in #52.
    const research = capabilityAvailability("deep_research", "cloud");
    assert.equal(research.status, "shipped");
    assert.equal(research.available, true);

    // The matrix carries the same distinction.
    const row = capabilityMatrix().find((c) => c.id === "watch");
    assert.equal(row.status, "planned");
  });

  it("explains why a capability needs the cloud instead of selling an upgrade", () => {
    for (const cap of CAPABILITIES.filter((c) => c.requires === "cloud")) {
      const state = capabilityAvailability(cap.id, "local");
      assert.equal(state.requires, "cloud");
      assert.ok(CLOUD_TRIGGERS.some((t) => t.id === state.trigger), `${cap.id} trigger`);
      assert.ok(state.why.length > 20, `${cap.id} needs a real reason`);
      assert.doesNotMatch(state.why, /upgrade to pro/i);
    }
  });

  it("returns an unknown-capability state instead of throwing", () => {
    const state = capabilityAvailability("teleport", "cloud");
    assert.equal(state.level, "unavailable");
    assert.equal(state.id, "teleport");
  });

  it("cloudTriggerFor resolves the four backend triggers", () => {
    assert.deepEqual(
      CLOUD_TRIGGERS.map((t) => t.id).sort(),
      ["orchestration", "persistence", "synchronization", "trust"]
    );
    assert.equal(cloudTriggerFor("watch").id, "persistence");
    assert.equal(cloudTriggerFor("memory_sync").id, "synchronization");
    assert.equal(cloudTriggerFor("no_api_key").id, "trust");
    assert.equal(cloudTriggerFor("deep_research").id, "orchestration");
    assert.equal(cloudTriggerFor("explain"), null);
  });

  it("capabilityMatrix covers every capability in every mode", () => {
    const matrix = capabilityMatrix();
    assert.equal(matrix.length, CAPABILITIES.length);
    for (const row of matrix) {
      for (const mode of SERVICE_MODES) {
        assert.ok(["full", "partial", "unavailable"].includes(row.modes[mode]), row.id);
      }
    }
  });
});
