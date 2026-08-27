/**
 * Request deadlines for every network path (Issue #18).
 *
 * A total wall-clock timeout is the wrong tool here: a detailed answer can
 * legitimately stream for a minute, and cutting it off would be a bug, not a
 * safeguard. What must never happen is waiting forever on a connection that has
 * gone quiet. So there are two clocks:
 *
 *   firstByteMs — the server has not responded at all
 *   stallMs     — the stream stopped producing chunks
 *
 * A user cancel is deliberately distinguishable from a timeout: one of them is
 * the user's own doing and must not be reported as a failure.
 */

export const TIMEOUTS = {
  /** No response headers yet. */
  firstByteMs: 20000,
  /** Response started but no further chunk arrived. */
  stallMs: 30000,
};

/**
 * @param {{
 *   firstByteMs?: number,
 *   stallMs?: number,
 *   externalSignal?: AbortSignal,
 * }} [opts]
 */
export function createRequestTimeout(opts = {}) {
  const firstByteMs = opts.firstByteMs ?? TIMEOUTS.firstByteMs;
  const stallMs = opts.stallMs ?? TIMEOUTS.stallMs;
  const controller = new AbortController();

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let settled = false;

  const handle = {
    signal: controller.signal,
    timedOut: false,
    canceled: false,

    /** Headers arrived; switch to the stall clock. */
    firstByteReceived() {
      arm(stallMs);
    },

    /** A chunk arrived; the stream is alive, restart the stall clock. */
    chunkReceived() {
      arm(stallMs);
    },

    /** The request finished (or failed) — stop watching. */
    settle() {
      settled = true;
      clearTimeout(timer);
    },

    /** The user asked to stop. Not a failure. */
    cancel() {
      if (settled || controller.signal.aborted) return;
      handle.canceled = true;
      clearTimeout(timer);
      controller.abort();
    },
  };

  /** @param {number} ms */
  function arm(ms) {
    if (settled || controller.signal.aborted) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (settled || controller.signal.aborted) return;
      handle.timedOut = true;
      controller.abort();
    }, ms);
  }

  if (opts.externalSignal) {
    if (opts.externalSignal.aborted) {
      handle.canceled = true;
      controller.abort();
    } else {
      opts.externalSignal.addEventListener("abort", () => handle.cancel(), { once: true });
    }
  }

  arm(firstByteMs);
  return handle;
}

/**
 * Turn an aborted request into an error the classifier can read. Callers do
 * this rather than letting a bare `AbortError` escape, because "AbortError"
 * tells a user nothing about which of the two things happened.
 *
 * @param {{ timedOut: boolean, canceled: boolean }} handle
 */
export function describeAbort(handle) {
  if (handle.canceled) return new Error("Request canceled.");
  if (handle.timedOut) {
    return new Error("Request timed out — the model did not respond in time.");
  }
  return new Error("Request aborted.");
}

/**
 * Wrap a fetch so an abort surfaces as the right error instead of `AbortError`.
 * @param {() => Promise<Response>} run
 * @param {ReturnType<typeof createRequestTimeout>} handle
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(run, handle) {
  try {
    const res = await run();
    handle.firstByteReceived();
    return res;
  } catch (err) {
    if (handle.signal.aborted) throw describeAbort(handle);
    throw err;
  }
}
