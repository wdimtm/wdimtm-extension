/**
 * Distillation driver (Issue #49).
 *
 * The import page owns the job; this module is the loop it runs. Both the
 * transport (`send`) and the clock (`sleep`) are injected, so the retry,
 * backoff, cancel and resume behaviour is testable without a browser or a real
 * wait — which matters, because this is the part most likely to be subtly wrong
 * and least likely to be exercised by hand.
 */

import { classifyRuntimeError } from "../runtime-errors.js";

/**
 * Retrying an auth or routing problem just burns time: the answer will not
 * change until the user edits their settings. Everything else is transient.
 */
const FATAL_CODES = new Set(["unauthorized", "forbidden", "missing_key", "not_found"]);

export const BACKOFF = {
  firstMs: 1000,
  maxMs: 30000,
};

/**
 * Turn a thrown runtime error into the shape the loop reasons about.
 *
 * @param {unknown} err
 * @returns {{ ok: false, error: string, code: string, fatal: boolean, retryable: boolean }}
 */
export function classifyImportFailure(err) {
  const { code, message } = classifyRuntimeError(err, "byok");
  const fatal = FATAL_CODES.has(code);
  return { ok: false, error: message, code, fatal, retryable: !fatal };
}

/**
 * @typedef {Object} DistillProgress
 * @property {number} completed  Batches finished, including ones resumed past.
 * @property {number} total
 * @property {number} failed
 * @property {number} candidates
 * @property {boolean} backingOff
 *
 * @typedef {Object} DistillOutcome
 * @property {import('../memory-sources/types.js').MemoryCandidate[]} candidates
 * @property {number} completed
 * @property {number} failed
 * @property {boolean} cancelled
 * @property {string} error  Set when a fatal failure stopped the run.
 */

/**
 * @param {{
 *   batches: import('./distill.js').DistillBatch[],
 *   startIndex?: number,
 *   send: (batch: import('./distill.js').DistillBatch) => Promise<any>,
 *   onProgress?: (progress: DistillProgress) => void,
 *   onCandidates?: (candidates: import('../memory-sources/types.js').MemoryCandidate[], completed: number) => void | Promise<void>,
 *   sleep?: (ms: number) => Promise<void>,
 *   shouldStop?: () => boolean,
 *   concurrency?: number,
 *   maxAttempts?: number,
 * }} opts
 * @returns {Promise<DistillOutcome>}
 */
export async function runDistillation(opts) {
  const {
    batches,
    startIndex = 0,
    send,
    onProgress = () => {},
    onCandidates,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    shouldStop = () => false,
    concurrency = 3,
    maxAttempts = 3,
  } = opts;

  /** @type {import('../memory-sources/types.js').MemoryCandidate[]} */
  const candidates = [];
  let next = startIndex;
  let completed = startIndex;
  let failed = 0;
  let backoffMs = 0;
  let cancelled = false;
  let fatalError = "";

  const emit = () =>
    onProgress({
      completed,
      total: batches.length,
      failed,
      candidates: candidates.length,
      backingOff: backoffMs > 0,
    });

  const finish = async (batchCandidates) => {
    if (batchCandidates?.length) candidates.push(...batchCandidates);
    completed += 1;
    // Success is the signal that the endpoint recovered; decay rather than
    // clear, so one lucky response does not undo a genuine rate limit.
    backoffMs = Math.floor(backoffMs / 2);
    emit();
    if (onCandidates) await onCandidates(candidates, completed);
  };

  async function worker() {
    while (true) {
      if (cancelled || fatalError) return;
      if (shouldStop()) {
        cancelled = true;
        return;
      }

      const index = next;
      next += 1;
      if (index >= batches.length) return;

      let attempt = 0;
      while (true) {
        if (backoffMs > 0) await sleep(backoffMs);
        if (shouldStop()) {
          cancelled = true;
          return;
        }

        let result;
        try {
          result = await send(batches[index]);
        } catch (err) {
          result = classifyImportFailure(err);
        }

        if (result?.ok) {
          await finish(result.candidates);
          break;
        }

        if (result?.fatal) {
          fatalError = result.error || "Import stopped.";
          return;
        }

        attempt += 1;
        if (attempt >= maxAttempts) {
          // Give up on this batch alone. One unreadable or repeatedly failing
          // batch must not cost the user everything already paid for.
          failed += 1;
          completed += 1;
          emit();
          break;
        }

        backoffMs = backoffMs ? Math.min(backoffMs * 2, BACKOFF.maxMs) : BACKOFF.firstMs;
        emit();
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  return { candidates, completed, failed, cancelled, error: fatalError };
}
