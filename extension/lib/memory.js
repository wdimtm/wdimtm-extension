/**
 * Memory provider abstraction (Issues #3 / #5).
 *
 * Principle: memory providers own what is known about the user;
 * WDIMTM owns deciding what is relevant right now.
 */

/**
 * @typedef {'profile' | 'interest' | 'goal' | 'knowledge' | 'preference' | 'note'} MemoryType
 * @typedef {'explicit' | 'suggested' | 'inferred'} MemorySource
 *
 * @typedef {Object} Memory
 * @property {string} id
 * @property {MemoryType} type
 * @property {string} text
 * @property {MemorySource} source
 * @property {number} [confidence]
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} MemoryInput
 * @property {MemoryType} type
 * @property {string} text
 * @property {MemorySource} [source]
 * @property {number} [confidence]
 *
 * @typedef {Object} MemoryProvider
 * @property {() => Promise<Memory[]>} list
 * @property {(query: string, limit?: number) => Promise<Memory[]>} search
 * @property {(input: MemoryInput) => Promise<Memory>} add
 * @property {(inputs: MemoryInput[]) => Promise<Memory[]>} addMany
 * @property {(id: string, patch: Partial<Pick<Memory, 'type' | 'text'>>) => Promise<Memory | null>} update
 * @property {(id: string) => Promise<boolean>} remove
 * @property {() => Promise<void>} clear
 */

const STORAGE_KEY = "wdimtm.memories";

/**
 * Ceiling on stored memories.
 *
 * Was 200 back when memories only ever arrived one at a time. Conversation
 * import (#49) accepts dozens at once, which would silently evict the oldest
 * entries, so the ceiling moved up and callers doing bulk writes are expected
 * to check `MEMORY_LIMIT` before committing rather than let the truncation
 * happen quietly.
 */
export const MEMORY_LIMIT = 500;

/**
 * @returns {MemoryProvider}
 */
export function createNoneMemoryProvider() {
  return {
    async list() {
      return [];
    },
    async search() {
      return [];
    },
    async add() {
      throw new Error("Memory is disabled.");
    },
    async addMany() {
      throw new Error("Memory is disabled.");
    },
    async update() {
      return null;
    },
    async remove() {
      return false;
    },
    async clear() {},
  };
}

/**
 * Local-first structured memories in chrome.storage.local.
 * V1 retrieval: keyword overlap / type priority — no embeddings.
 * @returns {MemoryProvider}
 */
export function createLocalMemoryProvider() {
  return {
    async list() {
      return loadAll();
    },

    async search(query, limit = 6) {
      const all = await loadAll();
      if (!all.length) return [];
      const q = (query || "").toLowerCase();
      if (!q.trim()) {
        // Prefer profile/interests/goals when query empty.
        const rank = { profile: 0, interest: 1, goal: 2, knowledge: 3, preference: 4, note: 5 };
        return [...all]
          .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9))
          .slice(0, limit);
      }
      const tokens = q.split(/\W+/).filter((t) => t.length > 2);
      const scored = all.map((m) => {
        const text = m.text.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (text.includes(t)) score += 2;
        }
        if (m.type === "profile") score += 1;
        if (m.type === "goal") score += 1;
        // Provenance and trust are separate axes: a memory distilled from an
        // import but confirmed by hand in the review screen has `inferred`
        // provenance and high trust. Scoring on confidence rather than source
        // keeps both readable. Memories written before #49 all carry
        // confidence 1, so this reproduces the old +0.5 exactly.
        score += (m.confidence ?? 1) * 0.5;
        return { m, score };
      });
      return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => s.m);
    },

    async add(input) {
      const all = await loadAll();
      const memory = buildMemory(input);
      all.unshift(memory);
      await saveAll(all.slice(0, MEMORY_LIMIT));
      return memory;
    },

    async addMany(inputs) {
      const all = await loadAll();
      const memories = inputs.map(buildMemory);
      // One read/write for the whole batch — conversation import commits
      // dozens at once and a per-item round trip would be wasteful.
      all.unshift(...memories);
      await saveAll(all.slice(0, MEMORY_LIMIT));
      return memories;
    },

    async update(id, patch) {
      const all = await loadAll();
      const idx = all.findIndex((m) => m.id === id);
      if (idx < 0) return null;
      const next = {
        ...all[idx],
        ...patch,
        text: patch.text != null ? patch.text.trim() : all[idx].text,
        updatedAt: new Date().toISOString(),
      };
      all[idx] = next;
      await saveAll(all);
      return next;
    },

    async remove(id) {
      const all = await loadAll();
      const next = all.filter((m) => m.id !== id);
      if (next.length === all.length) return false;
      await saveAll(next);
      return true;
    },

    async clear() {
      await saveAll([]);
    },
  };
}

/**
 * @param {'local' | 'none' | string} kind
 * @returns {MemoryProvider}
 */
export function getMemoryProvider(kind) {
  if (kind === "none") return createNoneMemoryProvider();
  return createLocalMemoryProvider();
}

function buildMemory(input) {
  const now = new Date().toISOString();
  const text = (input.text || "").trim();
  if (!text) throw new Error("Memory text is required.");
  return {
    id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type: input.type || "note",
    text,
    source: input.source || "explicit",
    confidence: typeof input.confidence === "number" ? input.confidence : 1,
    createdAt: now,
    updatedAt: now,
  };
}

async function loadAll() {
  const data = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  const list = data[STORAGE_KEY];
  return Array.isArray(list) ? list : [];
}

/** @param {Memory[]} list */
async function saveAll(list) {
  await chrome.storage.local.set({ [STORAGE_KEY]: list });
}

// Re-exported so existing import sites keep working; the mapping itself is
// host-free and lives in memory-context.js now.
export { toExplainMemories } from "../../core/memory-context.js";
