/**
 * Auth + sync contracts (Issue #28).
 * Local-first: cloud is opt-in and requires a backend in Phase B.
 */

/**
 * @typedef {Object} Session
 * @property {string} userId
 * @property {string} [email]
 * @property {string} [displayName]
 * @property {string} [provider]  // google | github | oidc | …
 * @property {string} [accessToken]  // never persist to sync storage unencrypted
 * @property {number} [expiresAt]
 */

/**
 * @typedef {Object} UserDataSnapshot
 * @property {number} version
 * @property {string} updatedAt
 * @property {string} [profileText]
 * @property {unknown[]} [customLenses]
 * @property {unknown[]} [memories]
 * @property {Record<string, unknown>} [preferences]
 * @property {unknown[]} [chatThreads]
 */

/**
 * @typedef {Object} AuthProvider
 * @property {() => Promise<Session | null>} getSession
 * @property {() => Promise<Session>} signIn
 * @property {() => Promise<void>} signOut
 */

/**
 * @typedef {Object} SyncProvider
 * @property {() => Promise<UserDataSnapshot | null>} pull
 * @property {(snapshot: UserDataSnapshot) => Promise<void>} push
 * @property {(local: UserDataSnapshot, remote: UserDataSnapshot) => UserDataSnapshot} merge
 */

export {};
