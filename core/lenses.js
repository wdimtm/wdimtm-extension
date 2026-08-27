/**
 * Built-in and custom Lenses (Issue #2).
 * A Lens is an explicit, inspectable intent — pick how WDIMTM should read the selection.
 */

/**
 * @typedef {Object} LensDef
 * @property {string} id
 * @property {string} name          Short label in the bubble dropdown
 * @property {string} [nameZh]      Optional Chinese label (preferred when UI is zh)
 * @property {string} [hint]        One-line description for options / settings
 * @property {string} instructions
 * @property {boolean} [builtin]
 */

/** @type {LensDef[]} */
export const BUILTIN_LENSES = [
  {
    id: "general",
    name: "Explain",
    nameZh: "通俗解释",
    hint: "What is this saying? Plain-language unpacking.",
    instructions:
      "Explain unfamiliar concepts and context in plain language. Keep it short. Define jargon only when needed. Match the language of the selection when possible.",
    builtin: true,
  },
  {
    id: "sanity",
    name: "Sanity check",
    nameZh: "有没有道理",
    hint: "Does this claim hold water? Logic, plausibility, missing pieces.",
    instructions:
      "Evaluate whether the selected claims are reasonable. Separate (1) well-established facts, (2) plausible but unproven assertions, and (3) leaps or contradictions. Note what would need to be true for the story to hold, and the strongest counter-arguments. Do not invent sources; flag uncertainty. Prefer the language of the selection (e.g. Chinese if the selection is Chinese).",
    builtin: true,
  },
  {
    id: "fact-check",
    name: "Fact check",
    nameZh: "核实主张",
    hint: "List checkable claims and what would verify them.",
    instructions:
      "Identify discrete checkable claims (numbers, dates, attributions, causal links). For each: state the claim, what evidence would confirm or refute it, and confidence. Do not invent sources. Flag uncertainty explicitly. Prefer the language of the selection.",
    builtin: true,
  },
  {
    id: "opportunities",
    name: "Opportunities",
    nameZh: "找机会",
    hint: "Arbitrage, incentives, mispricing, monetization (speculative).",
    instructions:
      "Look for arbitrage, mispricing, incentives, early-adopter advantages, or monetization opportunities. Clearly separate evidence from speculation. Never claim an opportunity is proven without evidence. Prefer the language of the selection.",
    builtin: true,
  },
  {
    id: "engineering",
    name: "Engineering",
    nameZh: "工程视角",
    hint: "Architecture, implementation, trade-offs.",
    instructions:
      "Focus on architecture, implementation, trade-offs, failure modes, and applicability for a software engineer. Prefer the language of the selection.",
    builtin: true,
  },
  {
    id: "investing",
    name: "Investing",
    nameZh: "投资视角",
    hint: "Business, market, risk, valuation-relevant angles.",
    instructions:
      "Focus on business/market implications, risks, competitive dynamics, and valuation-relevant information. Separate facts from hypotheses. Prefer the language of the selection.",
    builtin: true,
  },
];

/** @returns {Record<string, string>} */
export function builtinInstructionsMap() {
  /** @type {Record<string, string>} */
  const map = {};
  for (const l of BUILTIN_LENSES) map[l.id] = l.instructions;
  return map;
}

/**
 * Label for bubble / dropdown. Prefer Chinese when page/UI looks Chinese.
 * @param {LensDef} lens
 * @param {boolean} [preferZh]
 */
export function lensLabel(lens, preferZh = false) {
  if (preferZh && lens.nameZh) return lens.nameZh;
  return lens.name;
}

/**
 * @typedef {{ name?: string, nameZh?: string, hint?: string, instructions?: string }} LensOverride
 * @typedef {Record<string, LensOverride>} LensOverrides
 */

/**
 * @param {string} id
 * @param {LensDef[]} [custom]
 * @param {LensOverrides} [overrides]
 * @returns {LensDef | undefined}
 */
export function findLens(id, custom = [], overrides = {}) {
  const base =
    BUILTIN_LENSES.find((l) => l.id === id) || custom.find((l) => l.id === id);
  if (!base) return undefined;
  return applyOverride(base, overrides[id]);
}

/**
 * @param {LensDef} base
 * @param {LensOverride | undefined} override
 * @returns {LensDef}
 */
