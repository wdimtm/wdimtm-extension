/**
 * The client half of the chunk / done / error port protocol.
 *
 * Explain and chat used to hand-roll this separately, and the two disagreed on
 * failure: chat kept a half-streamed reply when the port dropped, explain threw
 * one away. This module is the single answer, and it takes the stronger
 * behaviour in every disagreement:
 *
 *   - a `finished` guard, so exactly one terminal callback ever runs
 *   - a partial answer survives a disconnect instead of being discarded
 *   - `chrome.runtime.lastError` is read, because that is where "the extension
 *     was reloaded mid-request" is reported
 *
 * It takes a port rather than opening one: connecting fails differently for the
 * two callers (chat can fall back to a one-shot message, explain cannot), and
 * that decision belongs to them.
 */

/**
 * Chrome reports a mid-request extension reload here, and only while the
 * disconnect handler is on the stack.
 * @returns {string}
 */
function portLastError() {
  try {
    return chrome.runtime.lastError?.message || "";
  } catch {
    // No extension host (unit tests against a fake port) — nothing to report.
    return "";
  }
}

/**
 * @typedef {Object} PortStreamHandlers
 * @property {unknown} [request] posted once the listeners are attached
 * @property {(accumulated: string, delta: string) => void} [onChunk]
 * @property {(data: any, accumulated: string) => void} [onDone]
 * @property {(accumulated: string) => void} [onPartial] the port dropped, but
 *   text had already streamed — keep it rather than replacing it with an error
 * @property {(err: Error) => void} [onError]
 * @property {() => void} [onClosed] the port dropped, whatever the outcome
 * @property {() => boolean} [isActive] false when the caller has moved on and
 *   wants no terminal callback at all
 * @property {string} [failureMessage] used when a disconnect carries no
 *   lastError and nothing had streamed
 */

/**
 * @param {chrome.runtime.Port | any} port
 * @param {PortStreamHandlers} [handlers]
 * @returns {{ disconnect: () => void, isFinished: () => boolean }}
 */
export function consumePortStream(port, handlers = {}) {
  const {
    request,
    onChunk,
    onDone,
    onPartial,
    onError,
    onClosed,
    isActive,
    failureMessage = "Extension context invalidated.",
  } = handlers;

  let accumulated = "";
  let finished = false;

  /** @param {() => void} run */
  const finish = (run) => {
    if (finished) return;
    finished = true;
    run();
  };

  /** @param {unknown} err */
  const fail = (err) =>
    finish(() => onError?.(err instanceof Error ? err : new Error(String(err))));

  port.onMessage.addListener((msg) => {
    if (!msg || finished) return;
    if (msg.type === "chunk") {
      accumulated += msg.text || "";
      onChunk?.(accumulated, msg.text || "");
    } else if (msg.type === "done") {
      finish(() => onDone?.(msg.data, accumulated));
    } else if (msg.type === "error") {
      const err = new Error(msg.error || "Request failed.");
      // The worker already classified this; the code is what lets the UI offer
      // the right way out instead of a generic Retry.
      if (msg.code) /** @type {any} */ (err).code = msg.code;
      fail(err);
    }
  });

  port.onDisconnect.addListener(() => {
    const lastError = portLastError();
    onClosed?.();
    if (finished) return;
    if (isActive && !isActive()) {
      finished = true;
      return;
    }
    if (accumulated) finish(() => onPartial?.(accumulated));
    else fail(new Error(lastError || failureMessage));
  });

  if (request !== undefined) {
    try {
      port.postMessage(request);
    } catch (err) {
      fail(err);
    }
  }

  return {
    /** Abandon the stream: no further callback runs, whatever arrives. */
    disconnect() {
      finished = true;
      try {
        port.disconnect();
      } catch {
        /* already gone */
      }
    },
    isFinished: () => finished,
  };
}
