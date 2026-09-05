import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { SECRET_KEYS, getSettings, saveSettings } from "../../extension/lib/settings.js";

/**
 * Minimal chrome.storage double with two independent areas, so a test can
 * assert which area a value actually landed in.
 * @returns {{ sync: Record<string, unknown>, local: Record<string, unknown> }}
 */
function stubChromeStorage() {
  const areas = { sync: {}, local: {} };
  const area = (name) => ({
    async get(defaults) {
      const keys = defaults && typeof defaults === "object" ? Object.keys(defaults) : [];
      const out = { ...(defaults || {}) };
      for (const k of keys) if (k in areas[name]) out[k] = areas[name][k];
      return out;
    },
    async set(patch) {
      Object.assign(areas[name], patch);
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete areas[name][k];
    },
    async clear() {
      areas[name] = {};
    },
  });
  globalThis.chrome = { storage: { sync: area("sync"), local: area("local") } };
  return areas;
}

describe("settings secret storage", () => {
  /** @type {ReturnType<typeof stubChromeStorage>} */
  let areas;
  beforeEach(() => {
    areas = stubChromeStorage();
  });

  it("names every credential field as a secret", () => {
    assert.deepEqual([...SECRET_KEYS].sort(), [
      "anthropicApiKey",
      "apiKey",
      "cloudAccessToken",
      "webSearchApiKey",
    ]);
  });

  it("writes secrets to local and everything else to sync", async () => {
    await saveSettings({
      apiKey: "sk-secret",
      webSearchApiKey: "tvly-secret",
      model: "gpt-4o-mini",
      answerDepth: "short",
    });

    assert.equal(areas.local.apiKey, "sk-secret");
    assert.equal(areas.local.webSearchApiKey, "tvly-secret");
    assert.equal(areas.sync.model, "gpt-4o-mini");
    assert.equal(areas.sync.answerDepth, "short");

    // The point of the split: nothing secret may reach the synced store, which
    // Chrome uploads to the user's Google account.
    for (const k of SECRET_KEYS) {
      assert.ok(!(k in areas.sync), `${k} must not be written to chrome.storage.sync`);
    }
  });

  it("reads secrets back out of local storage", async () => {
    await saveSettings({ apiKey: "sk-abc", model: "gpt-4o-mini" });
    const settings = await getSettings();
    assert.equal(settings.apiKey, "sk-abc");
    assert.equal(settings.model, "gpt-4o-mini");
  });

  it("migrates a key stranded in sync by an older version", async () => {
    areas.sync.apiKey = "sk-previously-synced";
    areas.sync.model = "gpt-4o-mini";

    const settings = await getSettings();

    // Usable across the migration — the user does not lose their key.
    assert.equal(settings.apiKey, "sk-previously-synced");
    assert.equal(areas.local.apiKey, "sk-previously-synced");
    // Leaving the synced copy behind would defeat the migration.
    assert.ok(!("apiKey" in areas.sync), "the synced copy must be deleted");
  });

  it("prefers the local value when both areas hold one", async () => {
    areas.sync.apiKey = "sk-stale-synced";
    areas.local.apiKey = "sk-current-local";

    const settings = await getSettings();

    assert.equal(settings.apiKey, "sk-current-local");
    assert.ok(!("apiKey" in areas.sync));
  });

  it("leaves sync untouched when there is nothing to migrate", async () => {
    areas.sync.model = "gpt-4o-mini";
    await getSettings();
    assert.deepEqual(Object.keys(areas.sync), ["model"]);
  });
});
