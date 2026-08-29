import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consumePortStream } from "../../extension/lib/port-client.js";
import { safePortPost, servePortStream } from "../../extension/lib/port-server.js";
import { hideStreamingTrailers } from "../../core/followups.js";

/**
 * The point of extracting the protocol is that it can be exercised without a
 * browser: a port is two listener lists and a postMessage.
 */
function fakePort() {
  /** @type {Array<(msg: any) => void>} */
  const messageListeners = [];
  /** @type {Array<() => void>} */
  const disconnectListeners = [];
  const port = {
    posted: /** @type {any[]} */ ([]),
    disconnected: false,
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn) => disconnectListeners.push(fn) },
    postMessage(msg) {
      if (port.disconnected) throw new Error("Attempting to use a disconnected port object");
      port.posted.push(msg);
    },
    disconnect() {
      port.disconnected = true;
    },
    /** Worker → client. */
    emit(msg) {
      for (const fn of [...messageListeners]) fn(msg);
    },
    /** The channel dropped (extension reload, worker teardown). */
    drop() {
      for (const fn of [...disconnectListeners]) fn();
    },
  };
  return port;
}

/** Collect every callback the client half can make. */
function recorder() {
  const seen = { chunks: [], done: null, partial: null, error: null, closed: 0 };
  return {
    seen,
    handlers: {
      onChunk: (acc, delta) => seen.chunks.push([acc, delta]),
      onDone: (data, acc) => (seen.done = { data, acc }),
      onPartial: (acc) => (seen.partial = acc),
      onError: (err) => (seen.error = err),
      onClosed: () => (seen.closed += 1),
    },
  };
}

describe("port stream client", () => {
  it("posts the request once listeners are attached, then accumulates chunks", () => {
    const port = fakePort();
    const { seen, handlers } = recorder();
    consumePortStream(port, { ...handlers, request: { type: "explain" } });

    assert.deepEqual(port.posted, [{ type: "explain" }]);
    port.emit({ type: "chunk", text: "Half " });
    port.emit({ type: "chunk", text: "an answer." });
    assert.deepEqual(seen.chunks, [
      ["Half ", "Half "],
      ["Half an answer.", "an answer."],
    ]);

    port.emit({ type: "done", data: { explanation: "Half an answer." } });
    assert.deepEqual(seen.done, {
      data: { explanation: "Half an answer." },
      acc: "Half an answer.",
    });
  });

  it("keeps a partial answer when the port drops mid-stream", () => {
    const port = fakePort();
    const { seen, handlers } = recorder();
    consumePortStream(port, handlers);

    port.emit({ type: "chunk", text: "Streamed so far" });
    port.drop();

    assert.equal(seen.partial, "Streamed so far");
    assert.equal(seen.error, null);
    assert.equal(seen.closed, 1);
  });

  it("reports an error when the port drops before anything streamed", () => {
    const port = fakePort();
    const { seen, handlers } = recorder();
    consumePortStream(port, { ...handlers, failureMessage: "Extension was reloaded." });

    port.drop();

    assert.equal(seen.partial, null);
    assert.equal(seen.error.message, "Extension was reloaded.");
  });

  it("runs exactly one terminal callback", () => {
    const port = fakePort();
    const { seen, handlers } = recorder();
    consumePortStream(port, handlers);

    port.emit({ type: "chunk", text: "answer" });
    port.emit({ type: "done", data: { explanation: "answer" } });
    // Everything after the first terminal message is noise.
    port.emit({ type: "error", error: "too late" });
    port.emit({ type: "chunk", text: " more" });
    port.drop();

    assert.equal(seen.error, null);
    assert.equal(seen.partial, null);
    assert.equal(seen.chunks.length, 1);
    assert.equal(seen.done.acc, "answer");
  });

  it("carries the worker's error code through so the UI can act on it", () => {
    const port = fakePort();
    const { seen, handlers } = recorder();
    consumePortStream(port, handlers);

    port.emit({ type: "error", error: "API key rejected (401)", code: "auth" });

    assert.equal(seen.error.message, "API key rejected (401)");
    assert.equal(seen.error.code, "auth");
  });

  it("reports a failed post rather than waiting forever", () => {
    const port = fakePort();
    port.disconnect();
    const { seen, handlers } = recorder();
    consumePortStream(port, { ...handlers, request: { type: "chat" } });

    assert.match(seen.error.message, /disconnected port/);
  });

  it("stays quiet when the caller has moved on", () => {
    const port = fakePort();
    const { seen, handlers } = recorder();
    let busy = true;
    consumePortStream(port, { ...handlers, isActive: () => busy });

    port.emit({ type: "chunk", text: "partial" });
    busy = false;
    port.drop();

    assert.equal(seen.partial, null);
    assert.equal(seen.error, null);
    assert.equal(seen.closed, 1);
  });

  it("abandoning the stream silences it", () => {
    const port = fakePort();
    const { seen, handlers } = recorder();
    const stream = consumePortStream(port, handlers);

    stream.disconnect();
    assert.equal(port.disconnected, true);
    assert.equal(stream.isFinished(), true);
    port.emit({ type: "done", data: { explanation: "late" } });
    assert.equal(seen.done, null);
  });
});

