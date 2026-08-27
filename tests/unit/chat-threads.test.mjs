/**
 * Page chat threads must survive a second selection on the same page.
 * Regression cover for the overwrite bug: opening chat for selection B used to
 * blow away the stored thread for selection A.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

/** Minimal in-memory chrome.storage.session stub. */
function installStorageStub() {
  const store = new Map();
  globalThis.chrome = {
    storage: {
      session: {
        async get(defaults) {
          if (defaults == null) return Object.fromEntries(store);
          if (typeof defaults === "string") {
            return store.has(defaults) ? { [defaults]: store.get(defaults) } : {};
          }
          /** @type {Record<string, unknown>} */
          const out = {};
          for (const [k, fallback] of Object.entries(defaults)) {
            out[k] = store.has(k) ? store.get(k) : fallback;
          }
          return out;
        },
        async set(items) {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        async remove(key) {
          store.delete(key);
        },
      },
    },
  };
  return store;
}

const URL_A = "https://example.com/post/1?utm=x";

/** @type {typeof import("../../extension/lib/chat.js")} */
let chat;

describe("page chat threads", () => {
  beforeEach(async () => {
    installStorageStub();
    chat = await import(`../../extension/lib/chat.js?t=${Math.random()}`);
  });

  it("keys threads by selection so two selections coexist", async () => {
    await chat.saveThread(URL_A, {
      selection: "bonding curve volume",
      messages: [{ role: "user", content: "FIRST THREAD QUESTION" }],
    });
    await chat.saveThread(URL_A, {
      selection: "TVL climbed after points",
      messages: [{ role: "user", content: "SECOND THREAD QUESTION" }],
    });

    const first = await chat.loadThread(URL_A, "bonding curve volume");
    const second = await chat.loadThread(URL_A, "TVL climbed after points");

    assert.ok(first, "first thread must still exist after a second selection");
    assert.equal(first.messages[0].content, "FIRST THREAD QUESTION");
    assert.equal(second.messages[0].content, "SECOND THREAD QUESTION");
  });

  it("upserts the same selection instead of duplicating it", async () => {
    await chat.saveThread(URL_A, { selection: "same", messages: [{ role: "user", content: "a" }] });
    await chat.saveThread(URL_A, {
      selection: "same",
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
    });
    const list = await chat.listThreads(URL_A);
    assert.equal(list.length, 1);
    assert.equal(list[0].messageCount, 2);
  });

  it("lists threads most-recent first with message counts", async () => {
    await chat.saveThread(URL_A, { selection: "older", messages: [{ role: "user", content: "x" }] });
    await chat.saveThread(URL_A, { selection: "newer", messages: [{ role: "user", content: "y" }] });
    const list = await chat.listThreads(URL_A);
    assert.deepEqual(
      list.map((t) => t.selection),
      ["newer", "older"]
    );
    assert.equal(list[0].messageCount, 1);
  });

  it("returns null for a selection that has no thread yet", async () => {
    await chat.saveThread(URL_A, { selection: "known", messages: [] });
    assert.equal(await chat.loadThread(URL_A, "never discussed"), null);
  });

  it("ignores query/hash so the same page reuses its threads", async () => {
    await chat.saveThread(URL_A, { selection: "s", messages: [{ role: "user", content: "q" }] });
    const viaOtherQuery = await chat.loadThread("https://example.com/post/1?utm=different#frag", "s");
    assert.ok(viaOtherQuery);
    assert.equal(viaOtherQuery.messages[0].content, "q");
  });

  it("migrates a legacy single-session record into one thread", async () => {
    const key = chat.sessionKeyForUrl(URL_A);
    await chrome.storage.session.set({
      [key]: {
        messages: [{ role: "user", content: "LEGACY" }],
        selection: "legacy selection",
        lensId: "general",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const migrated = await chat.loadThread(URL_A, "legacy selection");
    assert.ok(migrated, "legacy session must be readable as a thread");
    assert.equal(migrated.messages[0].content, "LEGACY");
  });

  it("caps stored threads so session storage cannot grow without bound", async () => {
    for (let i = 0; i < chat.MAX_THREADS + 4; i++) {
      await chat.saveThread(URL_A, { selection: `sel ${i}`, messages: [{ role: "user", content: `m${i}` }] });
    }
    const list = await chat.listThreads(URL_A);
    assert.equal(list.length, chat.MAX_THREADS);
    assert.equal(list[0].selection, `sel ${chat.MAX_THREADS + 3}`);
  });

  it("clearThread removes only the targeted thread", async () => {
    await chat.saveThread(URL_A, { selection: "keep", messages: [{ role: "user", content: "k" }] });
    await chat.saveThread(URL_A, { selection: "drop", messages: [{ role: "user", content: "d" }] });
    await chat.clearThread(URL_A, "drop");
    assert.ok(await chat.loadThread(URL_A, "keep"));
    assert.equal(await chat.loadThread(URL_A, "drop"), null);
  });
});
