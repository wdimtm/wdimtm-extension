/**
 * First-run funnel (#40): free success first, then an optional top-up.
 *
 * WDIMTM Cloud starts every account on free monthly credits, so the first
 * Explain never asks for money. What this module decides is the one quiet
 * line under an answer that says where more credits come from: once after the
 * first hosted answer, and again when the credits are nearly gone. It never
 * blocks an answer and never shows for a user on their own API key.
 */

/** At or below this many credits left, the popover offers a top-up. */
export const LOW_CREDITS = 5;

/**
 * @typedef {{
 *   kind: 'first' | 'low' | 'empty',
 *   remaining: number,
 * }} CreditNudge
 */

/**
 * @param {{
 *   runtime?: string,
 *   entitlement?: { quotaRemaining?: number } | null,
 *   firstHostedAnswer?: boolean,
 * }} input
 * @returns {CreditNudge | null}
 */
export function creditNudge({ runtime, entitlement, firstHostedAnswer = false }) {
  if (runtime !== "wdimtm-cloud") return null;
  const remaining = Number(entitlement?.quotaRemaining);
  if (!Number.isFinite(remaining)) return null;
  const left = Math.max(0, Math.floor(remaining));
  if (left === 0) return { kind: "empty", remaining: 0 };
  if (left <= LOW_CREDITS) return { kind: "low", remaining: left };
  if (firstHostedAnswer) return { kind: "first", remaining: left };
  return null;
}
