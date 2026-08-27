import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyImportFailure, runDistillation } from "../../core/memory-import/runner.js";

/** @param {number} n */
function batches(n) {
  return Array.from({ length: n }, (_, i) => ({ index: i, conversations: [], text: `batch ${i}` }));
}

/** Never actually waits — backoff is asserted by what gets recorded, not by elapsed time. */
function fakeClock() {
  /** @type {number[]} */
  const waits = [];
  return { waits, sleep: async (ms) => void waits.push(ms) };
}

/** @param {{ type: string }} [patch] */
function candidate(patch = {}) {
  return { type: "interest", text: "I like X", evidenceTitles: [], confidence: 0.8, ...patch };
}

describe("classifyImportFailure", () => {
  it("marks auth and routing problems fatal", () => {
    for (const message of ["401 unauthorized", "403 forbidden", "404 not found"]) {
      assert.equal(classifyImportFailure(new Error(message)).fatal, true, message);
    }
  });

  it("marks rate limits and network trouble retryable", () => {
    for (const message of ["429 rate limit", "failed to fetch", "request timed out"]) {
      const result = classifyImportFailure(new Error(message));
      assert.equal(result.fatal, false, message);
      assert.equal(result.retryable, true, message);
    }
  });
});

describe("runDistillation", () => {
  it("collects candidates from every batch", async () => {
    const clock = fakeClock();
    const out = await runDistillation({
      batches: batches(6),
      concurrency: 3,
      sleep: clock.sleep,
      send: async () => ({ ok: true, candidates: [candidate()] }),
    });

    assert.equal(out.candidates.length, 6);
    assert.equal(out.completed, 6);
    assert.equal(out.failed, 0);
    assert.equal(out.cancelled, false);
    assert.equal(out.error, "");
  });

  it("sends each batch exactly once across concurrent workers", async () => {
    const seen = [];
    await runDistillation({
      batches: batches(10),
      concurrency: 4,
      sleep: fakeClock().sleep,
      send: async (batch) => {
        seen.push(batch.index);
        return { ok: true, candidates: [] };
      },
    });

    assert.equal(seen.length, 10);
    assert.equal(new Set(seen).size, 10, "no batch is sent twice");
  });

  it("resumes from a cursor without redoing earlier batches", async () => {
    const seen = [];
    const out = await runDistillation({
      batches: batches(5),
      startIndex: 3,
      concurrency: 1,
      sleep: fakeClock().sleep,
      send: async (batch) => {
        seen.push(batch.index);
        return { ok: true, candidates: [candidate()] };
      },
    });

    assert.deepEqual(seen, [3, 4]);
    assert.equal(out.completed, 5, "completed counts the batches already paid for");
    assert.equal(out.candidates.length, 2);
  });

  it("backs off with growing delays before retrying", async () => {
    const clock = fakeClock();
    let calls = 0;
    await runDistillation({
      batches: batches(1),
      concurrency: 1,
      sleep: clock.sleep,
      send: async () => {
        calls += 1;
        if (calls < 3) return { ok: false, retryable: true, error: "429" };
        return { ok: true, candidates: [candidate()] };
      },
    });

    assert.equal(calls, 3);
    assert.deepEqual(clock.waits, [1000, 2000], "delay doubles between attempts");
  });

  it("gives up on a hopeless batch without losing the others", async () => {
    const out = await runDistillation({
      batches: batches(4),
      concurrency: 1,
      sleep: fakeClock().sleep,
      send: async (batch) =>
        batch.index === 1
          ? { ok: false, retryable: true, error: "unreadable" }
          : { ok: true, candidates: [candidate()] },
    });

    assert.equal(out.failed, 1);
    assert.equal(out.completed, 4);
    assert.equal(out.candidates.length, 3, "the other three batches survive");
    assert.equal(out.error, "");
  });

  it("stops the whole run on a fatal failure and keeps what it earned", async () => {
    const out = await runDistillation({
      batches: batches(20),
      concurrency: 1,
      sleep: fakeClock().sleep,
      send: async (batch) => {
        if (batch.index < 2) return { ok: true, candidates: [candidate()] };
        return classifyImportFailure(new Error("401 unauthorized"));
      },
    });

    assert.equal(out.candidates.length, 2, "already-distilled candidates are kept");
    assert.match(out.error, /401/);
    assert.ok(out.completed < 20);
  });

  it("cancels promptly when asked to stop", async () => {
    let sent = 0;
    const out = await runDistillation({
      batches: batches(50),
      concurrency: 1,
      sleep: fakeClock().sleep,
      shouldStop: () => sent >= 3,
      send: async () => {
        sent += 1;
        return { ok: true, candidates: [candidate()] };
      },
    });

    assert.equal(out.cancelled, true);
    assert.equal(sent, 3);
    assert.equal(out.candidates.length, 3, "cancelling keeps completed work");
  });

  it("reports progress as batches land", async () => {
    /** @type {number[]} */
    const seen = [];
    await runDistillation({
      batches: batches(3),
      concurrency: 1,
      sleep: fakeClock().sleep,
      onProgress: (p) => seen.push(p.completed),
      send: async () => ({ ok: true, candidates: [] }),
    });

    assert.deepEqual(seen, [1, 2, 3]);
  });

  it("hands candidates to the persistence hook after each batch", async () => {
    /** @type {number[]} */
    const checkpoints = [];
    await runDistillation({
      batches: batches(3),
      concurrency: 1,
      sleep: fakeClock().sleep,
      onCandidates: async (candidates, completed) => {
        checkpoints.push(completed);
        assert.equal(candidates.length, completed);
      },
      send: async () => ({ ok: true, candidates: [candidate()] }),
    });

    assert.deepEqual(checkpoints, [1, 2, 3]);
  });

  it("does nothing when there are no batches", async () => {
    const out = await runDistillation({ batches: [], send: async () => ({ ok: true }) });
    assert.deepEqual(out.candidates, []);
    assert.equal(out.completed, 0);
  });
});
