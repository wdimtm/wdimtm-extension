/**
 * Deterministic mock runtime for offline development + E2E.
 * Supports modes: explain | more | why | verify and optional streaming via onChunk.
 * Replies in Chinese when the selection is primarily CJK.
 */

/**
 * @param {import('../lib/types.js').ExplainRequest & { mode?: string }} request
 * @param {{ onChunk?: (text: string) => void }} [opts]
 * @returns {Promise<import('../lib/types.js').ExplainResponse>}
 */
export async function explainWithMock(request, opts = {}) {
  await sleep(200 + Math.random() * 150);

  const selection = request.selection.trim();
  const title = request.page?.title || "this page";
  const lensId = request.lens?.id || "general";
  const mode = request.mode || "explain";
  const zh =
    opts.forceZh === true ||
    request.answerLanguage === "zh_CN" ||
    (opts.forceZh !== false && isMostlyCjk(selection));
  const units = countUnits(selection);
  const unitLabel = zh ? "字" : "words";
  const short =
    selection.length > 160 ? selection.slice(0, 157).trimEnd() + "…" : selection;

  const memLine = zh
    ? request.memories?.length
      ? `_已附带 ${request.memories.length} 条记忆（${request.memories.map((m) => m.type).join(", ")}）。_`
      : `_未附带记忆。_`
    : request.memories?.length
      ? `_Using ${request.memories.length} memory item(s): ${request.memories
          .map((m) => m.type)
          .join(", ")}_`
      : `_No memories attached._`;

  const lensHint = zh
    ? {
        general: "用通俗语言",
        sanity: "判断主张是否站得住脚（逻辑、可信度、缺环）",
        opportunities: "从套利、激励、错价与变现角度（推测性）",
        engineering: "从架构、实现与取舍角度",
        investing: "从商业、市场、风险与估值相关信息角度",
        "fact-check": "并标出需要核验的主张",
      }[lensId] || `通过「${lensId}」镜头`
    : {
        general: "in plain language",
        sanity: "for whether the claims are reasonable (logic, plausibility, gaps)",
        opportunities:
          "with an eye for arbitrage, incentives, mispricing, and monetization (speculative)",
        engineering: "with architecture, implementation, and trade-offs",
        investing: "with business, market, risk, and valuation angles",
        "fact-check": "flagging claims that need verification",
      }[lensId] || `through the “${lensId}” lens`;

  /** @type {string} */
  let explanation;

  if (mode === "summarize" || mode === "summarize-page") {
    const pageNote =
      mode === "summarize-page"
        ? zh
          ? "（本页有界上下文摘要）"
          : "(bounded page summary)"
        : zh
          ? "（选区摘要）"
          : "(selection summary)";
    explanation = zh
      ? [
          `**摘要**${pageNote}`,
          "",
          `来源：${title}`,
          "",
          short.length < 40
            ? short
            : `要点：${short.slice(0, 120)}${short.length > 120 ? "…" : ""}`,
          "",
          "1. **在说什么** — 用一句话复述核心主张。",
          "2. **关键细节** — 数字、主体、条件（若有）。",
          "3. **待核实** — 仍不确定或需外部证据的部分。",
          "",
          memLine,
          "",
          "_(Mock 运行时 — 摘要模式。)_",
        ].join("\n")
      : [
          `**Summary** ${pageNote}`,
          "",
          `Source: ${title}`,
          "",
          short.length < 40
            ? short
            : `Core: ${short.slice(0, 120)}${short.length > 120 ? "…" : ""}`,
          "",
          "1. **Claim** — one-line restatement.",
          "2. **Key details** — numbers, actors, conditions if any.",
          "3. **Open checks** — what still needs verification.",
          "",
          memLine,
          "",
          "_(Mock runtime — summarize mode.)_",
        ].join("\n");
  } else if (mode === "more" || mode === "simplify") {
    explanation = zh
      ? [
          `**展开说明**：「${short}」`,
          "",
          `在 **${title}** 上，${lensHint}进一步拆：`,
          "",
          "1. **字面主张** — 作者在说什么（先复述，不背书）。",
          "2. **机制** — 什么结构/激励会让这句话成立。",
          "3. **失效条件** — 什么情况下这是话术或幸存者偏差。",
          "4. **下一步** — 一个值得马上核对的具体问题。",
          "",
          mockInsight(selection, lensId, zh),
          "",
          memLine,
          "",
          "_(Mock 运行时 — 展开模式。)_",
        ].join("\n")
      : [
          `**Deeper pass** on “${short}”`,
          "",
          `On **${title}**, expanding ${lensHint}:`,
          "",
          "1. **Literal claim** — restate what the author asserts without endorsing it.",
          "2. **Mechanism** — what process or market structure would make the claim true.",
          "3. **Failure modes** — what would make the claim misleading.",
          "4. **Next question** — one concrete thing worth checking next.",
          "",
          mockInsight(selection, lensId, zh),
          "",
          memLine,
          "",
          "_(Mock runtime — deeper mode.)_",
        ].join("\n");
  } else if (mode === "why" || mode === "why_it_matters") {
    explanation = zh
      ? [
          `**这和你有什么关系**`,
          "",
          `选区：「${short}」`,
          "",
          personalLine(request, zh),
          "",
          mockInsight(selection, lensId, zh),
          "",
          memLine,
          "",
          "_(Mock 运行时 — 相关性模式。)_",
        ].join("\n")
      : [
          `**Why it might matter to you**`,
          "",
          `Selection: “${short}”`,
          "",
          personalLine(request, zh),
          "",
          mockInsight(selection, lensId, zh),
          "",
          memLine,
          "",
          "_(Mock runtime — why-it-matters mode.)_",
        ].join("\n");
  } else if (mode === "opportunity" || mode === "research") {
    explanation = zh
      ? [
          mode === "opportunity" ? `**机会视角**` : `**研究提纲**`,
          "",
          `选区：「${short}」`,
          "",
          personalLine(request, zh),
          "",
          mockInsight(selection, lensId, zh),
          "",
          "事实 vs 假说请分开；Mock 不联网取数。",
          "",
          memLine,
          "",
          `_(Mock 运行时 — ${mode} 模式。)_`,
        ].join("\n")
      : [
          mode === "opportunity" ? `**Opportunity framing**` : `**Research outline**`,
          "",
          `Selection: “${short}”`,
          "",
          personalLine(request, zh),
          "",
          mockInsight(selection, lensId, zh),
          "",
          "Separate facts from hypotheses. Mock has no live data tools.",
          "",
          memLine,
          "",
          `_(Mock runtime — ${mode} mode.)_`,
        ].join("\n");
  } else if (mode === "verify") {
    const webBlock = request.webEvidence
      ? zh
        ? ["", "**网页检索摘要（WEB EVIDENCE）**", request.webEvidence.slice(0, 600)]
        : ["", "**WEB EVIDENCE (injected)**", request.webEvidence.slice(0, 600)]
      : zh
        ? ["", "未注入 WEB EVIDENCE（未配置 web search 或检索失败）。"]
        : ["", "No WEB EVIDENCE injected (web search off or failed)."];
    explanation = zh
      ? [
          `**核验视角**`,
          "",
          `来自 **${title}** 的「${short}」：`,
          "",
          claimBullets(selection, zh),
          ...webBlock,
          "",
          memLine,
          "",
          "_(Mock 运行时 — 核验模式。)_",
        ].join("\n")
      : [
          `**Verification pass**`,
          "",
          `From “${short}” on **${title}**:`,
          "",
          claimBullets(selection, zh),
          ...webBlock,
          "",
          memLine,
          "",
          "_(Mock runtime — verify mode.)_",
        ].join("\n");
  } else {
    explanation = zh
      ? [
          `**选区**（约 ${units} ${unitLabel}）：「${short}」`,
          "",
          `在 **${title}** 上，这段内容值得${lensHint}拆开看。`,
          "",
          personalLine(request, zh),
          "",
          mockInsight(selection, lensId, zh),
          "",
          request.page?.context
            ? `_已使用约 ${request.page.context.length} 字的周边上下文（有界截取，非整页 DOM）。_`
            : `_没有拿到周边上下文；仅基于选区。_`,
          "",
          memLine,
          "",
          "_(Mock 运行时 — 请在设置中配置 OpenAI-compatible API 以使用真实模型。)_",
        ].join("\n")
      : [
          `**Selection** (${units} ${unitLabel}): “${short}”`,
          "",
          `On **${title}**, this looks like content worth unpacking ${lensHint}.`,
          "",
          personalLine(request, zh),
          "",
          mockInsight(selection, lensId, zh),
          "",
          request.page?.context
            ? `_Context used: ~${request.page.context.length} chars of surrounding page text (bounded, not the full DOM)._`
            : `_No surrounding context was available; explanation is based on the selection alone._`,
          "",
          memLine,
          "",
          "_(Mock runtime — set an OpenAI-compatible API key in WDIMTM options for a real model.)_",
        ].join("\n");
  }

  if (opts.onChunk) {
    await streamText(explanation, opts.onChunk);
  }

  // followUps left empty — adapter attaches structured defaults + memorySuggestion.
  return {
    explanation,
    summary: short,
    followUps: [],
    runtime: "mock",
  };
}

