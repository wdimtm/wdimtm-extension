/**
 * WDIMTM Cloud HTTP contract client (Issue #51).
 *
 * The extension only ever speaks this contract. It must never learn how the
 * cloud is implemented (managed inference, PromptaaS, self-hosted, …) — that
 * is what keeps one client compatible with several backends.
 *
 * Contract: docs/cloud-api-contract.md
 */

/** Keys that must never leave the browser inside a sync payload. */
const SECRET_KEY_PATTERN = /(api[-_]?key|access[-_]?token|secret|password|bearer)/i;

/**
 * @typedef {Object} CloudConfig
 * @property {string} baseUrl
 * @property {string} accessToken
 * @property {boolean} configured
 */

/**
 * @param {{ cloudBaseUrl?: string, cloudAccessToken?: string } | null | undefined} settings
 * @returns {CloudConfig}
 */
/** Production Cloud origin — also the default in settings. */
export const DEFAULT_CLOUD_BASE_URL = "https://cloud.wdimtm.com";

export function resolveCloudConfig(settings) {
  const baseUrl = String(settings?.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const accessToken = String(settings?.cloudAccessToken || "").trim();
  return { baseUrl, accessToken, configured: Boolean(baseUrl) };
}

/**
 * @param {string} baseUrl
 * @param {string} path
 */
export function cloudPath(baseUrl, path) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  const suffix = String(path || "").replace(/^\/+/, "");
  return `${base}/v1/${suffix}`;
}

/**
 * Fetch with WDIMTM Cloud auth + normalized errors.
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @param {string} path
 * @param {{ method?: string, body?: unknown, accept?: string, signal?: AbortSignal }} [init]
 * @returns {Promise<Response>}
 */
export async function cloudFetch(config, path, init = {}) {
  const baseUrl = String(config?.baseUrl || "").trim();
  if (!baseUrl) {
    throw new Error("WDIMTM Cloud base URL is required.");
  }

  /** @type {Record<string, string>} */
  const headers = {
    Accept: init.accept || "application/json",
    "X-WDIMTM-Client": "extension",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;

  const res = await fetch(cloudPath(baseUrl, path), {
    method: init.method || (init.body !== undefined ? "POST" : "GET"),
    headers,
    ...(init.signal ? { signal: init.signal } : {}),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `WDIMTM Cloud request failed (${res.status}): ${text.slice(0, 240)}`
    );
  }
  return res;
}

/**
 * Trade a Google access token for a WDIMTM Cloud session (Issue #51).
 * The Google token is used once and never stored.
 * @param {{ baseUrl?: string }} config
 * @param {string} googleAccessToken
 * @returns {Promise<{
 *   accessToken: string,
 *   expiresAt?: string,
 *   user: { id: string, email?: string },
 *   plan?: string,
 *   quota?: object,
 * }>}
 */
export async function exchangeGoogleToken(config, googleAccessToken) {
  const res = await cloudFetch(config, "/auth/google", {
    method: "POST",
    body: { googleAccessToken },
  });
  return res.json();
}

/**
 * Invalidate the current session server-side.
 * @param {{ baseUrl?: string, accessToken?: string }} config
 */
export async function revokeCloudSession(config) {
  await cloudFetch(config, "/auth/signout", { method: "POST", body: {} });
}

/**
 * Account + entitlement snapshot. Also used as the connectivity probe.
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @returns {Promise<{
 *   userId?: string,
 *   plan?: string,
 *   entitlements?: string[],
 *   quota?: { used?: number, limit?: number, resetAt?: string },
 * }>}
 */
export async function fetchCloudAccount(config) {
  const res = await cloudFetch(config, "/me");
  return res.json();
}

/**
 * Public package catalog. Auth is optional (list works without a session).
 * When Agentaab backs Cloud, packages come from there; the client only sees
 * this contract.
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @param {{ currency?: string }} [opts]
 * @returns {Promise<{
 *   packages: Array<{
 *     id: string,
 *     name: string,
 *     nameZh?: string,
 *     credits: number,
 *     currency: string,
 *     price_cents: number,
 *     description?: string,
 *     descriptionZh?: string,
 *   }>,
 *   source?: string,
 *   checkout_available?: boolean,
 *   currency?: string,
 *   warning?: string,
 * }>}
 */
export async function fetchCloudPackages(config, opts = {}) {
  const q = opts.currency ? `?currency=${encodeURIComponent(opts.currency)}` : "";
  // packages is public — allow missing token
  const res = await cloudFetch(
    { baseUrl: config.baseUrl, accessToken: config.accessToken || "" },
    `/packages${q}`
  );
  return res.json();
}

/**
 * Start checkout for a package. Requires a signed-in Cloud session.
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @param {{ packageId: string, paymentRail?: string }} body
 * @returns {Promise<{ checkout_url: string, payment_id?: string, package?: object }>}
 */
export async function startCloudPackageCheckout(config, body) {
  const res = await cloudFetch(config, "/packages/checkout", {
    method: "POST",
    body: {
      packageId: body.packageId,
      ...(body.paymentRail ? { payment_rail: body.paymentRail } : {}),
    },
  });
  return res.json();
}

/**
 * Ask Cloud to turn any completed payment into credits (#88).
 *
 * Checkout finishes on the payment provider's page, not in the extension, so
 * nothing in the browser knows when the money landed. The client asks; the
 * server is the one that decides. Safe to call repeatedly — a payment is
 * credited once.
 *
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @returns {Promise<{ grantsAdded: number, creditsAdded: number, quota?: object, plan?: string }>}
 */
export async function reconcileCloudCredits(config) {
  const res = await cloudFetch(config, "/credits/reconcile", { method: "POST", body: {} });
  return res.json();
}

/**
 * Pull the cloud copy of the user's personal context.
 * Returns null when the cloud has no snapshot yet (fresh account).
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @returns {Promise<import('./auth/types.js').UserDataSnapshot | null>}
 */
export async function pullCloudSnapshot(config) {
  /** @type {Response} */
  let res;
  try {
    res = await cloudFetch(config, "/memory");
  } catch (err) {
    if (/\(404\)/.test(err instanceof Error ? err.message : "")) return null;
    throw err;
  }
  const data = await res.json().catch(() => null);
  return data?.snapshot || null;
}

/**
 * Push the local snapshot. Secrets are stripped here, not by the caller —
 * the boundary that talks to the network is the one that must guarantee it.
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @param {import('./auth/types.js').UserDataSnapshot} snapshot
 * @returns {Promise<{ ok?: boolean, updatedAt?: string }>}
 */
export async function pushCloudSnapshot(config, snapshot) {
  const res = await cloudFetch(config, "/memory", {
    method: "POST",
    body: { snapshot: stripSecrets(snapshot) },
  });
  return res.json().catch(() => ({ ok: true }));
}

/**
 * Deep-remove anything that looks like a credential.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function stripSecrets(value) {
  if (Array.isArray(value)) {
    return /** @type {any} */ (value.map((v) => stripSecrets(v)));
  }
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k)) continue;
      out[k] = stripSecrets(v);
    }
    return /** @type {any} */ (out);
  }
  return value;
}
