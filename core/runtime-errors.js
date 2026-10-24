/**
 * Classify provider errors for user-facing copy (#17 / #18).
 */

/**
 * Why a hosted request was refused for payment (#75). The popover words each
 * one differently, and only the first two are fixed by buying credits.
 *
 * - `allowance_exhausted`: the free monthly credits are gone, nothing bought.
 * - `insufficient_credits`: some credits are left, not enough for this request.
 * - `budget_exhausted`: the operator's own budget stopped the service. Paying
 *   would not help, so no buy button is offered.
 *
 * @typedef {'allowance_exhausted' | 'insufficient_credits' | 'budget_exhausted'} PaymentReason
 */

/**
 * @typedef {{
 *   code: string,
 *   message: string,
 *   reason?: PaymentReason,
 *   checkoutUrl?: string,
 * }} ClassifiedRuntimeError
 */

/**
 * The JSON body of a failed hosted request. cloudFetch attaches it as
 * `err.body`; a bare message such as `… failed (402): {…}` is parsed as a
 * fallback. Anything that is not an object reads as no body.
 * @param {unknown} err
 * @param {string} raw
 * @returns {Record<string, any> | null}
 */
function errorBody(err, raw) {
  const attached = err && typeof err === "object" ? /** @type {any} */ (err).body : undefined;
  if (attached && typeof attached === "object" && !Array.isArray(attached)) return attached;
  const start = raw.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function httpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/**
 * Read a 402 (#75). WDIMTM Cloud answers `{ code: "insufficient_credits",
 * quota }`; a runtime in front of Agentaab answers `{ reason, runtime_access }`.
 * Every field is optional: a 402 with no body is still a payment problem.
 * @param {Record<string, any> | null} body
 * @param {string} lower the error message, lowercased
 * @returns {ClassifiedRuntimeError}
 */
function classifyPaymentRequired(body, lower) {
  const access = body?.runtime_access && typeof body.runtime_access === "object" ? body.runtime_access : {};
  const reasonText = String(body?.reason || access.reason || body?.code || "").toLowerCase();
  const checkoutUrl = httpsUrl(access.checkout_url || body?.checkout_url);

  if (reasonText.includes("budget") || (!reasonText && lower.includes("budget"))) {
    return {
      code: "payment_required",
      reason: "budget_exhausted",
      message:
        "WDIMTM Cloud is paused for now: the service budget is used up. Try again later, or use your own API key.",
    };
  }

  const quota = body?.quota && typeof body.quota === "object" ? body.quota : {};
  const purchased = Number(quota.purchasedRemaining ?? access.paid_credits);
  const remaining = Number(quota.remaining ?? access.free_quota_remaining);
  const someLeft =
    (Number.isFinite(purchased) && purchased > 0) || (Number.isFinite(remaining) && remaining > 0);
  const extra = checkoutUrl ? { checkoutUrl } : {};

  if (someLeft) {
    return {
      code: "payment_required",
      reason: "insufficient_credits",
      message:
        "You don't have enough WDIMTM credits for this. Buy a credit pack, or use your own API key.",
      ...extra,
    };
  }
  return {
    code: "payment_required",
    reason: "allowance_exhausted",
    message:
      "You've used this month's free WDIMTM credits. Buy a credit pack to keep going, or use your own API key.",
    ...extra,
  };
}

/**
 * @param {unknown} err
 * @param {'byok' | 'cloud' | 'mock' | string} [mode]
 * @returns {ClassifiedRuntimeError}
 */
export function classifyRuntimeError(err, mode = "byok") {
  const raw = err instanceof Error ? err.message : String(err || "");
  const lower = raw.toLowerCase();
  const status = err && typeof err === "object" ? Number(/** @type {any} */ (err).status) : NaN;

  if (!raw || lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return {
      code: "offline",
      message:
        mode === "cloud"
          ? "Cannot reach WDIMTM Cloud. Check the cloud base URL and your network."
          : "Cannot reach the API. Check the base URL, network, and host permissions.",
    };
  }
  // Cloud without a session (#40): a new install that has not signed in yet.
  // Nothing expired, so "sign in again" would be the wrong thing to say.
  if (mode === "cloud" && lower.includes("sign in to wdimtm cloud first")) {
    return {
      code: "sign_in_required",
      message:
        "Sign in to WDIMTM Cloud in Settings to start with free monthly credits, or use your own API key.",
    };
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    return {
      code: "unauthorized",
      message:
        mode === "cloud"
          ? "Your WDIMTM Cloud session has expired (401). Sign in again in Settings."
          : "API key rejected (401). Check the key and that it matches the base URL.",
    };
  }
  if (mode === "cloud" && errorBody(err, raw)?.code === "plan_required") {
    return {
      code: "plan_required",
      message: "Deep research requires WDIMTM Cloud access. Open Settings to upgrade or redeem an access code.",
    };
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return {
      code: "forbidden",
      message:
        mode === "cloud"
          ? "Your WDIMTM Cloud plan does not include this capability (403)."
          : "Access forbidden (403). The key may lack permission for this model.",
    };
  }
  // 503 from Cloud when Agentaab could not confirm Cloud access (#135). The
  // body carries the quota, so this has to come before the quota branches:
  // the credits are not used up, the check is just unavailable.
  if (lower.includes("entitlement_unavailable")) {
    return {
      code: "unavailable",
      message: "WDIMTM Cloud could not verify your Cloud access just now. Try again in a moment.",
    };
  }
  // 402 Payment Required (#51, #75): out of credits, and buying more fixes it
  // unless the operator's budget is what stopped the run.
  if (
    status === 402 ||
    /\(402\)|\b402 payment/.test(lower) ||
    lower.includes("insufficient_credits") ||
    lower.includes("payment required") ||
    lower.includes("payment_required")
  ) {
    if (mode !== "cloud") {
      // The user's own provider wants money; WDIMTM credits would not help.
      return {
        code: "quota",
        message: "Your API provider says payment is required (402). Add credit or check billing on that account.",
      };
    }
    return classifyPaymentRequired(errorBody(err, raw), lower);
  }
  // 429 from Cloud's request limiter (#139): credits are fine, the client is
  // just going too fast. Before the quota branch, which also matches 429.
  if (mode === "cloud" && lower.includes("rate_limited")) {
    return {
      code: "rate_limited",
      message: "Too many WDIMTM Cloud requests in a short time. Wait a minute and try again.",
    };
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota")) {
    return {
      code: "quota",
      message:
        mode === "cloud"
          ? "WDIMTM Cloud quota is used up (429). Wait for the reset or raise your plan limit."
          : "Rate limit / quota exceeded (429). Wait or check your provider plan.",
    };
  }
  if (lower.includes("404")) {
    return {
      code: "not_found",
      message:
        mode === "cloud"
          ? "WDIMTM Cloud endpoint not found (404). Check the cloud base URL (see docs/cloud-api-contract.md)."
          : "Endpoint not found (404). Check API base URL (should usually end with /v1).",
    };
  }
  // A cancel is the user's own doing — it must never be dressed up as a failure,
  // and it is checked before the timeout branch because "canceled" also aborts.
  if (lower.includes("cancel")) {
    return { code: "canceled", message: "Request canceled." };
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted")) {
    return { code: "timeout", message: "Request timed out. Try again or use a faster model." };
  }
  if (lower.includes("api key is required") || lower.includes("missing")) {
    return {
      code: "missing_key",
      message:
        mode === "cloud"
          ? "WDIMTM Cloud is not configured. Set the cloud base URL and paste an access token."
          : "API key is required for bring-your-own-key mode.",
    };
  }

  return { code: "unknown", message: raw.slice(0, 280) || "Unknown runtime error." };
}
