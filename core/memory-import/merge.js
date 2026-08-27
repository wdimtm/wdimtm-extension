/**
 * Merge: the reduce half of the pipeline (Issue #49).
 *
 * The source corpus is large but the candidate set is small — a few hundred
 * one-line statements, well under a single context window. That asymmetry is
 * what makes a model-driven reduce affordable: paraphrases like "I research
 * incentive design in decentralized finance" and "interested in DeFi
 * incentives" are the dominant shape of duplication here, and only a model
 * reliably collapses them.
 *
 * Lexical dedupe runs first as a cheap pre-pass to shrink that input.
 *
 * Pure and deterministic, like distill.js; the network call lives elsewhere.
 */

import { isMemoryType } from "../memory-sources/types.js";
import { extractJsonArray } from "./distill.js";
import { PROFILE_CONFIDENCE } from "./profile.js";

/** Support at or above this saturates the confidence scale. */
export const SUPPORT_SATURATION = 10;

/** Candidates whose normalized token sets overlap this much are the same memory. */
export const NEAR_DUPLICATE_THRESHOLD = 0.85;

/** Character budget for one reduce call's candidate list. */
export const REDUCE_BUDGET_CHARS = 24000;

/**
 * Imported memories rank below hand-written ones, but a memory backed by thirty
 * conversations should outrank one backed by two.
 *
 * The scale is fixed rather than normalized against the current import, so a
 * confidence value means the same thing across imports of different sizes.
 *
 * @param {number} supportCount
 */
export function confidenceFor(supportCount) {
  const support = Math.max(1, Number(supportCount) || 1);
  return 0.6 + 0.3 * Math.min(support / SUPPORT_SATURATION, 1);
}

/**
 * @param {string} text
 */
export function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 */
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Collapse exact and near-exact duplicates without calling a model.
 *
 * @param {import('../memory-sources/types.js').MemoryCandidate[]} candidates
 * @returns {import('../memory-sources/types.js').MergedMemory[]}
 */
export function dedupeLexical(candidates) {
  /** @type {Array<{ merged: import('../memory-sources/types.js').MergedMemory, norm: string, tokens: Set<string>, confidenceSum: number }>} */
  const buckets = [];

  for (const candidate of candidates) {
    const norm = normalizeForCompare(candidate.text);
    if (!norm) continue;
    const tokens = new Set(norm.split(" ").filter(Boolean));

    const bucket = buckets.find(
      (b) =>
        b.merged.type === candidate.type &&
        (b.norm === norm || jaccard(b.tokens, tokens) >= NEAR_DUPLICATE_THRESHOLD)
    );

    if (bucket) {
      bucket.merged.supportCount += 1;
      if (candidate.fromProfile) bucket.merged.fromProfile = true;
      bucket.confidenceSum += candidate.confidence;
      for (const title of candidate.evidenceTitles) {
        if (!bucket.merged.evidenceTitles.includes(title)) {
          bucket.merged.evidenceTitles.push(title);
        }
      }
      continue;
    }

    buckets.push({
      norm,
      tokens,
      confidenceSum: candidate.confidence,
      merged: {
        type: candidate.type,
        text: candidate.text,
        evidenceTitles: [...candidate.evidenceTitles],
        confidence: candidate.confidence,
        supportCount: 1,
        fromProfile: Boolean(candidate.fromProfile),
      },
    });
  }

  return buckets.map((b) => b.merged);
}

/**
 * Split candidates into reduce-sized groups.
 *
 * Grouping by type keeps semantically comparable items together, which is what
 * the reduce call is being asked to compare. Only an unusually large import
 * needs more than one group.
 *
 * @param {import('../memory-sources/types.js').MergedMemory[]} candidates
 * @param {{ budgetChars?: number }} [opts]
 * @returns {import('../memory-sources/types.js').MergedMemory[][]}
 */
export function splitForReduce(candidates, opts = {}) {
  const budget = opts.budgetChars || REDUCE_BUDGET_CHARS;
  const total = candidates.reduce((sum, c) => sum + c.text.length + 24, 0);
  if (total <= budget) return candidates.length ? [candidates] : [];

  /** @type {Map<string, import('../memory-sources/types.js').MergedMemory[]>} */
  const byType = new Map();
  for (const candidate of candidates) {
    const list = byType.get(candidate.type) || [];
    list.push(candidate);
    byType.set(candidate.type, list);
  }

  /** @type {import('../memory-sources/types.js').MergedMemory[][]} */
  const groups = [];
  for (const list of byType.values()) {
    let current = [];
    let size = 0;
    for (const candidate of list) {
      const cost = candidate.text.length + 24;
      if (size && size + cost > budget) {
        groups.push(current);
        current = [];
        size = 0;
      }
      current.push(candidate);
      size += cost;
    }
    if (current.length) groups.push(current);
  }
  return groups;
}

