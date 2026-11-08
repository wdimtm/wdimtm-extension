/**
 * Merging two UserDataSnapshots, and turning the result back into local writes.
 *
 * "Sync now" used to pull, pick one whole snapshot by timestamp, and push it —
 * never writing anything back, so a second device received nothing, and a
 * memory added on each device lost one of the two. Memories are a collection
 * keyed by id, so they merge as a union; profile, lenses and preferences are
 * single values, so the side that changed them last wins them as a unit.
 */

/** Preferences a snapshot may change on this device. Everything else in a snapshot's
 * `preferences` (endpoints, account mode, secrets flag, runtime) is device-local or
 * decides where credentials go, so a remote snapshot never writes it. */
export const SYNCED_PREFERENCE_KEYS = /** @type {const} */ ([
  "defaultLensId",
  "uiLocale",
  "answerLanguage",
  "answerDepth",
  "theme",
  "denylist",
  "stream",
  "enabled",
]);

/** Settings keys whose change makes this device's profile/lenses/preferences "newer". */
export const SYNCED_FIELD_KEYS = /** @type {const} */ (["profileText", "customLenses", ...SYNCED_PREFERENCE_KEYS]);

const time = (iso) => Date.parse(iso || 0) || 0;

/**
 * @param {unknown[] | undefined} a
 * @param {unknown[] | undefined} b
 */
function mergeMemories(a, b) {
  const byId = new Map();
  for (const memory of [...(a || []), ...(b || [])]) {
    if (!memory || typeof memory !== "object" || typeof memory.id !== "string") continue;
    const seen = byId.get(memory.id);
    if (!seen || time(memory.updatedAt) > time(seen.updatedAt)) byId.set(memory.id, memory);
  }
  return [...byId.values()].sort((x, y) => time(y.updatedAt) - time(x.updatedAt));
}

/**
 * @param {import('./types.js').UserDataSnapshot | null | undefined} local
 * @param {import('./types.js').UserDataSnapshot | null | undefined} remote
 * @returns {import('./types.js').UserDataSnapshot}
 */
export function mergeSnapshots(local, remote) {
  if (!remote) return /** @type {any} */ (local);
  if (!local) return remote;
  // Ties keep this device's values: nothing changed anywhere that we know of.
  const fieldsWinner = time(remote.fieldsUpdatedAt) > time(local.fieldsUpdatedAt) ? remote : local;
  const newer = time(remote.updatedAt) > time(local.updatedAt) ? remote : local;
  return {
    ...fieldsWinner,
    version: 1,
    updatedAt: newer.updatedAt,
    fieldsUpdatedAt: fieldsWinner.fieldsUpdatedAt || "",
    memories: mergeMemories(local.memories, remote.memories),
    ...(newer.chatThreads ? { chatThreads: newer.chatThreads } : {}),
  };
}

/**
 * What a snapshot changes on this device.
 * @param {import('./types.js').UserDataSnapshot} snapshot
 * @param {{ syncPreferences?: boolean }} [options]
 * @returns {{ settings: Record<string, unknown>, memories: unknown[] }}
 */
export function snapshotToLocalChanges(snapshot, options = {}) {
  /** @type {Record<string, unknown>} */
  const settings = {};
  if (options.syncPreferences !== false) {
    if (typeof snapshot.profileText === "string") settings.profileText = snapshot.profileText;
    if (Array.isArray(snapshot.customLenses)) settings.customLenses = snapshot.customLenses;
    const prefs = snapshot.preferences || {};
    for (const key of SYNCED_PREFERENCE_KEYS) {
      if (key in prefs && prefs[key] !== undefined) settings[key] = prefs[key];
    }
    if (Object.keys(settings).length) settings.syncedFieldsUpdatedAt = snapshot.fieldsUpdatedAt || "";
  }
  return { settings, memories: Array.isArray(snapshot.memories) ? snapshot.memories : [] };
}
