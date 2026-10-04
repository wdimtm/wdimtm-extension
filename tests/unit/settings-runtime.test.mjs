import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { getSettings } from "../../extension/lib/settings.js";

function stubChromeStorage() {
  const areas = { sync: {}, local: {} };
  const area = (name) => ({
    async get(defaults) {
      const out = { ...(defaults || {}) };
      for (const k of Object.keys(defaults || {})) if (k in areas[name]) out[k] = areas[name][k];
      return out;
    },
    async set(patch) {
      Object.assign(areas[name], patch);
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete areas[name][k];
    },
  });
  globalThis.chrome = { storage: { sync: area("sync"), local: area("local") } };
  return areas;
}

describe("runtime setting", () => {
  /** @type {ReturnType<typeof stubChromeStorage>} */
  let areas;
  beforeEach(() => {
    areas = stubChromeStorage();
  });

  it("starts a fresh install on WDIMTM Cloud", async () => {
    assert.equal((await getSettings()).runtime, "wdimtm-cloud");
  });

  it("moves a stored mock runtime to Cloud", async () => {
    // Mock was the old default, so most installs that never chose anything say mock.
    areas.sync.runtime = "mock";
    assert.equal((await getSettings()).runtime, "wdimtm-cloud");
  });

  it("keeps mock when a dev build asks for it", async () => {
    areas.sync.runtime = "mock";
    areas.sync.devMockRuntime = true;
    assert.equal((await getSettings()).runtime, "mock");
  });

  it("leaves a chosen BYOK runtime alone", async () => {
    areas.sync.runtime = "openai-compatible";
    assert.equal((await getSettings()).runtime, "openai-compatible");
  });
});
