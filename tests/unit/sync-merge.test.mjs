import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeSnapshots, snapshotToLocalChanges } from "../../core/auth/snapshot-merge.js";

const mem = (id, text, updatedAt) => ({ id, type: "note", text, source: "explicit", confidence: 1, createdAt: updatedAt, updatedAt });

describe("mergeSnapshots", () => {
  it("keeps memories added on both devices instead of dropping one side", () => {
    const local = { updatedAt: "2026-02-02T00:00:00Z", memories: [mem("a", "本机新增", "2026-02-02T00:00:00Z")] };
    const remote = { updatedAt: "2026-02-01T00:00:00Z", memories: [mem("b", "另一台新增", "2026-02-01T00:00:00Z")] };
    const merged = mergeSnapshots(local, remote);
    assert.deepEqual(merged.memories.map((m) => m.id).sort(), ["a", "b"]);
  });

  it("takes the newer copy when both sides edited the same memory", () => {
    const local = { updatedAt: "2026-02-01T00:00:00Z", memories: [mem("a", "旧", "2026-02-01T00:00:00Z")] };
    const remote = { updatedAt: "2026-02-01T00:00:00Z", memories: [mem("a", "新", "2026-02-03T00:00:00Z")] };
    assert.equal(mergeSnapshots(local, remote).memories[0].text, "新");
  });

  it("lets the side with the newer settings stamp win profile, lenses and preferences", () => {
    const local = { updatedAt: "2026-03-01T00:00:00Z", fieldsUpdatedAt: "2026-01-01T00:00:00Z", profileText: "旧", customLenses: [], preferences: { theme: "light" }, memories: [] };
    const remote = { updatedAt: "2026-02-01T00:00:00Z", fieldsUpdatedAt: "2026-02-01T00:00:00Z", profileText: "新", customLenses: [{ id: "x" }], preferences: { theme: "dark" }, memories: [] };
    const merged = mergeSnapshots(local, remote);
    assert.equal(merged.profileText, "新");
    assert.equal(merged.preferences.theme, "dark");
    assert.deepEqual(merged.customLenses, [{ id: "x" }]);
  });

  it("returns the other side when one is missing", () => {
    const snap = { updatedAt: "2026-01-01T00:00:00Z", memories: [] };
    assert.equal(mergeSnapshots(snap, null), snap);
    assert.equal(mergeSnapshots(null, snap), snap);
  });
});

describe("snapshotToLocalChanges", () => {
  const remote = {
    updatedAt: "2026-02-01T00:00:00Z",
    fieldsUpdatedAt: "2026-02-01T00:00:00Z",
    profileText: "远端画像",
    customLenses: [{ id: "x" }],
    memories: [mem("b", "远端记忆", "2026-02-01T00:00:00Z")],
    preferences: {
      theme: "dark",
      answerDepth: "detailed",
      // 这些决定“凭据发往哪里”或本机账号状态，不能被远端快照改写。
      apiBaseUrl: "https://evil.example/v1",
      cloudBaseUrl: "https://evil.example",
      accountMode: "local",
      syncSecrets: true,
      runtime: "openai-compatible",
    },
  };

  it("writes remote data back as a settings patch plus the full memory list", () => {
    const { settings, memories } = snapshotToLocalChanges(remote, { syncPreferences: true });
    assert.equal(settings.profileText, "远端画像");
    assert.deepEqual(settings.customLenses, [{ id: "x" }]);
    assert.equal(settings.theme, "dark");
    assert.equal(settings.answerDepth, "detailed");
    assert.deepEqual(memories.map((m) => m.id), ["b"]);
  });

  it("never touches endpoints, secrets flag, account mode or runtime", () => {
    const { settings } = snapshotToLocalChanges(remote, { syncPreferences: true });
    for (const key of ["apiBaseUrl", "cloudBaseUrl", "accountMode", "syncSecrets", "runtime"]) {
      assert.equal(key in settings, false, key);
    }
  });

  it("leaves profile, lenses and preferences alone when the user turned preference sync off", () => {
    const { settings, memories } = snapshotToLocalChanges(remote, { syncPreferences: false });
    assert.deepEqual(settings, {});
    assert.equal(memories.length, 1);
  });
});
