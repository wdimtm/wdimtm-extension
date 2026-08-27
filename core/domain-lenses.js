/**
 * Per-domain default Lens (Issue #19).
 *
 * X, GitHub and a docs site want different default intents, and switching lens
 * by hand on every selection is friction on the surface WDIMTM is used most.
 *
 * A rule is only a *default*: the bubble still overrides it for one selection,
 * and nothing here ever changes what the user explicitly picked.
 *
 * Hostname matching shares `site-scope.js` with the denylist — exact host or a
 * dot-boundary suffix — so "which sites does this apply to" means the same thing
 * everywhere in the product. It used to only claim to.
 */

import { normalizeHost } from "./site-scope.js";

/** @typedef {{ host: string, lensId: string }} DomainLensRule */

/**
 * Starting points offered in options. Suggestions, never applied automatically:
 * guessing a user's intent per site and silently acting on it is exactly the
 * behaviour WDIMTM avoids elsewhere.
 * @type {DomainLensRule[]}
 */
export const DOMAIN_LENS_PRESETS = [
  { host: "x.com", lensId: "sanity" },
  { host: "news.ycombinator.com", lensId: "sanity" },
  { host: "github.com", lensId: "engineering" },
  { host: "arxiv.org", lensId: "engineering" },
];

/**
 * Parse the options textarea. One rule per line; `=`, `:` and `→` all separate,
 * because people type what looks natural rather than what a parser wants.
 *
 * @param {string} text
 * @returns {DomainLensRule[]}
 */
export function parseDomainLensRules(text) {
  /** @type {DomainLensRule[]} */
  const rules = [];
  for (const raw of String(text || "").split("\n")) {
    // Drop a pasted scheme before splitting, or "https://x.com: sanity" would
    // separate at the scheme's colon.
    const line = raw.trim().replace(/^https?:\/\//i, "");
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s*(?:=|:|→|->)\s*/);
    if (parts.length < 2) continue;
    const host = normalizeHost(parts[0]);
    const lensId = String(parts.slice(1).join("").trim());
    // Half a rule is not a rule — storing it would silently do nothing later.
    if (!host || !lensId) continue;
    rules.push({ host, lensId });
  }
  return rules;
}

/**
 * @param {DomainLensRule[]} rules
 * @returns {string}
 */
export function formatDomainLensRules(rules) {
  return (rules || [])
    .filter((r) => r?.host && r?.lensId)
    .map((r) => `${r.host} = ${r.lensId}`)
    .join("\n");
}

/**
 * The lens configured for this hostname, if any. The most specific matching
 * host wins, so `old.reddit.com` can differ from `reddit.com`.
 *
 * @param {string} hostname
 * @param {DomainLensRule[]} rules
 * @returns {string | null}
 */
export function resolveDomainLens(hostname, rules) {
  const host = normalizeHost(hostname);
  if (!host) return null;

  /** @type {DomainLensRule | null} */
  let best = null;
  for (const rule of rules || []) {
    const ruleHost = normalizeHost(rule?.host);
    if (!ruleHost || !rule?.lensId) continue;
    if (host !== ruleHost && !host.endsWith(`.${ruleHost}`)) continue;
    if (!best || ruleHost.length > normalizeHost(best.host).length) best = rule;
  }
  return best ? best.lensId : null;
}

/**
 * Which default applies right now: the domain rule if there is a usable one,
 * otherwise the global default.
 *
 * @param {{
 *   hostname?: string,
 *   rules?: DomainLensRule[],
 *   defaultLensId?: string,
 *   availableLensIds?: string[],
 * }} params
 * @returns {string}
 */
export function resolveDefaultLensId(params) {
  const fallback = params?.defaultLensId || "general";
  const domainLens = resolveDomainLens(params?.hostname || "", params?.rules || []);
  if (!domainLens) return fallback;

  // A custom lens can be deleted while a rule still names it. Falling back is
  // right; sending an unknown lens id to the runtime is not.
  const available = params?.availableLensIds;
  if (available?.length && !available.includes(domainLens)) return fallback;
  return domainLens;
}

/**
 * Whether a hostname already has its own rule — used to decide where an
 * explicit pick should be remembered.
 * @param {string} hostname
 * @param {DomainLensRule[]} rules
 */
export function hasDomainRule(hostname, rules) {
  return resolveDomainLens(hostname, rules) !== null;
}

/**
 * Set (or replace) the rule for a hostname, returning a new list.
 * @param {DomainLensRule[]} rules
 * @param {string} hostname
 * @param {string} lensId
 * @returns {DomainLensRule[]}
 */
export function setDomainLens(rules, hostname, lensId) {
  const host = normalizeHost(hostname);
  if (!host || !lensId) return rules || [];
  const next = (rules || []).filter((r) => normalizeHost(r?.host) !== host);
  next.push({ host, lensId });
  return next;
}
