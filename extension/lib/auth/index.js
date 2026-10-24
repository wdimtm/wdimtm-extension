/**
 * Account mode facade (Issue #28 Phase A, cloud sign-in from #51).
 */

import { DEFAULT_SETTINGS, getSettings, saveSettings } from "../settings.js";
import { createCloudAuthProvider, createCloudSyncProvider } from "../../../core/auth/cloud.js";
import { resolveCloudConfig } from "../../../core/cloud.js";
import { getGoogleAccessToken } from "./google.js";
import { createLocalAuthProvider, createLocalSyncProvider, mergeLastWriteWins } from "../../../core/auth/local.js";

const SESSION_KEY = "wdimtm.auth.session";

/**
 * @returns {Promise<'local' | 'cloud'>}
 */
export async function getAccountMode() {
  const s = await getSettings();
  return s.accountMode === "cloud" ? "cloud" : "local";
}

/**
 * @param {'local' | 'cloud'} mode
 */
export async function setAccountMode(mode) {
  await saveSettings({ accountMode: mode === "cloud" ? "cloud" : "local" });
}

/**
 * @returns {Promise<import('./types.js').AuthProvider>}
 */
export async function getAuthProvider() {
  const mode = await getAccountMode();
  if (mode !== "cloud") return createLocalAuthProvider();

  const cloud = resolveCloudConfig(await getSettings());
  if (!cloud.configured) return createCloudAuthStub();

  return createCloudAuthProvider({
    config: { baseUrl: cloud.baseUrl, accessToken: cloud.accessToken },
    getGoogleToken: getGoogleAccessToken,
    readSession: readStoredSession,
    persistSession: storeSession,
  });
}

/**
 * Sessions live in chrome.storage.local (they must survive a browser restart)
 * and the token is mirrored into settings so the runtime adapter can use it.
 * @returns {Promise<import('./types.js').Session | null>}
 */
async function readStoredSession() {
  const data = await chrome.storage.local.get({ [SESSION_KEY]: null });
  return data[SESSION_KEY] || null;
}

/**
 * @param {import('./types.js').Session | null} session
 */
async function storeSession(session) {
  if (session) {
    await chrome.storage.local.set({ [SESSION_KEY]: session });
    await saveSettings({ cloudAccessToken: session.accessToken || "" });
    return;
  }
  await chrome.storage.local.remove(SESSION_KEY);
  // Signing out must not leave a live token behind in settings.
  await saveSettings({ cloudAccessToken: "" });
}

/**
 * Drop the stored session without calling the server: the account it named is
 * gone (#139).
 */
export async function forgetCloudSession() {
  await storeSession(null);
}

/**
 * Forget a session the server answered 401 for (#139): it expired or was
 * revoked. Only that token is cleared, so a sign-in that finished while the
 * failing request was in flight survives.
 * @param {string} rejectedToken
 */
export async function clearRejectedCloudSession(rejectedToken) {
  const token = String(rejectedToken || "").trim();
  if (!token) return;
  const [session, settings] = await Promise.all([readStoredSession(), getSettings()]);
  if (session?.accessToken === token || settings.cloudAccessToken === token) {
    await storeSession(null);
  }
}

/**
 * @returns {Promise<import('./types.js').SyncProvider>}
 */
export async function getSyncProvider() {
  const mode = await getAccountMode();
  if (mode !== "cloud") return createLocalSyncProvider();

  const cloud = resolveCloudConfig(await getSettings());
  if (cloud.configured) {
    // #51: a configured WDIMTM Cloud (or a self-hosted backend implementing the
    // same contract) can sync for real.
    return createCloudSyncProvider({ baseUrl: cloud.baseUrl, accessToken: cloud.accessToken });
  }
  return createCloudSyncStub();
}

/**
 * Build a non-secret snapshot from current settings + memories list.
 * @param {object} settings
 * @param {unknown[]} [memories]
 * @returns {import('./types.js').UserDataSnapshot}
 */
export function buildUserDataSnapshot(settings, memories = []) {
  const { apiKey: _k, cloudAccessToken: _c, ...prefs } = settings || {};
  // Strip secrets from preferences blob
  delete prefs.apiKey;
  delete prefs.cloudAccessToken;
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    profileText: settings?.profileText || "",
    customLenses: settings?.customLenses || [],
    memories,
    preferences: {
      defaultLensId: settings?.defaultLensId,
      uiLocale: settings?.uiLocale,
      answerLanguage: settings?.answerLanguage,
      answerDepth: settings?.answerDepth,
      theme: settings?.theme,
      denylist: settings?.denylist,
      stream: settings?.stream,
      enabled: settings?.enabled,
      memoryProvider: settings?.memoryProvider,
      runtime: settings?.runtime,
      // endpoints without keys
      apiBaseUrl: settings?.apiBaseUrl,
      model: settings?.model,
      // Endpoint is a preference; the cloud access token stays device-local.
      cloudBaseUrl: settings?.cloudBaseUrl,
      accountMode: settings?.accountMode || "local",
      syncPreferences: settings?.syncPreferences !== false,
      syncChatHistory: Boolean(settings?.syncChatHistory),
      syncSecrets: Boolean(settings?.syncSecrets),
    },
  };
}

/**
 * Cloud auth stub until Phase B wires OAuth + backend.
 * Stores optional session in session storage only (for UI experiments).
 * @returns {import('./types.js').AuthProvider}
 */
function createCloudAuthStub() {
  return {
    async getSession() {
      const data = await chrome.storage.session.get({ [SESSION_KEY]: null });
      return data[SESSION_KEY] || null;
    },
    async signIn() {
      throw new Error(
        "Cloud sign-in is not configured yet. Phase B will add OAuth (e.g. Google via chrome.identity) and a sync backend. Stay on Local mode for now, or use Export/Import."
      );
    },
    async signOut() {
      await chrome.storage.session.remove(SESSION_KEY);
    },
  };
}

/**
 * @returns {import('./types.js').SyncProvider}
 */
function createCloudSyncStub() {
  return {
    async pull() {
      return null;
    },
    async push() {
      throw new Error(
        "Cloud sync backend is not configured. See docs/auth-and-sync.md Phase B."
      );
    },
    merge: mergeLastWriteWins,
  };
}

export { DEFAULT_SETTINGS, getSettings, saveSettings };