describe("port stream worker", () => {
  it("streams chunks and closes with done", async () => {
    const port = fakePort();
    await servePortStream(port, {
      run: async ({ onChunk }) => {
        onChunk("one ");
        onChunk("two");
        return { explanation: "one two" };
      },
      textOf: (r) => r.explanation,
    });

    assert.deepEqual(port.posted, [
      { type: "chunk", text: "one " },
      { type: "chunk", text: "two" },
      { type: "done", data: { explanation: "one two" } },
    ]);
  });

  it("backfills one chunk when the runtime did not stream", async () => {
    const port = fakePort();
    await servePortStream(port, {
      run: async () => ({ reply: "all at once" }),
      textOf: (r) => r.reply,
    });

    assert.deepEqual(port.posted[0], { type: "chunk", text: "all at once" });
    assert.equal(port.posted.length, 2);
  });

  it("refuses an invalid request without calling the runtime", async () => {
    const port = fakePort();
    let ran = false;
    await servePortStream(port, {
      validate: () => "Missing selection.",
      run: async () => {
        ran = true;
        return {};
      },
    });

    assert.equal(ran, false);
    assert.deepEqual(port.posted, [{ type: "error", error: "Missing selection." }]);
  });

  it("hands a thrown failure to the caller's classifier", async () => {
    const port = fakePort();
    /** @type {unknown} */
    let caught;
    await servePortStream(port, {
      run: async () => {
        throw new Error("upstream exploded");
      },
      onError: (err) => {
        caught = err;
        safePortPost(port, { type: "error", error: "Something went wrong.", code: "unknown" });
      },
    });

    assert.match(String(caught), /upstream exploded/);
    assert.deepEqual(port.posted, [
      { type: "error", error: "Something went wrong.", code: "unknown" },
    ]);
  });

  it("survives a client that vanished mid-stream", async () => {
    const port = fakePort();
    await servePortStream(port, {
      run: async ({ onChunk }) => {
        port.disconnect();
        onChunk("into the void");
        return { explanation: "into the void" };
      },
      textOf: (r) => r.explanation,
    });
    assert.deepEqual(port.posted, []);
  });
});

describe("streaming trailer hiding", () => {
  it("hides a trailer the moment its marker appears", () => {
    assert.equal(hideStreamingTrailers("Answer.\n<<<WDIMTM_FOLLOWUPS>>>\nWho pays"), "Answer.");
    assert.equal(hideStreamingTrailers("Answer.\n<<< WDIMTM_MEMORY >>>"), "Answer.");
    assert.equal(hideStreamingTrailers("Answer.\n<!-- wdimtm-why -->half"), "Answer.");
    // A partially streamed marker is still a marker.
    assert.equal(hideStreamingTrailers("Answer.\n<<<WDIMTM_WHY"), "Answer.\n<<<WDIMTM_WHY");
  });

  it("leaves an ordinary answer alone", () => {
    const text = "Line one.\n\nLine two with <angle> brackets.";
    assert.equal(hideStreamingTrailers(text), text);
    assert.equal(hideStreamingTrailers(undefined), "");
  });
});
