/**
 * Local-only auth/sync — fully offline, no network.
 */

/**
 * @returns {import('./types.js').AuthProvider}
 */
export function createLocalAuthProvider() {
  return {
    async getSession() {
      return null;
    },
    async signIn() {
      throw new Error(
        "Local mode has no account. Switch to “Sign in to sync” and complete Phase B OAuth setup."
      );
    },
    async signOut() {},
  };
}

/**
 * @returns {import('./types.js').SyncProvider}
 */
export function createLocalSyncProvider() {
  return {
    async pull() {
      return null;
    },
    async push() {
      // No-op: data already lives in chrome.storage
    },
    merge(local) {
      return local;
    },
  };
}

/**
 * Last-write-wins merge helper (shared by future cloud provider).
 * @param {import('./types.js').UserDataSnapshot} local
 * @param {import('./types.js').UserDataSnapshot} remote
 */
export function mergeLastWriteWins(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const lt = Date.parse(local.updatedAt || 0) || 0;
  const rt = Date.parse(remote.updatedAt || 0) || 0;
  return rt >= lt ? remote : local;
}
