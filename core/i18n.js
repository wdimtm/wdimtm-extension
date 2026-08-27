/**
 * UI + answer language helpers (Issue #7).
 */

/** @type {Record<string, Record<string, string>>} */
const STRINGS = {
  en: {
    popoverTitle: "What does it mean to me?",
    loadingExplain: "Understanding selection…",
    loadingMore: "Going deeper…",
    loadingWhy: "Why it matters…",
    loadingVerify: "Checking claims…",
    loadingSimplify: "Simplifying…",
    retry: "Retry",
    settings: "Settings",
    mockDemoTitle: "Sample answer — not a real explanation",
    mockDemoNote:
      "The mock runtime produces placeholder text. Add your own AI access to explain this selection for real.",
    configureAi: "Configure AI access",
    remembered: "Saved to local memory.",
    rememberPromptTitle: "Remember this?",
    rememberAccept: "Remember",
    rememberDismiss: "Not now",
    streaming: "Streaming…",
    close: "Close",
    lensAria: "How to read this",
    fuMore: "Explain more",
    fuWhy: "Why it matters",
    fuVerify: "Verify",
    fuRemember: "Remember this",
    fuSimplify: "Explain simpler",
    fuOpportunity: "Any opportunity?",
    copy: "Copy",
    copied: "Copied",
    cancel: "Cancel",
    discussFurther: "Discuss further",
    chatTitle: "Page chat",
    chatPlaceholder: "Ask a follow-up…",
    chatSend: "Send",
    chatEmpty: "Continue from the explanation. Ask anything about this selection.",
    chatSeedUser: "Help me go deeper on this selection.",
    chatClose: "Close chat",
    chatSelection: "Selection",
    chatOpen: "Chat",
    chatClear: "Clear thread",
    chatCollapse: "Minimize",
    chatExpand: "Expand chat",
    chatHistory: "On this page",
    chatRoleYou: "You",
    openSettings: "Open settings",
    useOwnKey: "Use my own API key",
    chatStopped: "Stopped.",
    stop: "Stop",
    topUp: "Top up credits",
    chatSuggestSummarize: "Summarize selection",
    chatSuggestPage: "Summarize page (bounded)",
    chatSuggestWhy: "Why does this matter?",
    chatSuggestSanity: "Does this hold up?",
    summarize: "Summarize",
    extContextInvalid:
      "Extension was reloaded — refresh this page, then open chat again.",
    chatSearchOff: "Web search: off (Options → Web search)",
    chatSearchOk: "Web search: {provider} · {n} hits",
    chatSearchFailed: "Web search failed: {error}",
    chatSearchEmpty: "Web search: no results",
    attachImage: "Attach image",
    attachRemove: "Remove image",
    attachHint: "Paste or drop a screenshot here",
    attachTooMany: "Up to {n} images per message.",
    attachFailed: "That image could not be attached.",
    researchThis: "Research this",
    researchHint: "Runs in WDIMTM Cloud and keeps going after you close this page.",
    researchTitle: "Research job",
    researchStarting: "Starting research…",
    researchRunning: "Researching… you can close this page; the job keeps running.",
    researchStopped: "Research stopped.",
    sources: "Sources",
    researchState_queued: "queued",
    researchState_running: "running",
    researchState_succeeded: "done",
    researchState_failed: "failed",
    researchState_canceled: "canceled",
  },
  zh_CN: {
    popoverTitle: "于我何意",
    loadingExplain: "正在理解选区…",
    loadingMore: "正在展开说明…",
    loadingWhy: "正在分析相关性…",
    loadingVerify: "正在核实主张…",
    loadingSimplify: "正在简化说明…",
    retry: "重试",
    settings: "设置",
    mockDemoTitle: "示例答案 —— 不是真实解释",
    mockDemoNote:
      "当前是 mock 运行时，输出为占位文本。接入你自己的模型后，才会真正解释这段选区。",
    configureAi: "配置 AI 接入",
    remembered: "已保存到本地记忆。",
    rememberPromptTitle: "记住这个吗？",
    rememberAccept: "记住",
    rememberDismiss: "暂不",
    streaming: "生成中…",
    close: "关闭",
    lensAria: "解读方式",
    fuMore: "展开说明",
    fuWhy: "为什么重要",
    fuVerify: "核实主张",
    fuRemember: "记住这个",
    fuSimplify: "讲简单点",
    fuOpportunity: "有没有机会",
    copy: "复制",
    copied: "已复制",
    cancel: "取消",
    discussFurther: "深入对话",
    chatTitle: "页面对话",
    chatPlaceholder: "继续追问…",
    chatSend: "发送",
    chatEmpty: "基于刚才的解释继续追问，围绕当前选区与页面上下文。",
    chatSeedUser: "请基于这段选区帮我深入理解。",
    chatClose: "关闭对话",
    chatSelection: "选区",
    chatOpen: "对话",
    chatClear: "清空会话",
    chatCollapse: "最小化",
    chatExpand: "展开对话",
    chatHistory: "本页记录",
    chatRoleYou: "你",
    openSettings: "打开设置",
    useOwnKey: "改用自己的 API Key",
    chatStopped: "已停止。",
    stop: "停止",
    topUp: "充值额度",
    chatSuggestSummarize: "总结选区",
    chatSuggestPage: "总结本页（有界）",
    chatSuggestWhy: "这为什么重要？",
    chatSuggestSanity: "这有没有道理？",
    summarize: "总结",
    extContextInvalid: "扩展已重新加载 — 请刷新本页后再打开对话。",
    chatSearchOff: "网页搜索：未开启（Options → Web search）",
    chatSearchOk: "网页搜索：{provider} · {n} 条",
    chatSearchFailed: "网页搜索失败：{error}",
    chatSearchEmpty: "网页搜索：无结果",
    attachImage: "添加图片",
    attachRemove: "移除图片",
    attachHint: "截图可直接粘贴或拖到这里",
    attachTooMany: "每条消息最多 {n} 张图片。",
    attachFailed: "这张图片无法添加。",
    researchThis: "深入研究",
    researchHint: "在 WDIMTM Cloud 运行，关掉这个页面也会继续。",
    researchTitle: "研究任务",
    researchStarting: "正在创建研究任务…",
    researchRunning: "研究中…可以关掉此页，任务会继续运行。",
    researchStopped: "研究已停止。",
    sources: "来源",
    researchState_queued: "排队中",
    researchState_running: "运行中",
    researchState_succeeded: "已完成",
    researchState_failed: "失败",
    researchState_canceled: "已取消",
  },
};

