/**
 * Smart lens suggestion (L0 heuristics + L1 profile / default bias).
 *
 * Zero network cost — safe for content scripts (no chrome APIs).
 * User can always override via the bubble lens dropdown.
 *
 * No imports — also loaded as a global for the content script.
 */

/**
 * @typedef {Object} LensSuggestion
 * @property {string} id
 * @property {number} confidence  // 0–1
 * @property {string} reason      // short en reason (UI may ignore)
 * @property {Record<string, number>} [scores]
 */

const MIN_CONFIDENCE = 0.42;
const DEFAULT_LENS_IDS = [
  "general",
  "sanity",
  "fact-check",
  "opportunities",
  "engineering",
  "investing",
];

/**
 * @param {{
 *   selection?: string,
 *   pageTitle?: string,
 *   pageUrl?: string,
 *   profileText?: string,
 *   defaultLensId?: string,
 *   availableLensIds?: string[],
 * }} input
 * @returns {LensSuggestion}
 */
export function suggestLens(input = {}) {
  const selection = String(input.selection || "");
  const title = String(input.pageTitle || "");
  const url = String(input.pageUrl || "");
  const profile = String(input.profileText || "");
  const text = `${selection}\n${title}`;
  const allowed = new Set(
    (input.availableLensIds?.length ? input.availableLensIds : DEFAULT_LENS_IDS).filter(
      Boolean
    )
  );

  /** @type {Record<string, number>} */
  const scores = {
    general: 0.15,
    engineering: 0,
    investing: 0,
    opportunities: 0,
    sanity: 0,
    "fact-check": 0,
  };

  // ── Engineering ─────────────────────────────────────────
  // Require code-like tokens (not bare punctuation like ";")
  if (
    /\bfunction\b|\bconst\b|\bclass\b|=>|```|\bnpm\b|\bgit\b|\bAPI\b|\bHTTP\b|\blatency\b|\bthroughput\b|\bcache\b|\bRedis\b|\bMemcached\b|\bKubernetes\b|\bDocker\b|\bSQL\b|\bschema\b|\bdeploy\b|\bmicroservice\b|\bconcurrency\b|\bthread\b|\bmutex\b|\bOAuth\b|\bgRPC\b|\bprotobuf\b|[{}()=<>]{2,}/i.test(
      text
    )
  ) {
    scores.engineering += 0.55;
  }
  if (
    /\barchitecture\b|\bimplementation\b|trade-?off|\brefactor\b|\bbug\b|stack trace|TypeError|null pointer|segfault|CI\/CD|pull request|\.tsx?\b|\.py\b|\.go\b|\.rs\b/i.test(
      text
    )
  ) {
    scores.engineering += 0.25;
  }
  if (/github\.com|gitlab\.com|stackoverflow\.com|npmjs\.com/i.test(url)) {
    scores.engineering += 0.2;
  }

  // ── Investing ───────────────────────────────────────────
  if (
    /\b(valuation|EBITDA|ARR|MRR|margin|revenue|EPS|P\/E|market cap|TAM|SAM|SOM|unit economics|gross margin|burn rate|runway|IPO|SPAC|equity|dilution|cap table)\b/i.test(
      text
    )
  ) {
    scores.investing += 0.55;
  }
  if (
    /股票|估值|营收|利润|市值|融资|轮次|护城河|竞争格局|财报|毛利率|现金流/i.test(text)
  ) {
    scores.investing += 0.45;
  }
  if (/bloomberg\.com|ft\.com|wsj\.com|sec\.gov|seekingalpha/i.test(url)) {
    scores.investing += 0.2;
  }

  // ── Opportunities ───────────────────────────────────────
  if (
    /\b(arbitrage|mispricing|incentive|monetiz|asymmetry|alpha|edge|undervalued|early adopter)\b/i.test(
      text
    )
  ) {
    scores.opportunities += 0.55;
  }
  if (/套利|错价|激励|变现|信息不对称|早期红利|机会|未定价/i.test(text)) {
    scores.opportunities += 0.45;
  }
  // softer business opportunity language
  if (/\b(opportunity|white space|wedge|distribution|go-to-market|GTM)\b/i.test(text)) {
    scores.opportunities += 0.2;
  }

  // ── Fact-check / Sanity ─────────────────────────────────
  const claimy =
    /\b(always|never|guarantees?|proven|will definitely|must be|everyone knows)\b|一定|必须|保证|绝对|毫无疑问|史上最/i.test(
      text
    );
  const numericClaims =
    (text.match(/\d+(\.\d+)?%|\$[\d,]+|\d{4}年|\d+\s*(million|billion|万|亿)/gi) || [])
      .length >= 2;
  if (claimy) {
    scores.sanity += 0.35;
    scores["fact-check"] += 0.25;
  }
  if (numericClaims) {
    scores["fact-check"] += 0.4;
    scores.sanity += 0.15;
  }
  if (
    /\b(according to|study shows|research finds|sources? say|cited)\b|据报道|研究表明|数据显示/i.test(
      text
    )
  ) {
    scores["fact-check"] += 0.35;
  }
  if (/谣言|辟谣|真的假的|靠谱吗|有没有道理/i.test(text)) {
    scores.sanity += 0.45;
  }

  // ── Profile bias (L1) ───────────────────────────────────
  const p = profile.toLowerCase();
  if (p) {
    if (/engineer|developer|sre|devops|backend|frontend|infra|软件|工程|开发|架构/.test(p)) {
      scores.engineering += 0.18;
    }
    if (/invest|vc|pe|trader|fund|投资|一级|二级|基金/.test(p)) {
      scores.investing += 0.18;
    }
    if (/founder|operator|growth|arbitrage|创业|增长|套利/.test(p)) {
      scores.opportunities += 0.15;
    }
    if (/journalist|researcher|记者|研究/.test(p)) {
      scores["fact-check"] += 0.12;
      scores.sanity += 0.08;
    }
  }

  // Slight sticky bias toward user's fixed default (not Auto)
  const def = input.defaultLensId || "general";
  if (def !== "auto" && scores[def] != null) {
    scores[def] += 0.08;
  }

  // Drop unavailable
  for (const id of Object.keys(scores)) {
    if (!allowed.has(id)) delete scores[id];
  }
  if (!allowed.has("general")) {
    // always need a fallback — use first available
    const first = [...allowed][0] || "general";
    return {
      id: first,
      confidence: 0.3,
      reason: "fallback",
      scores,
    };
  }
  if (scores.general == null) scores.general = 0.15;

  let bestId = "general";
  let bestScore = scores.general ?? 0;
  for (const [id, s] of Object.entries(scores)) {
    if (s > bestScore) {
      bestScore = s;
      bestId = id;
    }
  }

  // Confidence: absolute signal strength + margin over runner-up
  const sorted = Object.values(scores).sort((a, b) => b - a);
  const margin = (sorted[0] || 0) - (sorted[1] || 0);
  let confidence = Math.min(
    0.95,
    Math.max(0, bestScore * 0.7 + margin * 0.25 + (bestScore >= 0.5 ? 0.1 : 0))
  );

  if (bestId !== "general" && confidence < MIN_CONFIDENCE) {
    return {
      id: "general",
      confidence,
      reason: "low_confidence_fallback",
      scores,
    };
  }

  return {
    id: bestId,
    confidence,
    reason: reasonFor(bestId),
    scores,
  };
}

/** @param {string} id */
function reasonFor(id) {
  const map = {
    engineering: "code_or_systems_language",
    investing: "business_or_market_language",
    opportunities: "arbitrage_or_incentive_language",
    sanity: "strong_claims_or_rhetoric",
    "fact-check": "numeric_or_attributable_claims",
    general: "default_plain_explain",
  };
  return map[id] || "default";
}

/**
 * Resolve which lens id to use for an explain request.
 * @param {{
 *   lensMode?: 'auto' | 'manual',
 *   manualLensId?: string,
 *   defaultLensId?: string,
 *   selection?: string,
 *   pageTitle?: string,
 *   pageUrl?: string,
 *   profileText?: string,
 *   availableLensIds?: string[],
 * }} opts
 * @returns {{ lensId: string, source: 'manual' | 'auto' | 'default', suggestion?: LensSuggestion }}
 */
export function resolveActiveLens(opts = {}) {
  const mode = opts.lensMode === "manual" ? "manual" : "auto";
  const available =
    opts.availableLensIds?.length > 0 ? opts.availableLensIds : DEFAULT_LENS_IDS;

  if (mode === "manual") {
    const id =
      opts.manualLensId && available.includes(opts.manualLensId)
        ? opts.manualLensId
        : opts.defaultLensId && available.includes(opts.defaultLensId)
          ? opts.defaultLensId
          : "general";
    return { lensId: id, source: "manual" };
  }

  // Auto mode: if user pinned an explicit lens in the bubble this session, honor it
  if (opts.manualLensId && opts.manualLensId !== "auto" && available.includes(opts.manualLensId)) {
    return { lensId: opts.manualLensId, source: "manual" };
  }

  const suggestion = suggestLens({
    selection: opts.selection,
    pageTitle: opts.pageTitle,
    pageUrl: opts.pageUrl,
    profileText: opts.profileText,
    defaultLensId: opts.defaultLensId,
    availableLensIds: available,
  });

  const id = available.includes(suggestion.id) ? suggestion.id : "general";
  return {
    lensId: id,
    source: id === "general" && suggestion.reason === "low_confidence_fallback" ? "default" : "auto",
    suggestion,
  };
}
