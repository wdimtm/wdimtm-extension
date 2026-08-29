/**
 * The worker half of the chunk / done / error port protocol.
 *
 * Explain and chat each had their own copy of it in the service worker. The
 * shape was identical — validate, stream chunks, backfill when the runtime did
 * not stream, send done, classify on throw — and only the request and the
 * error strings genuinely differed, so those are what a caller supplies.
 */

/** Safe port write — content may disconnect while the worker is still streaming. */
export function safePortPost(port, message) {
  try {
    port.postMessage(message);
  } catch {
    /* disconnected port — ignore */
  }
}

/**
 * @param {chrome.runtime.Port | any} port
 * @param {{
 *   validate?: () => string | null | undefined,
 *   run: (opts: { onChunk: (text: string) => void }) => Promise<any>,
 *   textOf?: (response: any) => string,
 *   onError?: (err: unknown) => void | Promise<void>,
 * }} handlers
 */
export async function servePortStream(port, handlers) {
  const invalid = handlers.validate?.();
  if (invalid) {
    safePortPost(port, { type: "error", error: invalid });
    return;
  }

  let streamed = "";
  try {
    const response = await handlers.run({
      onChunk: (text) => {
        streamed += text;
        safePortPost(port, { type: "chunk", text });
      },
    });

    // If the runtime did not stream, push the full text once so the client
    // renders the same way either way.
    if (!streamed) {
      const text = handlers.textOf?.(response) || "";
      if (text) safePortPost(port, { type: "chunk", text });
    }

    safePortPost(port, { type: "done", data: response });
  } catch (err) {
    await handlers.onError?.(err);
  }
}
