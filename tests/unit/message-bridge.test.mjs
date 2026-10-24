/**
 * The page ↔ service worker bridge (#165), tested through the worker's real
 * onMessage listener with a fake `chrome` rather than by reading its source.
 * Regression cover for #163 (research sent `undefined`) and #164 (one-shot
 * chat ran without runtime deps).
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { MSG, createMessageRouter, createSender } from "../../core/messages.js";

function storageArea() {
  /** @type {Record<string, unknown>} */
  let data = {};
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === "string") return keys in data ? { [keys]: data[keys] } : {};
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
      }
      const out = { ...keys };
      for (const k of Object.keys(keys)) if (k in data) out[k] = data[k];
      return out;
    },
    async set(patch) {
      data = { ...data, ...patch };
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k];
    },
    async clear() {
      data = {};
    },
  };
}

/** @type {(msg: unknown) => Promise<any>} */
let sendToWorker;

before(async () => {
  /** @type {Function | null} */
  let onMessage = null;
  const sync = storageArea();
  // Offline and deterministic: the mock runtime, kept by a dev build.
  await sync.set({ runtime: "mock", devMockRuntime: true });
  const noop = { addListener() {} };
  globalThis.chrome = {
    storage: { sync, local: storageArea(), session: storageArea() },
    runtime: {
      onMessage: { addListener: (fn) => (onMessage = fn) },
      onConnect: noop,
      onInstalled: noop,
      getURL: (p) => `chrome-extension://test/${p}`,
      openOptionsPage: async () => {},
    },
    tabs: { create: async () => ({}) },
  };
  // Nothing in these tests may reach the network.
  globalThis.fetch = async () => {
    throw new Error("network disabled in tests");
  };

  await import("../../extension/background/service-worker.js");
  assert.ok(onMessage, "service worker registers an onMessage listener");
  const listener = onMessage;
  sendToWorker = (msg) =>
    new Promise((resolve) => {
      const keepOpen = listener(msg, {}, resolve);
      assert.equal(keepOpen, true, "listener answers asynchronously");
    });
});

describe("message bridge — page side", () => {
  it("refuses a type that is not in MSG before sending", async () => {
    let sent = 0;
    const send = createSender(async () => {
      sent += 1;
      return { ok: true };
    });
    // The #163 shape: a constant missing from a page's own MSG copy.
    await assert.rejects(send({ type: undefined }), /Unknown message type: undefined/);
    await assert.rejects(send({ type: "wdimtm:nope" }), /Unknown message type/);
    assert.equal(sent, 0);
    assert.deepEqual(await send({ type: MSG.RESEARCH_START }), { ok: true });
  });
});

describe("message bridge — worker side", () => {
  it("rejects a handler table entry for an unknown type when built", () => {
    assert.throws(
      () => createMessageRouter({ "wdimtm:nope": async () => ({ ok: true }) }),
      /unknown message type: wdimtm:nope/
    );
  });

  it("answers an unknown type without throwing", async () => {
    const res = await sendToWorker({ type: "wdimtm:nope" });
    assert.equal(res.ok, false);
    assert.match(res.error, /Unknown message type/);
  });

  it("runs a one-shot chat with the runtime deps (#164)", async () => {
    const res = await sendToWorker({
      type: MSG.CHAT,
      payload: {
        selection: "bonding curve",
        page: { url: "https://example.com/a", title: "A" },
        messages: [{ role: "user", content: "what does it mean for me?" }],
      },
    });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.runtime, "mock");
    assert.ok(res.data.reply.length > 0);
  });

  it("validates a one-shot chat the same way as the streaming port", async () => {
    const res = await sendToWorker({ type: MSG.CHAT, payload: { messages: [] } });
    assert.deepEqual(res, { ok: false, error: "Chat requires page.url." });
  });

  it("routes research messages to their handlers (#163)", async () => {
    assert.deepEqual(await sendToWorker({ type: MSG.RESEARCH_GET, payload: {} }), {
      ok: false,
      error: "Missing job id.",
    });
    assert.deepEqual(await sendToWorker({ type: MSG.RESEARCH_CANCEL, payload: {} }), {
      ok: false,
      error: "Missing job id.",
    });
    assert.deepEqual(await sendToWorker({ type: MSG.RESEARCH_START, payload: {} }), {
      ok: false,
      error: "Missing selection.",
    });
  });

  it("has a handler for every MSG type", async () => {
    for (const type of Object.values(MSG)) {
      const res = await sendToWorker({ type, payload: {} });
      assert.doesNotMatch(String(res?.error || ""), /Unknown message type/, type);
    }
  });
});