// Support simplify mode lightly via more path when mode=simplify is passed through.
// (Handled by mode === "more" branch naming; map in content script.)

/**
 * Personalized vs general line — makes profile/memory influence mock output.
 * @param {{ profile?: string, memories?: Array<{ type: string, content: string }> }} request
 * @param {boolean} zh
 */
function personalLine(request, zh) {
  const profile = (request.profile || "").trim();
  const mems = Array.isArray(request.memories) ? request.memories : [];
  const profileFromMem = mems.find((m) => m.type === "profile")?.content || "";
  const p = profile || profileFromMem;
  const other = mems.filter((m) => m.type !== "profile");
  if (p || other.length) {
    const snippet = (p || other[0]?.content || "").replace(/\s+/g, " ").slice(0, 80);
    return zh
      ? `**对你而言**：结合 profile/记忆（如「${snippet}${snippet.length >= 80 ? "…" : ""}」），优先看它如何碰到你已在跟踪的主题——避免百科式复述。`
      : `**For you**: given your profile/memories (e.g. “${snippet}${snippet.length >= 80 ? "…" : ""}”), map this to what you already track — not an encyclopedia recap.`;
  }
  return zh
    ? "**对你而言**：尚未提供 profile/记忆时，默认问题是：在当前镜头下，它是否改变某个决策、技能投入或机会判断？"
    : "**For you**: without profile/memories yet — does this change a decision, skill investment, or opportunity call under the active lens?";
}