/**
 * The host's own language is passed in rather than sniffed here. This has to
 * resolve a locale inside a Worker too, where there is no `chrome.i18n` and no
 * `navigator` to ask — and where guessing "en" silently would be worse than
 * being told.
 *
 * @param {string} [uiLocale] auto | en | zh_CN
 * @param {string} [hostLocale] the host's UI language, e.g. navigator.language
 * @returns {'en' | 'zh_CN'}
 */
export function resolveUiLocale(uiLocale, hostLocale = "") {
  if (uiLocale === "en" || uiLocale === "zh_CN") return uiLocale;
  return String(hostLocale || "").toLowerCase().startsWith("zh") ? "zh_CN" : "en";
}

/**
 * Answer language precedence (Issue #7):
 * 1. explicit preference (en | zh_CN | match-selection | auto)
 * 2. browser/UI locale for auto
 * 3. selection language as signal for match-selection
 *
 * @param {{ answerLanguage?: string, uiLocale?: string }} settings
 * @param {string} [selection]
 * @param {string} [hostLocale] the host's UI language; see host-locale.js
 * @returns {'en' | 'zh_CN'}
 */
export function resolveAnswerLanguage(settings, selection = "", hostLocale = "") {
  const pref = settings.answerLanguage || "auto";
  if (pref === "en" || pref === "zh_CN") return pref;
  if (pref === "match-selection") {
    return isMostlyCjk(selection) ? "zh_CN" : "en";
  }
  // auto → UI locale, with selection as soft signal if UI is English but selection is Chinese
  const ui = resolveUiLocale(settings.uiLocale, hostLocale);
  if (ui === "en" && isMostlyCjk(selection)) return "zh_CN";
  return ui;
}

/**
 * @param {string} key
 * @param {'en' | 'zh_CN'} locale
 */
export function t(key, locale = "en") {
  const table = STRINGS[locale] || STRINGS.en;
  return table[key] || STRINGS.en[key] || key;
}

/**
 * Instruction line injected into model system prompt.
 * @param {'en' | 'zh_CN'} answerLang
 */
export function answerLanguageInstruction(answerLang) {
  if (answerLang === "zh_CN") {
    return "Write the entire explanation in Simplified Chinese. Keep proper nouns / ticker symbols in their original form when clearer.";
  }
  return "Write the entire explanation in English. Keep proper nouns in their original form when clearer.";
}

/** @param {string} text */
function isMostlyCjk(text) {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return cjk >= 4 && cjk >= letters;
}

export { STRINGS };
