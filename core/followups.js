/**
 * Predicted follow-up actions + memory capture helpers (Issue #6).
 *
 * Follow-ups are a mix of:
 * 1) Model-suggested chips (when the runtime returns them)
 * 2) Content-aware heuristics from selection + explanation
 * 3) Stable structural actions (discuss / remember / more…)
 */

/**
 * @typedef {Object} FollowUpAction
 * @property {string} id
 * @property {string} label
 * @property {string} intent  // more | why | verify | remember | opportunities | simplify | research | summarize | discuss | probe
 * @property {string} [question]  // for intent=probe: free-form follow-up question
 *
 * @typedef {Object} MemorySuggestion
 * @property {string} content
 * @property {'interest' | 'preference' | 'knowledge' | 'goal' | 'note'} type
 * @property {string} [reason]
 */

const FOLLOWUPS_BLOCK_RE =
  /(?:^|\n)\s*(?:<<<\s*WDIMTM_FOLLOWUPS\s*>>>|<!--\s*wdimtm-followups\s*-->)\s*([\s\S]*?)\s*(?:<<<\s*END\s*>>>|<!--\s*\/wdimtm-followups\s*-->)\s*/gi;

const MEMORY_BLOCK_RE =
  /(?:^|\n)\s*(?:<<<\s*WDIMTM_MEMORY\s*>>>|<!--\s*wdimtm-memory\s*-->)\s*([\s\S]*?)\s*(?:<<<\s*END\s*>>>|<!--\s*\/wdimtm-memory\s*-->)\s*/gi;

const WHY_BLOCK_RE =
  /(?:^|\n)\s*(?:<<<\s*WDIMTM_WHY\s*>>>|<!--\s*wdimtm-why\s*-->)\s*([\s\S]*?)\s*(?:<<<\s*END\s*>>>|<!--\s*\/wdimtm-why\s*-->)\s*/gi;

/**
 * Normalize legacy string[] follow-ups into structured actions.
 * @param {unknown} raw
 * @returns {FollowUpAction[]}
 */
