/**
 * Google sign-in glue for MV3 (Issue #51).
 *
 * Sign-in always goes through `chrome.identity.launchWebAuthFlow` with a Google
 * "Web application" client whose redirect URI is this extension's
 * `https://<id>.chromiumapp.org/google`. `getAuthToken` is not used: Google no
 * longer lets new Chrome-extension clients use its custom URI scheme, so it fails
 * with "Custom URI scheme is not supported on Chrome apps" outside a signed-in
 * Google Chrome profile.
 *
 * This module deals only in Google tokens. Trading one for a WDIMTM session is
 * auth/cloud.js — a Google token never becomes a WDIMTM credential by itself.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const SCOPES = ["openid", "email", "profile"];

/**
 * @returns {string}
 */
function manifestClientId() {
  return chrome.runtime.getManifest()?.oauth2?.client_id || "";
}

/**
 * @param {{ interactive?: boolean }} [opts]
 * @returns {Promise<{ token: string }>}
 */
export async function getGoogleAccessToken(opts = {}) {
  const interactive = opts.interactive !== false;

  if (!chrome.identity?.launchWebAuthFlow) {
    throw new Error("This browser cannot sign in to Google from the extension.");
  }

  const clientId = manifestClientId();
  if (!clientId) {
    throw new Error(
      "No Google client id in the manifest. See cloud/README.md to create an OAuth client."
    );
  }

  const redirectUri = chrome.identity.getRedirectURL("google");
  const url =
    `${GOOGLE_AUTH_URL}?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES.join(" "))}`;

  const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive });
  const token = new URLSearchParams(String(redirect || "").split("#")[1] || "").get(
    "access_token"
  );
  if (!token) throw new Error("Google sign-in was cancelled.");
  return { token };
}

/**
 * Drop Chrome's cached token so the next sign-in really re-authenticates.
 * @param {string} [token]
 */
export async function clearCachedGoogleToken(token) {
  if (!token || !chrome.identity?.removeCachedAuthToken) return;
  await new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve(undefined));
  });
}