const MERGE_INSTRUCTIONS = `You consolidate a list of candidate memories about one person.

Return a JSON array. Each item:
  "type": one of profile, interest, goal, knowledge, preference, note
  "text": one short first-person sentence
  "from": array of candidate numbers you merged into it
  "duplicates": the label of an existing memory it restates (like "E2"), or null

Rules:
- Merge candidates that say the same thing in different words into one item.
- Keep genuinely distinct memories separate; do not over-merge into vague statements.
- Prefer the clearest wording among the ones you merged.
- If an item restates an existing memory, still return it with "duplicates" set.
- Output only the JSON array, no prose.`;

/**
 * @param {import('../memory-sources/types.js').MergedMemory[]} candidates
 * @param {Array<{ id: string, type: string, text: string }>} existing
 * @returns {{ system: string, user: string }}
 */
export function buildMergePrompt(candidates, existing = []) {
  const parts = [];

  if (existing.length) {
    parts.push("Existing memories:");
    existing.forEach((memory, i) => {
      parts.push(`E${i + 1}. [${memory.type}] ${memory.text}`);
    });
    parts.push("");
  }

  parts.push("Candidates:");
  candidates.forEach((candidate, i) => {
    parts.push(`${i + 1}. [${candidate.type}] ${candidate.text}`);
  });

  return { system: MERGE_INSTRUCTIONS, user: parts.join("\n") };
}

/**
 * Interpret a reduce response.
 *
 * Returns null when the response is unusable, so the caller can retry the group
 * or fall back to the lexically deduped candidates — a failed reduce degrades
 * quality but must never lose work already paid for.
 *
 * @param {string} raw
 * @param {import('../memory-sources/types.js').MergedMemory[]} candidates
 * @param {Array<{ id: string }>} existing
 * @returns {import('../memory-sources/types.js').MergedMemory[] | null}
 */
export function parseMergeResponse(raw, candidates, existing = []) {
  const items = extractJsonArray(raw);
  if (!items) return null;

  /** @type {import('../memory-sources/types.js').MergedMemory[]} */
  const merged = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;

    const sources = Array.isArray(item.from)
      ? item.from.map((n) => candidates[Number(n) - 1]).filter(Boolean)
      : [];

    // Support carries over from the lexical pass; a reduce that merges three
    // buckets of four inherits all twelve.
    const supportCount = sources.reduce((sum, c) => sum + c.supportCount, 0) || 1;

    /** @type {string[]} */
    const evidenceTitles = [];
    for (const source of sources) {
      for (const title of source.evidenceTitles) {
        if (!evidenceTitles.includes(title)) evidenceTitles.push(title);
      }
    }

    // A statement the user's own curated memory store already made outranks
    // anything inferred from a handful of conversations, so merging must not
    // drag it down to whatever support count it happens to land on.
    const fromProfile = sources.some((c) => c.fromProfile);

    /** @type {import('../memory-sources/types.js').MergedMemory} */
    const entry = {
      type: isMemoryType(item.type) ? item.type : sources[0]?.type || "note",
      text,
      evidenceTitles,
      supportCount,
      confidence: fromProfile
        ? Math.max(confidenceFor(supportCount), PROFILE_CONFIDENCE)
        : confidenceFor(supportCount),
    };
    if (fromProfile) entry.fromProfile = true;

    const existingId = resolveExisting(item.duplicates, existing);
    if (existingId) entry.existingId = existingId;

    merged.push(entry);
  }

  return merged;
}

/**
 * @param {unknown} label
 * @param {Array<{ id: string }>} existing
 */
function resolveExisting(label, existing) {
  if (typeof label !== "string") return "";
  const match = /^E(\d+)$/i.exec(label.trim());
  if (!match) return "";
  const memory = existing[Number(match[1]) - 1];
  return memory ? memory.id : "";
}

/**
 * Final ordering for the review screen: strongest support first, so the head is
 * worth expanding and the tail is safe to collapse.
 *
 * @param {import('../memory-sources/types.js').MergedMemory[]} merged
 */
export function rankForReview(merged) {
  return [...merged].sort((a, b) => {
    if (a.existingId && !b.existingId) return 1;
    if (!a.existingId && b.existingId) return -1;
    return b.supportCount - a.supportCount || b.confidence - a.confidence;
  });
}
