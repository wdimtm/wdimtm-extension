/**
 * WDIMTM Cloud sync provider (Issue #51, extends #28 Phase B).
 *
 * Local memory is never a hostage: moving Local → Cloud uploads a copy, and
 * moving back is just switching the service mode. Migration never deletes the
 * side it did not write.
 */

import { exchangeGoogleToken, pullCloudSnapshot, pushCloudSnapshot, revokeCloudSession } from "../cloud.js";
import { mergeLastWriteWins } from "./local.js";

/**
 * Google-backed cloud auth (Issue #51).
 *
 * The browser-specific parts (chrome.identity, storage) are injected, so the
 * flow itself is testable and a different host could reuse it.
 *
 * @param {{
 *   config: { baseUrl?: string, accessToken?: string },
 *   getGoogleToken: (opts?: { interactive?: boolean }) => Promise<{ token: string }>,
 *   persistSession: (session: import('./types.js').Session | null) => Promise<void>,
 *   readSession: () => Promise<import('./types.js').Session | null>,
 *   exchange?: typeof exchangeGoogleToken,
 *   revoke?: typeof revokeCloudSession,
 * }} deps
 * @returns {import('./types.js').AuthProvider}
 */
export function createCloudAuthProvider(deps) {
  const exchange = deps.exchange || exchangeGoogleToken;
  const revoke = deps.revoke || revokeCloudSession;

  return {
    async getSession() {
      const session = await deps.readSession();
      if (!session?.accessToken) return null;
      if (session.expiresAt && session.expiresAt < Date.now()) {
        await deps.persistSession(null);
        return null;
      }
      return session;
    },

    async signIn() {
      if (!String(deps.config?.baseUrl || "").trim()) {
        throw new Error(
          "WDIMTM Cloud is not configured. Set the cloud base URL in options first."
        );
      }

      const { token: googleAccessToken } = await deps.getGoogleToken({ interactive: true });
      const result = await exchange(deps.config, googleAccessToken);
      if (!result?.accessToken) {
        throw new Error("WDIMTM Cloud did not return a session token.");
      }

      /** @type {import('./types.js').Session} */
      const session = {
        userId: result.user?.id || "",
        email: result.user?.email || "",
        provider: "google",
        accessToken: result.accessToken,
        ...(result.expiresAt ? { expiresAt: Date.parse(result.expiresAt) || undefined } : {}),
        ...(result.plan ? { plan: result.plan } : {}),
      };
      await deps.persistSession(session);
      return session;
    },

    async signOut() {
      const session = await deps.readSession();
      if (session?.accessToken) {
        // Best effort: a failed server call must never strand the user signed in.
        await revoke({ ...deps.config, accessToken: session.accessToken }).catch(() => {});
      }
      await deps.persistSession(null);
    },
  };
}

/**
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @returns {import('./types.js').SyncProvider & {
 *   migrateLocalToCloud: (local: import('./types.js').UserDataSnapshot) => Promise<{
 *     action: 'uploaded' | 'kept_cloud' | 'skipped',
 *     snapshot: import('./types.js').UserDataSnapshot | null,
 *   }>,
 * }}
 */
export function createCloudSyncProvider(config) {
  const baseUrl = String(config?.baseUrl || "").trim();
  const accessToken = String(config?.accessToken || "").trim();
  const configured = Boolean(baseUrl);

  function requireConfigured() {
    if (!configured) {
      throw new Error(
        "WDIMTM Cloud is not configured. Set the cloud base URL in options (see docs/cloud-api-contract.md), or stay on Local/BYOK."
      );
    }
  }

  return {
    async pull() {
      if (!configured) return null;
      return pullCloudSnapshot({ baseUrl, accessToken });
    },

    async push(snapshot) {
      requireConfigured();
      await pushCloudSnapshot({ baseUrl, accessToken }, snapshot);
    },

    merge: mergeLastWriteWins,

    /**
     * First-time Local → Cloud migration. Uploads only when the cloud has
     * nothing newer, so a second device cannot overwrite fresher context.
     */
    async migrateLocalToCloud(local) {
      requireConfigured();
      if (!local) return { action: "skipped", snapshot: null };

      const remote = await pullCloudSnapshot({ baseUrl, accessToken });
      if (remote) {
        const winner = mergeLastWriteWins(local, remote);
        if (winner === remote) {
          return { action: "kept_cloud", snapshot: remote };
        }
      }
      await pushCloudSnapshot({ baseUrl, accessToken }, local);
      return { action: "uploaded", snapshot: local };
    },
  };
}
