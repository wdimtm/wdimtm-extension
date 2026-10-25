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
  // The profile text is often also stored as a profile memory; page chat
  // listed it twice.
  const seen = new Set();
  const push = (type, content) => {
    const text = String(content || "").trim();
    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (!text || seen.has(key)) return;
    seen.add(key);
    out.push({ type, content: text });
  };
  push("profile", profileText);
  for (const m of memories) push(m.type, m.text);
  return out;
}

/**
 * @param {MemoryInput} input
 * @returns {Memory}
 */
