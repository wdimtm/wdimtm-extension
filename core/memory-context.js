/**
 * Shaping stored memories into what a model request carries — pure, so the
 * runtime can do it without importing the chrome.storage-backed provider.
 */

/**
 * Convert free-form profile text + stored memories into ExplainRequest.memories.
 * @param {string} profileText
 * @param {Memory[]} memories
 */
export function toExplainMemories(profileText, memories) {
  /** @type {Array<{ type: string, content: string }>} */
  const out = [];
  if (profileText?.trim()) {
    out.push({ type: "profile", content: profileText.trim() });
  }
  for (const m of memories) {
    out.push({ type: m.type, content: m.text });
  }
  return out;
}

/**
 * @param {MemoryInput} input
 * @returns {Memory}
 */