export function normalizeFollowUps(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw
    .map((item, i) => {
      if (typeof item === "string") {
        return fromLabel(item, i);
      }
      if (item && typeof item === "object") {
        const label = String(item.label || item.id || item.question || "").trim();
        if (!label) return null;
        const intent = String(item.intent || intentFromLabel(label));
        const id = String(item.id || `fu-${i}`);
        /** @type {FollowUpAction} */
        const out = { id, label, intent };
        if (item.question) out.question = String(item.question);
        else if (intent === "probe") out.question = label;
        return out;
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 3); // predicted chips: max 3
}

/**
 * @param {string} text
 * @returns {{ explanation: string, followUps: FollowUpAction[] }}
 */
export function extractFollowUpsTrailer(text) {
  const full = extractResponseTrailers(text);
  return { explanation: full.explanation, followUps: full.followUps };
}

/**
 * Strip model trailers (follow-ups, optional memory, optional why) from the raw completion.
 * @param {string} text
 * @returns {{
 *   explanation: string,
 *   followUps: FollowUpAction[],
 *   memorySuggestion: MemorySuggestion | null,
 *   whyItMatters?: string,
 * }}
 */
export function extractResponseTrailers(text) {
  let raw = String(text || "");
  /** @type {FollowUpAction[]} */
  let followUps = [];
  /** @type {MemorySuggestion | null} */
  let memorySuggestion = null;
  /** @type {string | undefined} */
  let whyItMatters;

  // Extract MEMORY
  MEMORY_BLOCK_RE.lastIndex = 0;
  const memMatch = [...raw.matchAll(MEMORY_BLOCK_RE)].pop();
  if (memMatch) {
    memorySuggestion = parseMemorySuggestion(memMatch[1] || "");
    raw = raw.replace(memMatch[0], "\n");
  }

  // Extract WHY (optional explicit block)
  WHY_BLOCK_RE.lastIndex = 0;
  const whyMatch = [...raw.matchAll(WHY_BLOCK_RE)].pop();
  if (whyMatch) {
    whyItMatters = String(whyMatch[1] || "").trim() || undefined;
    raw = raw.replace(whyMatch[0], "\n");
  }

  // Extract FOLLOWUPS
  FOLLOWUPS_BLOCK_RE.lastIndex = 0;
  const fuMatch = [...raw.matchAll(FOLLOWUPS_BLOCK_RE)].pop();
  if (fuMatch) {
    const body = (fuMatch[1] || "").trim();
    if (body.startsWith("[") || body.startsWith("{")) {
      try {
        const parsed = JSON.parse(body.startsWith("{") ? `[${body}]` : body);
        followUps = normalizeFollowUps(parsed);
      } catch {
        followUps = parseLineFollowUps(body);
      }
    } else {
      followUps = parseLineFollowUps(body);
    }
    raw = raw.replace(fuMatch[0], "\n");
  }

  // Safety: strip any leftover trailer markers that streamed incomplete
  raw = raw
    .replace(/(?:^|\n)\s*<<<\s*WDIMTM_(?:FOLLOWUPS|MEMORY|WHY)\s*>>>[\s\S]*$/i, "")
    .trim();

  return {
    explanation: raw,
    followUps: followUps.slice(0, 3),
    memorySuggestion,
    whyItMatters,
  };
}

/**
 * @param {string} body
 * @returns {MemorySuggestion | null}
 */
function parseMemorySuggestion(body) {
  const t = String(body || "").trim();
  if (!t) return null;
  try {
    const json = JSON.parse(t);
    const content = String(json.content || json.text || "").trim();
    if (!content || content.length < 8) return null;
    // Reject dumps of the full explanation
    if (content.length > 280) return null;
    const type = String(json.type || "interest");
    const allowed = new Set(["interest", "preference", "knowledge", "goal", "note"]);
    if (!allowed.has(type)) return null;
    return {
      type: /** @type {any} */ (type),
      content,
      reason: json.reason ? String(json.reason).slice(0, 200) : undefined,
    };
  } catch {
    // plain text line
    if (t.length >= 8 && t.length <= 280) {
      return { type: "interest", content: t };
    }
    return null;
  }
}

/**
 * @param {string} body
 * @returns {FollowUpAction[]}
 */
function parseLineFollowUps(body) {
  const lines = body
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);
  return normalizeFollowUps(
    lines.map((line, i) => {
      const pipe = line.split("|").map((s) => s.trim()).filter(Boolean);
      if (pipe.length >= 2) {
        const label = pipe[0];
        const tag = pipe[1].toLowerCase();
        const known = [
          "more",
          "why",
          "verify",
          "remember",
          "discuss",
          "summarize",
          "simplify",
          "opportunities",
          "research",
          "probe",
          "ask",
        ];
        const intent = known.includes(tag)
          ? tag === "ask"
            ? "probe"
            : tag
          : intentFromLabel(label);
        return {
          id: `llm-${i}`,
          label,
          intent,
          question: intent === "probe" ? label : undefined,
        };
      }
      // Free-form model suggestion → content-specific probe
      return { id: `llm-${i}`, label: line, intent: "probe", question: line };
    })
  );
}

/**
 * Mode-stable structural defaults (always available as fallback).
 * @param {string} mode
 * @param {{ zh?: boolean }} [opts]
 * @returns {FollowUpAction[]}
 */
export function defaultFollowUps(mode = "explain", opts = {}) {
  const zh = Boolean(opts.zh);
  const discuss = action(
    "discuss",
    zh ? "深入对话" : "Discuss further",
    "discuss"
  );
  if (mode === "verify") {
    return [
      action("more", zh ? "展开说明" : "Explain more", "more"),
      discuss,
      action("remember", zh ? "记住这个" : "Remember this", "remember"),
    ];
  }
  if (mode === "why" || mode === "why_it_matters") {
    return [
      action("more", zh ? "展开说明" : "Explain more", "more"),
      action("verify", zh ? "核实主张" : "Verify", "verify"),
      discuss,
      action("remember", zh ? "记住这个" : "Remember this", "remember"),
    ];
  }
  if (mode === "opportunity" || mode === "research") {
    return [
      action("more", zh ? "展开说明" : "Explain more", "more"),
      action("verify", zh ? "核实主张" : "Verify", "verify"),
      discuss,
      action("remember", zh ? "记住这个" : "Remember this", "remember"),
    ];
  }
  if (mode === "more" || mode === "probe") {
    return [
      discuss,
      action("why", zh ? "为什么重要" : "Why it matters", "why"),
      action("verify", zh ? "核实主张" : "Verify", "verify"),
      action("simplify", zh ? "讲简单点" : "Explain simpler", "simplify"),
    ];
  }
  if (mode === "summarize" || mode === "summarize-page") {
    return [
      action("more", zh ? "展开说明" : "Explain more", "more"),
      discuss,
      action("remember", zh ? "记住这个" : "Remember this", "remember"),
    ];
  }
  return [
    action("more", zh ? "展开说明" : "Explain more", "more"),
    action("summarize", zh ? "总结选区" : "Summarize", "summarize"),
    discuss,
    action("remember", zh ? "记住这个" : "Remember this", "remember"),
  ];
}

/**
 * Content-aware follow-up chips from selection + explanation + lens.
 * @param {{
 *   selection?: string,
 *   explanation?: string,
 *   mode?: string,
 *   zh?: boolean,
 *   lensId?: string,
 * }} ctx
 * @returns {FollowUpAction[]}
 */
export function suggestContentFollowUps(ctx = {}) {
  const selection = String(ctx.selection || "").trim();
  const explanation = String(ctx.explanation || "").trim();
  const zh = Boolean(ctx.zh) || /[\u4e00-\u9fff]/.test(selection + explanation);
  const lensId = ctx.lensId || "general";
  const blob = `${selection}\n${explanation}`;
  /** @type {FollowUpAction[]} */
  const out = [];
  const add = (id, label, intent, question) => {
    if (out.some((f) => f.label === label || f.id === id)) return;
    /** @type {FollowUpAction} */
    const a = { id, label, intent };
    if (question || intent === "probe") a.question = question || label;
    out.push(a);
  };

  // Named terms / acronyms → "What is X?"
  const terms = extractSalientTerms(selection, zh).slice(0, 2);
  for (const term of terms) {
    add(
      `term-${term.toLowerCase()}`,
      zh ? `「${term}」是什么？` : `What is ${term}?`,
      "probe",
      zh ? `用通俗语言解释「${term}」是什么，以及它在这段上下文里的角色。` : `Explain what “${term}” is and its role in this context.`
    );
  }

  // Comparisons
  if (/\bvs\.?\b|versus|compared to|alternative|替代|对比|比起|与.+不同|而不/i.test(blob)) {
    add(
      "compare",
      zh ? "和替代方案比呢？" : "How do alternatives compare?",
      "probe",
      zh
        ? "对比文中涉及的方案/技术与常见替代，列出关键取舍。"
        : "Compare the approaches mentioned with common alternatives and list key trade-offs."
    );
  }

  // Numbers / metrics
  if (/\d+(\.\d+)?%|\$\d|\d+\s*(ms|s|x|倍|万|亿)|latency|throughput|QPS|RPS/i.test(blob)) {
    add(
      "numbers",
      zh ? "这些数字意味着什么？" : "What do these numbers mean?",
      "probe",
      zh
        ? "解释文中数字/指标的含义、数量级与对读者的实际影响。"
        : "Explain what the numbers/metrics mean, their order of magnitude, and practical impact."
    );
  }

  // Claims / advice
  if (
    /\b(should|must|always|never|best|guarantee|will)\b|一定|必须|应该|最好|保证|绝对/i.test(
      blob
    )
  ) {
    add(
      "verify-claim",
      zh ? "这个主张靠谱吗？" : "Is this claim solid?",
      "verify"
    );
  }

  // Causal / mechanism language
  if (
    /\bbecause\b|\btherefore\b|\bleads? to\b|原因|因此|导致|机制|原理|为什么/i.test(blob) ||
    lensId === "sanity"
  ) {
    add(
      "mechanism",
      zh ? "底层机制是什么？" : "What's the mechanism?",
      "probe",
      zh
        ? "讲清底层机制：因果链、关键假设与可能失效的条件。"
        : "Explain the underlying mechanism: causal chain, key assumptions, and failure modes."
    );
  }

  // Engineering lens
  if (lensId === "engineering" || /cache|redis|latency|scale|架构|缓存|性能|部署/i.test(blob)) {
    add(
      "tradeoffs",
      zh ? "实现上要注意什么？" : "Implementation trade-offs?",
      "probe",
      zh
        ? "从工程实现角度说明取舍、坑点与适用边界。"
        : "From an engineering view: trade-offs, pitfalls, and when this does/doesn't apply."
    );
  }

  // Opportunities lens
  if (lensId === "opportunities" || /套利|arbitrage|激励|incentive|变现|pricing/i.test(blob)) {
    add(
      "opp",
      zh ? "有什么可验证的机会？" : "Any testable opportunities?",
      "opportunities"
    );
  }

  // Investing
  if (lensId === "investing" || /估值|margin|revenue|市场|竞争|护城河/i.test(blob)) {
    add(
      "risk",
      zh ? "主要风险是什么？" : "What are the main risks?",
      "probe",
      zh
        ? "列出主要商业/市场风险，以及如何证伪。"
        : "List the main business/market risks and how one might falsify the bull case."
    );
  }

  // Long selection → simplify
  if (selection.length > 280 || explanation.length > 900) {
    add("simplify", zh ? "讲简单点" : "Explain simpler", "simplify");
  }

  // Concrete example if abstract
  if (
    /theory|abstract|concept|原则|抽象|范式|framework|model of/i.test(blob) &&
    !/例如|example|for instance|e\.g\./i.test(blob)
  ) {
    add(
      "example",
      zh ? "举个具体例子" : "Give a concrete example",
      "probe",
      zh
        ? "用一个具体、可想象的例子说明这段在说什么。"
        : "Give a concrete, easy-to-picture example of what this is saying."
    );
  }

  return out.slice(0, 4);
}

/**
 * Merge model + content + structural defaults into a short chip list.
 * @param {unknown} modelFollowUps
 * @param {{
 *   selection?: string,
 *   explanation?: string,
 *   mode?: string,
 *   zh?: boolean,
 *   lensId?: string,
 * }} ctx
 * @returns {FollowUpAction[]}
 */
export function buildFollowUps(modelFollowUps, ctx = {}) {
  const mode = ctx.mode || "explain";
  const zh = Boolean(ctx.zh);
  const fromModel = normalizeFollowUps(modelFollowUps);
  const fromContent = suggestContentFollowUps(ctx);
  const structural = defaultFollowUps(mode, { zh });

  /** Prefer: model probes → content probes → structural; always keep discuss/remember. */
  /** @type {FollowUpAction[]} */
  const specific = [];
  /** @type {FollowUpAction[]} */
  const generic = [];
  const seenLabel = new Set();
  const seenIntentOnce = new Set();

  const push = (bucket, f, { uniqueIntent = false } = {}) => {
    if (!f?.label) return;
    const key = f.label.toLowerCase().replace(/\s+/g, " ");
    if (seenLabel.has(key)) return;
    if (uniqueIntent && seenIntentOnce.has(f.intent)) return;
    seenLabel.add(key);
    if (uniqueIntent) seenIntentOnce.add(f.intent);
    bucket.push(f);
  };

  for (const f of fromModel) {
    push(specific, f, { uniqueIntent: f.intent !== "probe" });
  }
  for (const f of fromContent) {
    push(specific, f, { uniqueIntent: f.intent !== "probe" });
  }

  const discuss = structural.find((f) => f.intent === "discuss");
  const remember = structural.find((f) => f.intent === "remember");
  for (const f of structural) {
    if (f.intent === "discuss" || f.intent === "remember") continue;
    push(generic, f, { uniqueIntent: true });
  }

  // Predicted chips max 3; optionally keep discuss/remember as structural.
  const reserved = (discuss ? 1 : 0) + (remember ? 1 : 0);
  const roomForSpecific = Math.min(3, Math.max(1, 5 - reserved));
  const head = specific.slice(0, roomForSpecific);
  /** @type {FollowUpAction[]} */
  const merged = [...head];
  // At most one generic mode chip if we have fewer than 2 predicted
  if (merged.length < 2) {
    for (const f of generic) {
      if (merged.length >= 3) break;
      if (seenLabel.has(f.label.toLowerCase().replace(/\s+/g, " "))) continue;
      merged.push(f);
    }
  }
  if (discuss && !merged.some((f) => f.intent === "discuss") && merged.length < 5) {
    merged.push(discuss);
  }
  if (remember && !merged.some((f) => f.intent === "remember") && merged.length < 5) {
    merged.push(remember);
  }

  return merged.slice(0, 5);
}

/**
 * Heuristic memory suggestion (explicit capture only — never auto-save).
 * @param {{ selection: string, page?: { title?: string }, lens?: { id?: string }, mode?: string }} request
 * @param {{ explanation?: string }} [response]
 * @returns {MemorySuggestion | null}
 */
export function suggestMemory(request, response = {}) {
  const selection = (request.selection || "").trim();
  if (selection.length < 12) return null;
  const mode = String(request.mode || "explain");
  // Only suggest on first-pass / relevance modes — never after every probe.
  if (!["explain", "why", "why_it_matters", "opportunity"].includes(mode)) {
    return null;
  }

  const zh = /[\u4e00-\u9fff]/.test(selection);
  const text = `${selection}\n${request.page?.title || ""}\n${response.explanation || ""}`;

  if (/套利|arbitrage|mispricing|incentive|激励|错价/i.test(text)) {
    return {
      type: "interest",
      content: zh
        ? "我关心套利、定价偏差与激励结构"
        : "I care about arbitrage, pricing inefficiencies, and incentive structures",
      reason: zh ? "本次选区/解释多次触及套利与激励" : "Selection/answer touched arbitrage or incentives",
    };
  }
  if (/光刻|ASML|半导体|芯片|供应链/i.test(text)) {
    return {
      type: "interest",
      content: zh
        ? "我在跟踪半导体/光刻供应链与关键部件"
        : "I track semiconductor / lithography supply-chain and critical components",
      reason: zh ? "选区讨论精密制造与供应链" : "Selection discusses precision manufacturing supply chain",
    };
  }
  if (/流量|爆款|创作者|多巴胺|点赞/i.test(text)) {
    return {
      type: "interest",
      content: zh
        ? "我关心创作者经济与平台反馈回路"
        : "I care about creator economy and platform feedback loops",
      reason: zh ? "选区讨论平台激励与流量机制" : "Selection discusses platform incentives / traffic",
    };
  }
  if (
    (request.lens?.id === "opportunities" || mode === "opportunity") &&
    selection.length > 40
  ) {
    return {
      type: "preference",
      content: zh
        ? "解释内容时优先标出可验证的机会假说，并分开事实与推测"
        : "When explaining, prefer labeling opportunity hypotheses and separating facts from speculation",
      reason: zh ? "当前使用找机会镜头/模式" : "Active Opportunities lens/mode",
    };
  }
  return null;
}

/**
 * @param {import('../lib/types.js').ExplainResponse} res
 * @param {string} [mode]
 * @param {boolean} [zh]
 * @param {{ selection?: string, lensId?: string }} [ctx]
 */
export function enrichResponse(res, mode = "explain", zh = false, ctx = {}) {
  const extracted = extractResponseTrailers(res.explanation || "");
  const explanation = extracted.explanation || res.explanation;
  const modelFollowUps =
    extracted.followUps.length > 0
      ? extracted.followUps
      : res.followUps?.length
        ? res.followUps
        : [];

  const followUps = buildFollowUps(modelFollowUps, {
    selection: ctx.selection,
    explanation,
    mode,
    zh,
    lensId: ctx.lensId,
  });

  const finalFollowUps =
    followUps.length > 0 ? followUps : defaultFollowUps(mode, { zh });

  const memorySuggestion =
    res.memorySuggestion || extracted.memorySuggestion || null;

  return {
    ...res,
    explanation,
    whyItMatters: res.whyItMatters || extracted.whyItMatters,
    followUps: finalFollowUps,
    memorySuggestion,
  };
}

/**
 * Pull salient multi-word / acronym terms from selection for "What is X?" chips.
 * @param {string} selection
 * @param {boolean} zh
 * @returns {string[]}
 */
function extractSalientTerms(selection, zh) {
  const text = String(selection || "");
  /** @type {string[]} */
  const terms = [];

  // Acronyms / product-like tokens: Redis, Memcached, CAP, ASML, gRPC…
  const latin = text.match(
    /\b(?:[A-Z]{2,}[a-z0-9+.-]*|[A-Z][a-z]+(?:[A-Z][a-z0-9+]*)+|[A-Za-z][\w.+-]{2,})\b/g
  );
  if (latin) {
    const stop = new Set([
      "The",
      "This",
      "That",
      "With",
      "From",
      "When",
      "What",
      "Which",
      "While",
      "About",
      "After",
      "Before",
      "However",
      "Therefore",
      "Because",
      "Using",
      "Used",
      "Often",
      "Also",
      "Into",
      "Over",
      "Under",
      "Single",
      "Multiple",
      "Typical",
      "Does",
      "Not",
      "And",
      "For",
      "Are",
      "Can",
      "May",
      "Will",
      "Have",
      "Has",
      "Been",
      "Being",
      "Their",
      "There",
      "These",
      "Those",
      "Such",
      "Like",
      "Just",
      "Only",
      "Even",
      "More",
      "Most",
      "Some",
      "Any",
      "All",
      "One",
      "Two",
      "New",
      "Key",
      "Node",
      "Data",
      "Cache",
      "Server",
      "Client",
      "Request",
      "Response",
      "System",
      "Page",
      "User",
    ]);
    for (const t of latin) {
      if (stop.has(t)) continue;
      if (t.length < 3) continue;
      // Prefer Capitalized / ACRONYM; drop plain lowercase common words
      if (/^[a-z]+$/.test(t)) continue;
      if (!terms.includes(t)) terms.push(t);
      if (terms.length >= 3) break;
    }
  }

  if (zh) {
    // Short CJK tech-ish compounds (2–6 chars) near keywords
    const cjk = text.match(/[\u4e00-\u9fff]{2,6}/g) || [];
    const prefer =
      /缓存|负载|分片|架构|协议|模型|算法|套利|激励|估值|供应链|光刻|平台|流量/;
    for (const t of cjk) {
      if (prefer.test(t) && !terms.includes(t)) terms.push(t);
      if (terms.length >= 3) break;
    }
  }

  return terms.slice(0, 2);
}

function action(id, label, intent) {
  return { id, label, intent };
}

function fromLabel(label, i) {
  const intent = intentFromLabel(label);
  /** @type {FollowUpAction} */
  const a = { id: `fu-${i}`, label, intent };
  if (intent === "probe") a.question = label;
  return a;
}

function intentFromLabel(label) {
  const l = String(label).toLowerCase();
  if (l.includes("remember") || l.includes("记住")) return "remember";
  if (l.includes("discuss") || l.includes("对话") || l.includes("chat") || l.includes("深入"))
    return "discuss";
  if (l.includes("summar") || l.includes("总结") || l.includes("摘要")) return "summarize";
  if (l.includes("verify") || l.includes("核实") || l.includes("核验") || l.includes("靠谱"))
    return "verify";
  if (l.includes("why") || l.includes("重要") || l.includes("matter")) return "why";
  if (l.includes("simpl") || l.includes("简单")) return "simplify";
  if (l.includes("opportunit") || l.includes("机会") || l.includes("arbitrage"))
    return "opportunities";
  if (l.includes("research") || l.includes("研究")) return "research";
  if (l.includes("more") || l.includes("展开") || l.includes("更深")) return "more";
  // Question-like free form → probe
  if (
    l.includes("?") ||
    l.includes("？") ||
    /^(what|how|why|when|where|who|is |are |can |does |do )/i.test(l) ||
    /^(什么|怎么|为何|如何|哪些|有没有|能否)/.test(l)
  ) {
    return "probe";
  }
  return "probe";
}