export function applyOverride(base, override) {
  if (!override) return { ...base };
  return {
    ...base,
    name: override.name?.trim() || base.name,
    nameZh: override.nameZh?.trim() || base.nameZh,
    hint: override.hint?.trim() || base.hint,
    instructions: override.instructions?.trim() || base.instructions,
    /** @type {boolean} */
    overridden: Boolean(
      (override.instructions && override.instructions.trim() !== base.instructions) ||
        (override.name && override.name.trim() && override.name.trim() !== base.name) ||
        (override.nameZh && override.nameZh.trim() && override.nameZh.trim() !== base.nameZh)
    ),
  };
}

/**
 * Effective list for UI: builtins (with overrides) + custom.
 * @param {LensDef[]} [custom]
 * @param {LensOverrides} [overrides]
 * @returns {Array<LensDef & { kind: 'builtin' | 'custom', overridden?: boolean }>}
 */
export function listManageableLenses(custom = [], overrides = {}) {
  const builtins = BUILTIN_LENSES.map((l) => {
    const applied = applyOverride(l, overrides[l.id]);
    return {
      ...applied,
      kind: /** @type {'builtin'} */ ("builtin"),
      overridden: Boolean(overrides[l.id]?.instructions || overrides[l.id]?.name),
    };
  });
  const customs = (custom || []).map((l) => ({
    ...l,
    kind: /** @type {'custom'} */ ("custom"),
    overridden: false,
    builtin: false,
  }));
  return [...builtins, ...customs];
}

/**
 * @param {{ id?: string, instructions?: string } | undefined} lens
 * @param {string} defaultLensId
 * @param {LensDef[]} custom
 * @param {LensOverrides} [overrides]
 */
export function resolveLens(lens, defaultLensId, custom = [], overrides = {}) {
  const id = lens?.id || defaultLensId || "general";
  const found = findLens(id, custom, overrides);
  return {
    id,
    name: found?.name || id,
    instructions: lens?.instructions || found?.instructions || builtinInstructionsMap().general,
  };
}

/**
 * @param {string} name
 * @param {string} instructions
 * @param {{ nameZh?: string, hint?: string }} [extra]
 * @returns {LensDef}
 */
export function createCustomLens(name, instructions, extra = {}) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "custom";
  return {
    id: `custom-${slug}-${Date.now().toString(36)}`,
    name: name.trim() || "Custom",
    nameZh: extra.nameZh?.trim() || undefined,
    hint: extra.hint?.trim() || undefined,
    instructions: instructions.trim(),
    builtin: false,
  };
}

/**
 * @param {string} id
 * @param {{ name?: string, nameZh?: string, hint?: string, instructions?: string }} patch
 * @param {LensDef[]} custom
 * @returns {LensDef[]}
 */
export function updateCustomLens(id, patch, custom = []) {
  return (custom || []).map((l) => {
    if (l.id !== id) return l;
    return {
      ...l,
      name: patch.name?.trim() || l.name,
      nameZh: patch.nameZh !== undefined ? patch.nameZh.trim() || undefined : l.nameZh,
      hint: patch.hint !== undefined ? patch.hint.trim() || undefined : l.hint,
      instructions:
        patch.instructions !== undefined ? patch.instructions.trim() : l.instructions,
    };
  });
}

/**
 * Duplicate a built-in (or any) lens as a new custom lens for free editing.
 * @param {LensDef} source
 * @param {string} [nameSuffix]
 */
export function forkLens(source, nameSuffix = " (copy)") {
  return createCustomLens(
    `${source.name || source.id}${nameSuffix}`,
    source.instructions || "",
    { nameZh: source.nameZh, hint: source.hint }
  );
}

/**
 * @param {LensOverrides} overrides
 * @param {string} id
 * @param {LensOverride} patch
 */
export function setLensOverride(overrides, id, patch) {
  return {
    ...(overrides || {}),
    [id]: {
      ...(overrides?.[id] || {}),
      ...patch,
    },
  };
}

/**
 * @param {LensOverrides} overrides
 * @param {string} id
 */
export function clearLensOverride(overrides, id) {
  const next = { ...(overrides || {}) };
  delete next[id];
  return next;
}
