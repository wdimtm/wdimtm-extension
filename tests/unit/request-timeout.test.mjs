import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TIMEOUTS,
  createRequestTimeout,
  describeAbort,
} from "../../core/request-timeout.js";

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("request timeout", () => {
  it("aborts when the server never answers", async () => {
    const t = createRequestTimeout({ firstByteMs: 20, stallMs: 1000 });
    assert.equal(t.signal.aborted, false);
    await sleep(50);
    assert.equal(t.signal.aborted, true);
    assert.equal(t.timedOut, true);
    t.settle();
  });

  it("does not abort a long answer that keeps producing tokens", async () => {
    // A detailed answer can legitimately take a minute. What must not happen is
    // waiting forever on a stream that has gone quiet — so the clock is on the
    // gap between chunks, not on the total.
    const t = createRequestTimeout({ firstByteMs: 1000, stallMs: 40 });
    t.firstByteReceived();
    for (let i = 0; i < 5; i += 1) {
      await sleep(20);
      t.chunkReceived();
    }
    assert.equal(t.signal.aborted, false, "still streaming");
    await sleep(70);
    assert.equal(t.signal.aborted, true, "went quiet");
    assert.equal(t.timedOut, true);
    t.settle();
  });

  it("stops the clock once the request is settled", async () => {
    const t = createRequestTimeout({ firstByteMs: 20, stallMs: 20 });
    t.settle();
    await sleep(50);
    assert.equal(t.signal.aborted, false);
  });

  it("separates a user cancel from a timeout", () => {
    const t = createRequestTimeout({ firstByteMs: 1000, stallMs: 1000 });
    t.cancel();
    assert.equal(t.signal.aborted, true);
    assert.equal(t.canceled, true);
    assert.equal(t.timedOut, false);
    // The two must not read the same to the user: one is their own doing.
    assert.match(describeAbort(t).message, /cancel/i);
    assert.doesNotMatch(describeAbort(t).message, /timed out/i);
  });

  it("follows an external abort signal", () => {
    const outer = new AbortController();
    const t = createRequestTimeout({ externalSignal: outer.signal });
    outer.abort();
    assert.equal(t.signal.aborted, true);
    assert.equal(t.canceled, true);
  });

  it("is already aborted when the external signal fired first", () => {
    const outer = new AbortController();
    outer.abort();
    const t = createRequestTimeout({ externalSignal: outer.signal });
    assert.equal(t.signal.aborted, true);
    assert.equal(t.canceled, true);
  });

  it("ships defaults that leave room for a slow model", () => {
    assert.ok(TIMEOUTS.firstByteMs >= 15000);
    assert.ok(TIMEOUTS.stallMs >= 20000);
  });
});
