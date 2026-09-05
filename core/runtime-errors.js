/**
 * Classify provider errors for user-facing copy (#17 / #18).
 */

/**
 * @param {unknown} err
 * @param {'byok' | 'cloud' | 'mock' | string} [mode]
 * @returns {{ code: string, message: string }}
 */
export function classifyRuntimeError(err, mode = "byok") {
  const raw = err instanceof Error ? err.message : String(err || "");
  const lower = raw.toLowerCase();

  if (!raw || lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return {
      code: "offline",
      message:
        mode === "cloud"
          ? "Cannot reach WDIMTM Cloud. Check the cloud base URL and your network."
            : "Cannot reach the API. Check the base URL, network, and host permissions.",
    };
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    return {
      code: "unauthorized",
      message:
        mode === "cloud"
          ? "WDIMTM Cloud rejected the access token (401). Sign in again to refresh it."
            : "API key rejected (401). Check the key and that it matches the base URL.",
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
  // 402 Payment Required: cloud credits are used up (#51).
  if (lower.includes("402") || lower.includes("insufficient_credits")) {
    return {
      code: "quota",
      message:
        "WDIMTM Cloud credits for this period are used up. Wait for the reset, raise your plan, or switch to your own API key.",
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