/** @param {string} text */
function isMostlyCjk(text) {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return cjk >= 4 && cjk >= letters;
}

/** @param {string} text */
function countUnits(text) {
  if (isMostlyCjk(text)) {
    // Count CJK chars + latin tokens roughly.
    const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const latin = text
      .replace(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g, " ")
      .split(/\s+/)
      .filter(Boolean).length;
    return cjk + latin;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * @param {string} selection
 * @param {string} lensId
 * @param {boolean} zh
 */
function mockInsight(selection, lensId, zh) {
  const looksNumeric = /\d/.test(selection);
  const looksCode = /[{}();=<>]|function|const |class |=>/.test(selection);

  if (zh) {
    if (lensId === "sanity") {
      if (/光刻|阿斯麦|ASML|电机|瓦尔德|纳米/.test(selection)) {
        return [
          "**站得住的部分**：高端光刻机供应链极深、关键子系统高度专精、整机集成壁垒很高——这是产业共识方向。",
          "**需警惕的跳跃**：「一台 3 亿美元」「自己也造不了直驱电机」「200 人小作坊卡脖子」等具体数字与因果，mock 无法核验；合理提问是：电机是性能瓶颈还是诸多瓶颈之一？供应商是否真唯一/不可替代？",
          "**读法**：把故事当**供应链隐喻**（精密工业靠隐形专精环节）可以；把每个数字当已证实事实则过猛。",
        ].join("\n");
      }
      return [
        "把内容拆成：**可接受的常识 / 听起来像内行但未证实的细节 / 明显修辞或因果跳跃**。",
        "对每一类问：缺什么证据会让判断翻转？Mock 不联网，真实模型应更硬地标不确定度。",
      ].join("\n");
    }
    if (lensId === "opportunities") {
      return looksNumeric
        ? "数字可能是**信号**（规模、费用、增长），但任何「机会」都应先当假说：把可观察事实和关于错价/先发优势的推断分开。"
        : "先问：这段话暴露了什么**激励结构或信息差**？什么证据会在 24–72 小时内证伪你的解读？";
    }
    if (lensId === "engineering") {
      return "映射到**系统边界**：输入/输出、所有权、失败模式，以及作者可能省略的取舍。";
    }
    if (lensId === "investing") {
      return "分清**主张 vs 证据**。商业质量、竞争格局、下行情景比修辞更重要。";
    }
    if (lensId === "fact-check") {
      return "拆出可核对的**离散主张**（数字、时间、归因）。Mock 不能联网；真实模型应标注不确定度。";
    }
    if (/多巴胺|点赞|转发|流量|爆款|激励|创作者|赌场/.test(selection)) {
      return "作者在讲**平台反馈回路**：即时社交奖励强化发布行为；「流量池像赌场」是在说结果分布极不均匀——既靠水平也靠运气与机制。这是机制描述，不是投资建议。";
    }
    return "真实模型会：界定陌生概念、复述作者主张，并用两三句说明在这个页面语境下为什么可能重要。";
  }

  if (lensId === "sanity") {
    return "Split into established background, plausible-but-unverified detail, and leaps. Ask what evidence would flip each judgment. Mock cannot fetch sources.";
  }
  if (lensId === "opportunities") {
    return looksNumeric
      ? "The numbers may encode a **signal**. Treat any opportunity read as a hypothesis."
      : "Ask what **incentive or information asymmetry** this content might expose — and what would falsify that read.";
  }
  if (lensId === "engineering") {
    return looksCode
      ? "This reads like implementation detail. Next: boundaries, failure modes, reuse vs rewrite."
      : "Map this to **system boundaries**: inputs, outputs, ownership, and trade-offs.";
  }
  if (lensId === "investing") {
    return "Focus on **what is claimed vs what is evidenced**.";
  }
  if (lensId === "fact-check") {
    return "Identify discrete **checkable claims**. Mock mode cannot fetch sources.";
  }
  return "A real model would define terms, restate the claim, and note why a reader on this page might care.";
}

/**
 * @param {string} selection
 * @param {boolean} zh
 */
function claimBullets(selection, zh) {
  const nums = selection.match(/\$?[\d,.]+%?|\d+\s*(hours|days|m|k|million|万|亿)?/gi) || [];
  if (zh) {
    const lines = ["- **主张面**：整段话在对世界/平台机制下断言。"];
    if (nums.length) {
      lines.push(`- **数量词**：${nums.slice(0, 4).join("、")} — 需对照一手数据。`);
    } else {
      lines.push("- **未见清晰数量主张**；核验应聚焦定义与归因。");
    }
    lines.push("- **状态**：mock 模式下未核验。");
    return lines.join("\n");
  }
  const lines = [
    "- **Claim surface**: the selection as a whole asserts something about the world.",
  ];
  if (nums.length) {
    lines.push(`- **Quantitative tokens**: ${nums.slice(0, 4).join(", ")}.`);
  } else {
    lines.push("- **No clear numeric claim** detected.");
  }
  lines.push("- **Status**: unverified in mock mode.");
  return lines.join("\n");
}

/**
 * @param {string} text
 * @param {(t: string) => void} onChunk
 */
async function streamText(text, onChunk) {
  const chunkSize = 48;
  for (let i = 0; i < text.length; i += chunkSize) {
    onChunk(text.slice(i, i + chunkSize));
    await sleep(12);
  }
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
