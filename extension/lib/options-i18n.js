/**
 * Options page copy (en + zh_CN).
 * Keys map to data-i18n attributes in options.html.
 */

/** @type {Record<string, Record<string, string>>} */
export const OPTIONS_STRINGS = {
  en: {
    pageTitle: "WDIMTM Settings",
    tagline: "What Does It Mean To Me?",
    lede: "Select text on any page → pick a Lens → get a short, personalized explanation without leaving the flow.",

    navContents: "Contents",
    navAccount: "Account",
    navProduct: "Product",
    navAiAccess: "AI access",
    navWebSearch: "Web search",
    navLanguage: "Language",
    navDefaultLens: "Default lens",
    navLenses: "Lenses",
    navProfile: "Profile",
    navMemory: "Memory",
    navData: "Data",
    navPrivacy: "Privacy",
    navHowTo: "How to use",
    navFootnote:
      "Selections are never retained. Only explicit memories and settings are stored locally.",

    accountTitle: "Account",
    accountHint:
      "Local mode (default) keeps preferences and memories on this browser. Sign in to sync is optional and will use OAuth + a sync backend (Phase B). API keys are never synced unless you explicitly allow it.",
    accountMode: "Mode",
    accountModeLocal: "Local only — no account",
    accountModeCloud: "Sign in to sync (opt-in)",
    accountStatusDefault: "Not signed in. Cloud backend not configured yet.",
    syncPreferences: "Sync preferences, lenses & memories",
    syncChatHistory: "Sync page-chat history",
    syncSecrets: "Sync API keys (not recommended)",
    signIn: "Sign in",
    signOut: "Sign out",
    syncNow: "Sync now",
    accountExportHint:
      "Until cloud sync ships, use Export / Import below to move data between devices. Design: docs/auth-and-sync.md.",

    productTitle: "Product",
    enableGlobal: "Enable WDIMTM globally",
    denylist: "Site denylist (one hostname per line)",
    denylistPlaceholder: "mail.google.com\ndocs.google.com",
    denylistHint:
      "Subdomains are covered too, so example.com also turns off blog.example.com. The toolbar popup has a switch for the site you are on — it writes to this same list.",
    answerDepth: "Answer depth",
    depthShort: "Short",
    depthNormal: "Normal",
    depthDetailed: "Detailed",
    theme: "Theme",
    themeSystem: "System",
    themeDark: "Dark",
    themeLight: "Light",

    runtimeTitle: "Runtime",
    runtimeHint:
      "WDIMTM owns browser context and personalization. The runtime owns model execution. Mock works offline; OpenAI-compatible and Agentaab call external services.",
    runtime: "Runtime",
    runtimeMock: "Mock (offline)",
    runtimeOpenAI: "OpenAI-compatible API (bring your own key)",
    runtimePromptaaS: "Agentaab app (Beta — subscribe)",
    streamResponses: "Stream responses (popover + page chat)",

    webSearchTitle: "Web search (Verify / Research / Chat)",
    webSearchHint:
      "Optional. Verify, Research, and page chat can fetch live snippets (WEB EVIDENCE). Normal Explain stays single-shot without search.",
    webSearchEnabled: "Enable web search for Verify / Research / Chat",
    webSearchProvider: "Provider",
    webSearchNone: "None",
    webSearchApiKey: "Search API key",
    webSearchApiKeyPlaceholder: "Tavily / Brave / Serper key",
    webSearchMaxResults: "Max results",

    aiAccessTitle: "AI access",
    aiAccessHint:
      "Three paths: your own API key (pick a provider inside), WDIMTM Cloud (hosted — Agentaab is how Cloud is built, not a separate option), or Mock for offline demos.",
    accessByokTitle: "Use my own API key",
    accessByokDesc:
      "Pick a provider (OpenAI, OpenRouter, Anthropic, Ollama, or custom). You pay that provider directly.",
    accessCloudTitle: "WDIMTM Cloud (in development)",
    accessCloudDesc:
      "Hosted path — still under development. Target flow: sign in, pick a package, pay. For daily use now, prefer BYOK.",
    cloudProductHint:
      "In development: package list + checkout will come from Agentaab via WDIMTM Cloud. Wiring tracked in issues #86–#88. Prefer BYOK until checkout is live.",
    cloudDevBanner:
      "WDIMTM Cloud is under development. You can preview the package UI, but buying and hosted inference are not ready for daily use yet. Use your own API key (BYOK) for real answers.",
    cloudSignIn: "Sign in with Google",
    cloudSignedInAs: "Signed in as",
    cloudNeedSignIn: "Sign in to buy a package and use Cloud (when shipping).",
    cloudPackagesLoading: "Loading packages…",
    cloudPackagesEmpty: "No packages available yet.",
    cloudPackagesPreview: "Preview only — checkout not connected to Agentaab yet (#86–#87).",
    cloudPackagesFromAgentaab: "Packages from Agentaab.",
    cloudBuy: "Buy",
    cloudBuyUnavailable: "Unavailable",
    cloudCheckoutOpening: "Opening checkout…",
    cloudCheckoutFailed: "Could not start checkout.",
    cloudCheckoutWaiting: "Waiting for the payment to clear — this page will update itself.",
    cloudCheckoutCredited: "Payment received: {n} credits added.",
    cloudCheckoutPending:
      "No payment found yet. If you have paid, reopen this page in a minute.",
    cloudRefreshCredits: "I have paid — check now",
    cloudAdvanced: "Advanced / self-hosted",
    accessMockTitle: "Mock (offline demo)",
    accessMockDesc: "Fake answers for development and screenshots. Switch away before real use.",
    byokPreset: "Provider",
    byokPresetCustom: "Custom…",
    testConnection: "Test connection",
    testingConnection: "Testing…",
    testOk: "Connection OK.",
    testFailed: "Connection failed.",
    openSubscribe: "Open subscription",
    promptaasSubscribeUrl: "Subscribe URL (optional override)",
    promptaasSubscribePlaceholder: "https://…/subscribe",
    promptaasTokenPlaceholder: "paste token after subscribe",
    promptaasSteps: "1) Open subscribe · 2) Paste access token · 3) Test connection · 4) Save",
    openCloudSignUp: "Open WDIMTM Cloud",
    cloudBaseUrl: "Cloud base URL",
    cloudAccessToken: "Access token (filled by sign-in)",
    cloudTokenPlaceholder: "filled by Google sign-in",
    cloudSignUpUrl: "Manage / top-up URL (optional)",
    cloudSignUpPlaceholder: "https://…/cloud",
    cloudSteps: "1) Sign in · 2) Pick a package · 3) Pay",
    cloudSelfHosted:
      "Only for self-hosting a backend that implements docs/cloud-api-contract.md. Production users leave these alone. Local and BYOK always remain available.",
    mockFieldsHint:
      "Mock invents short explanations without calling a model. Switch to BYOK or WDIMTM Cloud for real answers — then use Test connection.",
    statusMock:
      "Using Mock — answers are demo text only. Pick “Use my own API key” or “WDIMTM Cloud”, fill the fields, Test connection, then Save.",
    statusMissingByokKey: "BYOK selected but no API key yet. Paste a key and Test connection.",
    statusMissingByokBase: "BYOK selected but API base URL is empty.",
    statusMissingAnthropicKey:
      "Anthropic selected but no API key yet. Paste a key and Test connection.",
    statusMissingAnthropicBase: "Anthropic selected but the base URL is empty.",
    statusAnthropicReady: "Anthropic ready — explains call the Messages API with your key.",
    statusUseCloudInstead:
      "This extension no longer talks to Agentaab directly. Choose WDIMTM Cloud for the hosted path.",
    statusMissingCloudBase: "WDIMTM Cloud selected but the cloud base URL is empty.",
    statusMissingCloudToken:
      "WDIMTM Cloud selected but you are not signed in yet. Sign in with Google when Cloud is ready — or use BYOK now.",
    statusCloudReady: "WDIMTM Cloud session present — hosted path is still in development; prefer BYOK for daily use until packages ship.",
    statusCloudInDev: "WDIMTM Cloud is under development. Prefer BYOK for real answers until packages and checkout are live (#86–#88).",
    creditsLeft: "credits left:",
    balanceEmpty: "Hosted credits for this period are used up.",
    balanceResets: "Resets",
    topUp: "Top up",
    useOwnKey: "Use my own API key",
    statusByokReady: "BYOK ready — real model answers will use your key.",

    researchJobsTitle: "Research jobs",
    researchJobsHint:
      "Research runs in WDIMTM Cloud, so a job you started on another tab — or another device — is still here.",
    researchJobsEmpty: "No research jobs yet. Select something on a page and choose “Research this”.",
    researchJobsUnavailable: "Sign in to WDIMTM Cloud to run durable research jobs.",
    refresh: "Refresh",
    statusConfigureAi: "Configure AI access below so explains use a real model.",
    lastTestOk: "Last test OK at",

    languageTitle: "Language",
    languageHint:
      "UI language is separate from answer language. You can read Chinese pages and still answer in English (or the reverse).",
    uiLanguage: "UI language",
    uiAuto: "Auto (browser)",
    uiEn: "English",
    uiZh: "简体中文",
    answerLanguage: "Answer language",
    answerAuto: "Auto (UI + selection signal)",
    answerMatch: "Match selection language",
    answerEn: "English",
    answerZh: "简体中文",

    apiBaseUrl: "API base URL",
    apiKey: "API key",
    model: "Model",
    anthropicHint:
      "Talks to api.anthropic.com directly (POST /v1/messages). Sampling settings are not sent — current Claude models reject them.",
    anthropicBaseUrl: "Anthropic base URL",
    anthropicApiKey: "Anthropic API key",
    anthropicModel: "Model",
    promptaasBaseUrl: "Agentaab base URL",
    promptaasApiKey: "Access token (optional)",
    promptaasAgentId: "Agent id",
    promptaasContract:
      "Contract: POST {base}/v1/agents/{agentId}/run with ExplainRequest. See docs/runtime-contract.md.",

    defaultLensTitle: "Lens",
    defaultLensHint:
      "Automatic suggests a lens from the selection (and your profile). Manual always uses the fixed default. Either way you can pick any lens on the bubble.",
    lensMode: "Lens selection",
    lensModeAuto: "Automatic — suggest from selection",
    lensModeManual: "Manual — always use the default below",
    domainLenses: "Per-site default lens (one per line)",
    domainLensesPlaceholder: "x.com = sanity\ngithub.com = engineering",
    domainLensesHint:
      "Applies on that site and its subdomains, ahead of the default above. The bubble still overrides it for a single selection.",
    addPresets: "Add suggested sites",
    lensModeHint:
      "Automatic may pick Engineering, Investing, Opportunities, etc. Low confidence falls back to the default. The bubble always lets you override.",
    defaultLens: "Default / fallback lens",
    saveSettings: "Save settings",

    customLensesTitle: "Custom Lenses",
    customLensesHint: "Natural-language instructions that reshape every explanation.",
    manageLensesTitle: "Lenses",
    manageLensesHint:
      "Fine-tune built-in lenses (override instructions) or add your own. Edits apply to every explain that uses that lens. Bubble dropdown updates after save.",
    noCustomLenses: "No custom lenses yet.",
    remove: "Remove",
    edit: "Edit",
    forkLens: "Duplicate",
    setDefault: "Set default",
    saveLens: "Save lens",
    cancelEdit: "Cancel",
    resetLens: "Reset to default",
    addCustomLensTitle: "Add custom lens",
    lensName: "Name",
    lensNamePlaceholder: "e.g. Hiring",
    lensNameZh: "Chinese name (optional)",
    lensNameZhPlaceholder: "e.g. 招聘",
    lensHint: "Hint (optional)",
    lensHintPlaceholder: "One-line description for the list",
    lensInstructions: "Instructions",
    lensInstructionsPlaceholder: "Focus on signal for evaluating candidates…",
    addLens: "Add lens",
    badgeBuiltin: "Built-in",
    badgeCustom: "Custom",
    badgeTweaked: "Tweaked",
    badgeDefault: "Default",
    editingBuiltin: "Editing built-in lens — save stores a personal override (original remains recoverable).",
    editingBuiltinOverride: "Editing your override of a built-in lens. Reset restores stock instructions.",
    editingCustom: "Editing custom lens.",
    lensRemoved: "Lens removed.",
    lensAdded: "Lens added.",
    lensSaved: "Lens saved.",
    lensOverrideSaved: "Lens tweak saved.",
    lensReset: "Built-in lens restored to default.",
    lensForked: "Duplicated as a custom lens — edit freely.",
    defaultLensSet: "Default lens updated.",
    lensFieldsRequired: "Name and instructions are required.",
    removeLensConfirm: "Remove this custom lens?",
    resetLensConfirm: "Reset this built-in lens to the stock instructions?",

    profileTitle: "Profile",
    profileHint:
      "Stable expertise, preferred depth/language, domains you already know. Attached as memory context on each request (local only unless you use a cloud runtime).",
    aboutYou: "About you",
    profilePlaceholder:
      "e.g. Staff engineer, interested in DeFi arbitrage and AI products. Prefer concise technical answers.",
    saveProfile: "Save profile",
    profileSaved: "Profile saved.",

    memoryTitle: "Memory",
    memoryHint:
      "Explicit memories only by default. Providers own storage; WDIMTM decides relevance per selection.",
    memoryProvider: "Memory provider",
    memoryLocal: "Local (chrome.storage)",
    memoryNone: "None",
    noMemories: "No memories stored.",
    forget: "Forget",
    memType: "Type",
    memInterest: "Interest",
    memGoal: "Goal",
    memKnowledge: "Knowledge",
    memPreference: "Preference",
    memNote: "Note",
    memProfile: "Profile",
    memText: "Text",
    memTextPlaceholder: "I care about early liquidity incentives",
    addMemory: "Add memory",
    clearAll: "Clear all",
    memoryAdded: "Memory added.",
    memoryForgotten: "Memory forgotten.",
    memoriesCleared: "Memories cleared.",
    enableMemoryFirst: "Enable local memory first.",
    clearMemoriesConfirm: "Clear all local memories?",
    providerUpdated: "Memory provider updated.",

    // Conversation import (#49)
    importEntry: "Import from AI chat history",
    importEntryHint:
      "Distil durable memories from an existing ChatGPT or Claude export. You review everything before anything is saved.",
    importPageTitle: "Import chat history — WDIMTM",
    importTitle: "Import from AI chat history",
    importLede:
      "Turn an existing ChatGPT or Claude export into memories WDIMTM can use — reviewed by you, stored on this device.",

    importChooseTitle: "Choose your export",
    importChooseHint:
      "Request your data export from ChatGPT or Claude, then hand the whole thing over — the .zip as downloaded, the unzipped folder, or individual files. WDIMTM reads only the conversation data and works out what each file is, so there is nothing to pick through: a large ChatGPT export splits its history across conversations-000.json, conversations-001.json and more, and a Claude export also carries a memories.json worth importing on its own.",
    importPrivacyNote:
      "Your conversations are read in this page only. They are never written to disk, and nothing is sent anywhere until you confirm on the next screen.",
    importChooseButton: "Choose a .zip or files",
    importChooseFolder: "Choose a folder",
    importDropHint: "Drop the .zip here — or the unzipped folder",
    importReading: "Reading file…",

    importResumeTitle: "Unfinished import",
    importResumeBody:
      "A previous run reached {done} of {total} batches. Choose the same files again to continue where it stopped.",
    importResumeDiscard: "Discard it",
    importResumeMismatch: "That is a different selection. Start over, or choose the original export files.",
    importResumeReady: "Continuing from batch {done}.",
    importDiscarded: "Unfinished import discarded.",

    importDiscloseTitle: "Before anything is sent",
    // Itemized as label/value pairs: this screen is a bill the user is being
    // asked to approve, and the shape also keeps every count out of a
    // pluralized noun phrase, which the plain string tables cannot inflect.
    importLedgerParsed: "Conversations parsed",
    importLedgerProfileBlocks: "Memory-store entries found",
    importLedgerIgnoredFiles: "Files ignored, not conversation history",
    importLedgerNonJson: "Files skipped, not JSON",
    importLedgerSkipped: "Could not be parsed, skipped",
    importLedgerDropped: "No message from you, left out",
    importLedgerBatches: "Batches to send",
    importLedgerTokens: "Estimated tokens",
    importLedgerTime: "Estimated time",
    importLedgerDestination: "Destination",
    importLedgerDestinationValue: "{model} at {host}",
    importDiscloseSafety:
      "Raw conversations are not written to disk and are never sent to a WDIMTM server.",
    importStart: "Start distilling",
    importBack: "Back",

    importNeedsModelTitle: "Configure a model first",
    importNeedsModelMock:
      "WDIMTM is on the built-in mock runtime, which has no model behind it. Add an OpenAI-compatible endpoint and key, then come back.",
    importNeedsModelPromptaas:
      "PromptaaS exposes a fixed explainer agent rather than an open completion endpoint, so import needs an OpenAI-compatible runtime instead.",
    importNeedsModelKey: "Add an API key for your OpenAI-compatible endpoint, then come back.",
    importOpenSettings: "Open AI access settings",
    importKeepThisTab: "Opens in a new tab so this page keeps what it already parsed.",
    importRecheck: "I have configured it",

    importRunningTitle: "Distilling",
    importRunningProgress: "Batch {done} of {total} · candidates so far: {candidates}",
    importRunningProfile: "Reading your memory store — {done} of {total}",
    importRunningKeepOpen: "Keep this page open. Closing it pauses the import.",
    importBackingOff: "Rate limited — waiting before retrying.",
    importStop: "Stop",
    importMerging: "Consolidating candidates…",

    importReviewTitle: "Review before saving",
    importReviewEmpty: "Nothing durable came out of this history. Nothing was saved.",
    importReviewFailed: "Batches that could not be read, skipped: {failed}",
    importReviewStopped: "Import stopped: {error}",
    importSelectAll: "Select all",
    importSelectNone: "Select none",
    importShowTail: "Show {n} more, weaker candidates",
    importHideTail: "Hide weaker candidates",
    importSupport: "Support {n}",
    importExistingBadge: "Already stored",
    importEvidence: "From: {titles}",
    importAccept: "Save selected ({n})",
    importAcceptNone: "Select at least one memory.",
    importOverLimit:
      "Saving these would exceed the {limit} memory limit. Deselect some, or clear old memories first.",

    importDoneTitle: "Saved",
    importDoneBody: "{n} saved to this device.",
    importBackToSettings: "Back to settings",
    importRunAgain: "Import another export",

    importErrInvalidJson: "No valid JSON among those files. Choose the conversations files from your export.",
    importErrUnknownFormat:
      "Could not recognize those files. Supported: ChatGPT and Claude conversation exports.",
    importErrEmpty: "No conversations were found in those files.",
    importErrNoJson:
      "No JSON found there. Choose the export .zip, the unzipped folder, or the JSON files inside it.",
    importErrMemoryOff: "Memory is set to None. Switch it to Local before importing.",

    dataTitle: "Data",
    dataHint: "Export preferences (API keys are never exported). Reset clears sync + local memory.",
    exportSettings: "Export settings",
    importSettings: "Import settings",
    resetAll: "Reset all data",
    exported: "Exported.",
    imported: "Imported.",
    exportFailed: "Export failed",
    importFailed: "Import failed",
    resetConfirm: "Reset all WDIMTM settings and local memories?",
    resetComplete: "Reset complete.",
    resetFailed: "Reset failed",

    privacyTitle: "Privacy",
    privacy1:
      "Only selected text, page title/URL, and a bounded neighborhood of surrounding text leave the content script.",
    privacy2: "The full page DOM is never uploaded.",
    privacy3: "Mock: explain payloads stay in the browser (settings may sync).",
    privacy4:
      "BYOK: the explain payload (including relevant memories + lens) is sent to your configured OpenAI-compatible endpoint. Keys live in chrome.storage and are not product-cloud by default.",
    privacy4b:
      "Agentaab: the explain payload is sent to the Agentaab app endpoint under your subscription token (sub2api-style billing lives outside WDIMTM).",
    privacy5:
      "Local memories live in chrome.storage.local. Nothing is auto-remembered from what you read — only explicit Remember this or settings entries.",
    privacy6:
      "Images you attach in chat — including a system screenshot you paste in — are sent to the same AI endpoint as the text, and only when you send that message. Full-size image data stays in the tab; only a small thumbnail is kept, in session storage, so a reopened thread still shows what you sent.",

    howToTitle: "How to use",
    howTo1: "Select text on a page.",
    howTo2: "Optionally change the Lens on the bubble.",
    howTo3: "Click WDIMTM.",
    howTo4: "Use Explain more, Why it matters, Verify, Discuss further, or Remember this.",
    howTo5: "Press Esc or click outside to dismiss. Use 💬 on the bubble for page chat.",

    saved: "Saved.",
    savedNoLocalAccess:
      "Saved, but access to the local endpoint was declined — that runtime will not be reachable until you allow it.",
    signedIn: "Signed in.",
    signedOut: "Signed out. Local data kept.",
    synced: "Synced.",
    signInFailed: "Sign-in failed",
    syncFailed: "Sync failed",
    neverSynced: "Never synced to cloud.",
    lastSynced: "Last synced:",
    localModeNoAccount: "Local mode — no account.",
    notSignedIn: "Not signed in.",
    notSignedInCloudPending:
      "Not signed in. WDIMTM Cloud is still under development — Local mode or BYOK recommended.",
    signedInAs: "Signed in as",
  },
  zh_CN: {
    pageTitle: "WDIMTM 设置",
    tagline: "于我何意",
    lede: "在任意网页选中文字 → 选择镜头（Lens）→ 无需离开页面即可获得简短、个性化的解释。",

    accountTitle: "账户",
    accountHint:
      "本地模式（默认）将偏好与记忆保存在本浏览器。「登录同步」为可选项，将使用 OAuth + 同步后端（Phase B）。除非你明确允许，否则不会同步 API 密钥。",
    accountMode: "模式",
    accountModeLocal: "仅本地 — 无账户",
    accountModeCloud: "登录以同步（可选）",
    accountStatusDefault: "未登录。云端后端尚未配置。",
    syncPreferences: "同步偏好、镜头与记忆",
    syncChatHistory: "同步页面对话历史",
    syncSecrets: "同步 API 密钥（不推荐）",
    signIn: "登录",
    signOut: "退出登录",
    syncNow: "立即同步",
    accountExportHint:
      "在云同步上线前，请用下方的「导出 / 导入」在设备间迁移数据。设计说明：docs/auth-and-sync.md。",

    navContents: "目录",
    navAccount: "账户",
    navProduct: "产品",
    navAiAccess: "模型接入",
    navWebSearch: "网页搜索",
    navLanguage: "语言",
    navDefaultLens: "默认镜头",
    navLenses: "镜头",
    navProfile: "个人档案",
    navMemory: "记忆",
    navData: "数据",
    navPrivacy: "隐私",
    navHowTo: "使用方法",
    navFootnote: "选中的文字不会被保留。只有你明确保存的记忆与设置会存在本地。",

    productTitle: "产品",
    enableGlobal: "全局启用 WDIMTM",
    denylist: "站点黑名单（每行一个主机名）",
    denylistPlaceholder: "mail.google.com\ndocs.google.com",
    denylistHint:
      "子域名同样生效，写 example.com 也会关掉 blog.example.com。工具栏弹窗里有当前站点的开关，写入的就是这份名单。",
    answerDepth: "回答详细程度",
    depthShort: "简短",
    depthNormal: "适中",
    depthDetailed: "详细",
    theme: "主题",
    themeSystem: "跟随系统",
    themeDark: "深色",
    themeLight: "浅色",

    runtimeTitle: "运行时",
    runtimeHint:
      "WDIMTM 负责浏览器上下文与个性化；运行时负责模型执行。Mock 可离线使用；OpenAI-compatible 与 Agentaab 会请求外部服务。",
    runtime: "运行时",
    runtimeMock: "Mock（离线）",
    runtimeOpenAI: "OpenAI 兼容 API（自备密钥）",
    runtimePromptaaS: "Agentaab 应用（Beta · 订阅）",
    streamResponses: "流式显示回答（弹层 + 页面对话）",

    webSearchTitle: "网页搜索（核实 / 研究 / 对话）",
    webSearchHint:
      "可选。开启后，核实 / 研究模式与页面对话会检索网页并作为 WEB EVIDENCE 注入。普通 Explain 仍单次调用、不搜索。",
    webSearchEnabled: "为核实 / 研究 / 对话启用网页搜索",
    webSearchProvider: "提供商",
    webSearchNone: "关闭",
    webSearchApiKey: "搜索 API Key",
    webSearchApiKeyPlaceholder: "Tavily / Brave / Serper 密钥",
    webSearchMaxResults: "最多结果条数",

    aiAccessTitle: "AI 接入",
    aiAccessHint:
      "三条路径：自备密钥（在内部选择服务商）、WDIMTM Cloud（托管；Agentaab 是 Cloud 的实现方式，不是单独选项）、或 Mock 离线演示。",
    accessByokTitle: "使用我自己的 API 密钥",
    accessByokDesc:
      "选择服务商（OpenAI / OpenRouter / Anthropic / Ollama / 自定义）。费用直接付给该服务商。",
    accessCloudTitle: "WDIMTM Cloud（开发中）",
    accessCloudDesc:
      "托管路径 — 仍在开发中。目标流程：登录 → 选套餐 → 支付。日常使用请先用自备密钥（BYOK）。",
    cloudProductHint:
      "开发中：套餐列表与结账将经 WDIMTM Cloud 对接 Agentaab。联调见 #86–#88。上线前请用 BYOK 获得真实回答。",
    cloudDevBanner:
      "WDIMTM Cloud 仍在开发中。可预览套餐界面，但购买与托管推理尚不适合日常使用。需要真实回答请选「使用我自己的 API 密钥」。",
    cloudSignIn: "使用 Google 登录",
    cloudSignedInAs: "已登录为",
    cloudNeedSignIn: "登录后可购买套餐并使用 Cloud（上线后）。",
    cloudPackagesLoading: "正在加载套餐…",
    cloudPackagesEmpty: "暂无可用套餐。",
    cloudPackagesPreview: "仅预览 — 尚未接到 Agentaab 结账（#86–#87）。",
    cloudPackagesFromAgentaab: "套餐来自 Agentaab。",
    cloudBuy: "购买",
    cloudBuyUnavailable: "暂不可用",
    cloudCheckoutOpening: "正在打开结账…",
    cloudCheckoutFailed: "无法开始结账。",
    cloudCheckoutWaiting: "正在等待付款到账 — 本页会自动更新。",
    cloudCheckoutCredited: "付款已到账：增加 {n} 额度。",
    cloudCheckoutPending: "还没查到付款。如果你已经付了，过一分钟再打开本页。",
    cloudRefreshCredits: "我已付款 — 立即检查",
    cloudAdvanced: "高级 / 自托管",
    accessMockTitle: "Mock（离线演示）",
    accessMockDesc: "开发与截图用的假回答。正式使用前请切换到其他路径。",
    byokPreset: "服务商",
    byokPresetCustom: "自定义…",
    testConnection: "测试连接",
    testingConnection: "测试中…",
    testOk: "连接成功。",
    testFailed: "连接失败。",
    openSubscribe: "打开订阅页",
    promptaasSubscribeUrl: "订阅链接（可选覆盖）",
    promptaasSubscribePlaceholder: "https://…/subscribe",
    promptaasTokenPlaceholder: "订阅后粘贴访问令牌",
    promptaasSteps: "1）打开订阅 · 2）粘贴访问令牌 · 3）测试连接 · 4）保存",
    openCloudSignUp: "打开 WDIMTM Cloud",
    cloudBaseUrl: "Cloud 基础 URL",
    cloudAccessToken: "访问令牌（登录后自动填入）",
    cloudTokenPlaceholder: "由 Google 登录自动填入",
    cloudSignUpUrl: "管理 / 充值链接（可选）",
    cloudSignUpPlaceholder: "https://…/cloud",
    cloudSteps: "1）登录 · 2）选择套餐 · 3）支付",
    cloudSelfHosted:
      "仅用于自托管实现 docs/cloud-api-contract.md 的后端。正式用户无需改这些项。本地与 BYOK 始终可用。",
    mockFieldsHint:
      "Mock 会编造简短解释，不会调用真实模型。要得到真实回答请切换到「自备密钥」或 WDIMTM Cloud，并使用「测试连接」。",
    statusMock:
      "当前为 Mock — 回答仅为演示文案。请选择「使用我自己的 API 密钥」或「WDIMTM Cloud」，填写配置、测试连接后保存。",
    statusMissingByokKey: "已选择自备密钥，但尚未填写 API 密钥。请粘贴密钥并测试连接。",
    statusMissingByokBase: "已选择自备密钥，但 API 基础 URL 为空。",
    statusMissingAnthropicKey: "已选择 Anthropic，但尚未填写 API 密钥。请粘贴密钥并测试连接。",
    statusMissingAnthropicBase: "已选择 Anthropic，但基础 URL 为空。",
    statusAnthropicReady: "Anthropic 已就绪 — 解释将用你的密钥调用 Messages API。",
    statusUseCloudInstead: "扩展不再直接对接 Agentaab。托管路径请选择 WDIMTM Cloud。",
    statusMissingCloudBase: "已选择 WDIMTM Cloud，但 Cloud 基础 URL 为空。",
    statusMissingCloudToken:
      "已选择 WDIMTM Cloud，但尚未登录。Cloud 就绪后请用 Google 登录 — 现在请先用 BYOK。",
    statusCloudReady:
      "已有 WDIMTM Cloud 会话 — 托管路径仍在开发中；套餐上线前日常使用请优先 BYOK。",
    statusCloudInDev:
      "WDIMTM Cloud 仍在开发中。套餐与结账上线前（#86–#88），请用自备密钥获得真实回答。",
    creditsLeft: "剩余额度：",
    balanceEmpty: "本周期的托管额度已用完。",
    balanceResets: "重置时间",
    topUp: "充值",
    useOwnKey: "改用自己的 API Key",
    statusByokReady: "自备密钥已就绪 — 真实回答将使用你的密钥。",

    researchJobsTitle: "研究任务",
    researchJobsHint:
      "研究任务运行在 WDIMTM Cloud，所以在别的标签页——甚至别的设备——发起的任务，这里依然能看到。",
    researchJobsEmpty: "还没有研究任务。在网页上选中内容，点“深入研究”即可发起。",
    researchJobsUnavailable: "登录 WDIMTM Cloud 后才能运行持久研究任务。",
    refresh: "刷新",
    statusConfigureAi: "请在下方配置 AI 接入，以便解释使用真实模型。",
    lastTestOk: "上次测试成功于",

    languageTitle: "语言",
    languageHint:
      "界面语言与回答语言相互独立。你可以读中文页面却用英文回答（或反过来）。",
    uiLanguage: "界面语言",
    uiAuto: "自动（跟随浏览器）",
    uiEn: "English",
    uiZh: "简体中文",
    answerLanguage: "回答语言",
    answerAuto: "自动（界面 + 选区信号）",
    answerMatch: "跟随选区语言",
    answerEn: "English",
    answerZh: "简体中文",

    apiBaseUrl: "API 基础 URL",
    apiKey: "API 密钥",
    model: "模型",
    anthropicHint:
      "直接调用 api.anthropic.com（POST /v1/messages）。不会发送采样参数 — 当前 Claude 模型会拒绝。",
    anthropicBaseUrl: "Anthropic 基础 URL",
    anthropicApiKey: "Anthropic API 密钥",
    anthropicModel: "模型",
    promptaasBaseUrl: "Agentaab 基础 URL",
    promptaasApiKey: "访问令牌（可选）",
    promptaasAgentId: "Agent ID",
    promptaasContract:
      "约定：POST {base}/v1/agents/{agentId}/run，请求体为 ExplainRequest。详见 docs/runtime-contract.md。",

    defaultLensTitle: "镜头",
    defaultLensHint:
      "自动：根据选区与 profile 建议镜头；手动：始终用下方默认。气泡上仍可随时改成明确镜头。",
    lensMode: "镜头选择",
    lensModeAuto: "自动 — 根据选区建议",
    lensModeManual: "手动 — 始终使用下方默认",
    domainLenses: "按站点的默认视角（每行一条）",
    domainLensesPlaceholder: "x.com = sanity\ngithub.com = engineering",
    domainLensesHint:
      "对该站点及其子域生效，优先于上面的默认值。气泡里的选择仍可对单次选区覆盖。",
    addPresets: "添加推荐站点",
    lensModeHint:
      "自动可能选工程 / 投资 / 找机会等；置信度低时回退默认。气泡下拉可随时覆盖。",
    defaultLens: "默认 / 回退镜头",
    saveSettings: "保存设置",

    customLensesTitle: "自定义镜头",
    customLensesHint: "用自然语言指令改写每一次解释的侧重点。",
    manageLensesTitle: "镜头管理",
    manageLensesHint:
      "可微调内置镜头的指令（覆盖），也可新增完全自定义的镜头。保存后，bubble 下拉与解释请求都会使用最新定义。",
    noCustomLenses: "暂无自定义镜头。",
    remove: "删除",
    edit: "编辑",
    forkLens: "复制",
    setDefault: "设为默认",
    saveLens: "保存镜头",
    cancelEdit: "取消",
    resetLens: "恢复默认",
    addCustomLensTitle: "添加自定义镜头",
    lensName: "名称",
    lensNamePlaceholder: "例如：招聘",
    lensNameZh: "中文名（可选）",
    lensNameZhPlaceholder: "例如：招聘",
    lensHint: "提示（可选）",
    lensHintPlaceholder: "列表中显示的一行说明",
    lensInstructions: "指令",
    lensInstructionsPlaceholder: "关注评估候选人的信号…",
    addLens: "添加镜头",
    badgeBuiltin: "内置",
    badgeCustom: "自定义",
    badgeTweaked: "已微调",
    badgeDefault: "默认",
    editingBuiltin: "正在编辑内置镜头 — 保存后写入个人覆盖（可随时恢复原版）。",
    editingBuiltinOverride: "正在编辑内置镜头的个人覆盖。点「恢复默认」可还原。",
    editingCustom: "正在编辑自定义镜头。",
    lensRemoved: "已删除镜头。",
    lensAdded: "已添加镜头。",
    lensSaved: "镜头已保存。",
    lensOverrideSaved: "镜头微调已保存。",
    lensReset: "已恢复内置镜头默认指令。",
    lensForked: "已复制为自定义镜头，可自由修改。",
    defaultLensSet: "默认镜头已更新。",
    lensFieldsRequired: "名称与指令为必填。",
    removeLensConfirm: "删除这个自定义镜头？",
    resetLensConfirm: "将该内置镜头恢复为出厂指令？",

    profileTitle: "个人简介",
    profileHint:
      "稳定的专长、偏好深度/语言、已掌握的领域。会作为记忆上下文附在请求中（默认仅本地，除非使用云端运行时）。",
    aboutYou: "关于你",
    profilePlaceholder:
      "例如：资深工程师，关注 DeFi 套利与 AI 产品。偏好简洁偏技术的回答。",
    saveProfile: "保存简介",
    profileSaved: "简介已保存。",

    memoryTitle: "记忆",
    memoryHint: "默认仅显式记忆。存储由 Provider 负责；WDIMTM 决定本次请求用哪些记忆。",
    memoryProvider: "记忆提供者",
    memoryLocal: "本地（chrome.storage）",
    memoryNone: "关闭",
    noMemories: "暂无记忆。",
    forget: "忘记",
    memType: "类型",
    memInterest: "兴趣",
    memGoal: "目标",
    memKnowledge: "知识",
    memPreference: "偏好",
    memNote: "笔记",
    memProfile: "简介",
    memText: "内容",
    memTextPlaceholder: "我关心早期流动性激励",
    addMemory: "添加记忆",
    clearAll: "全部清除",
    memoryAdded: "已添加记忆。",
    memoryForgotten: "已忘记该记忆。",
    memoriesCleared: "已清除全部记忆。",
    enableMemoryFirst: "请先启用本地记忆。",
    clearMemoriesConfirm: "清除全部本地记忆？",
    providerUpdated: "记忆提供者已更新。",

    // 对话历史导入（#49）
    importEntry: "从 AI 对话历史导入",
    importEntryHint:
      "从已有的 ChatGPT 或 Claude 导出中提炼长期记忆。保存前每一条都由你过目。",
    importPageTitle: "导入对话历史 — WDIMTM",
    importTitle: "从 AI 对话历史导入",
    importLede:
      "把已有的 ChatGPT 或 Claude 导出变成 WDIMTM 能用的记忆 —— 由你审阅，存在这台设备上。",

    importChooseTitle: "选择导出文件",
    importChooseHint:
      "在 ChatGPT 或 Claude 申请数据导出，然后整个交给我们 —— 刚下载的 .zip、解压后的文件夹、或者单个文件都行。WDIMTM 只读取对话数据，并自己判断每个文件是什么，你不需要从里面挑：较大的 ChatGPT 导出会把历史拆成 conversations-000.json、conversations-001.json 等多个文件，Claude 的导出里还有一个单独导入就很有价值的 memories.json。",
    importPrivacyNote:
      "对话内容只在本页面中读取，不会写入磁盘；在你于下一屏确认之前，不会发送到任何地方。",
    importChooseButton: "选择 .zip 或文件",
    importChooseFolder: "选择文件夹",
    importDropHint: "把 .zip 拖到这里 —— 解压后的文件夹也可以",
    importReading: "正在读取文件…",

    importResumeTitle: "有未完成的导入",
    importResumeBody: "上次进行到 {total} 批中的第 {done} 批。重新选择同一批文件即可接着跑。",
    importResumeDiscard: "丢弃",
    importResumeMismatch: "这是另一批文件。请选择原来那份导出，或者重新开始。",
    importResumeReady: "将从第 {done} 批继续。",
    importDiscarded: "已丢弃未完成的导入。",

    importDiscloseTitle: "发送任何数据之前",
    importLedgerParsed: "已解析对话",
    importLedgerProfileBlocks: "记忆库条目",
    importLedgerIgnoredFiles: "已忽略、非对话历史的文件",
    importLedgerNonJson: "已跳过、非 JSON 的文件",
    importLedgerSkipped: "无法解析、已跳过",
    importLedgerDropped: "没有你的发言、已排除",
    importLedgerBatches: "将发送批次",
    importLedgerTokens: "预计 token",
    importLedgerTime: "预计耗时",
    importLedgerDestination: "发送目标",
    importLedgerDestinationValue: "{host} 的 {model}",
    importDiscloseSafety: "原始对话不会写入磁盘，也不会发送到 WDIMTM 的服务器。",
    importStart: "开始提炼",
    importBack: "返回",

    importNeedsModelTitle: "需要先配置模型",
    importNeedsModelMock:
      "当前用的是内置 mock 运行时，背后没有真实模型。请先配置 OpenAI 兼容的接口和密钥，再回来继续。",
    importNeedsModelPromptaas:
      "PromptaaS 暴露的是固定的解释 agent，而不是开放的补全接口，导入需要 OpenAI 兼容的运行时。",
    importNeedsModelKey: "请为你的 OpenAI 兼容接口填入 API 密钥，再回来继续。",
    importOpenSettings: "打开模型接入设置",
    importKeepThisTab: "会在新标签页打开，本页已解析的内容不会丢失。",
    importRecheck: "我已经配置好了",

    importRunningTitle: "正在提炼",
    importRunningProgress: "{total} 批中已完成 {done} 批 · 已得到候选 {candidates} 条",
    importRunningProfile: "正在读取你的记忆库 —— {total} 中的第 {done}",
    importRunningKeepOpen: "请保持此页面打开。关闭会暂停导入。",
    importBackingOff: "触发限速 —— 正在退避后重试。",
    importStop: "停止",
    importMerging: "正在合并候选…",

    importReviewTitle: "保存前审阅",
    importReviewEmpty: "这份历史里没有提炼出可长期保留的内容，未保存任何记忆。",
    importReviewFailed: "有 {failed} 批无法读取，已跳过。",
    importReviewStopped: "导入已中止：{error}",
    importSelectAll: "全选",
    importSelectNone: "全不选",
    importShowTail: "展开 {n} 条较弱的候选",
    importHideTail: "收起较弱的候选",
    importSupport: "支撑 {n} 段",
    importExistingBadge: "已存在",
    importEvidence: "来源：{titles}",
    importAccept: "保存所选（{n}）",
    importAcceptNone: "请至少选择一条记忆。",
    importOverLimit: "保存这些会超过 {limit} 条记忆上限。请取消勾选一部分，或先清理旧记忆。",

    importDoneTitle: "已保存",
    importDoneBody: "{n} 条记忆已存在这台设备上。",
    importBackToSettings: "返回设置",
    importRunAgain: "再导入一份",

    importErrInvalidJson: "所选文件里没有合法的 JSON。请选择导出包里的对话文件。",
    importErrUnknownFormat:
      "无法识别所选文件。目前支持 ChatGPT 与 Claude 的对话导出。",
    importErrEmpty: "所选文件里没有找到对话。",
    importErrNoJson:
      "里面没有找到 JSON。请选择导出的 .zip、解压后的文件夹，或其中的 JSON 文件。",
    importErrMemoryOff: "记忆提供者当前为「关闭」。请先切换到「本地」再导入。",

    dataTitle: "数据",
    dataHint: "导出偏好（不会导出 API 密钥）。重置会清空同步设置与本地记忆。",
    exportSettings: "导出设置",
    importSettings: "导入设置",
    resetAll: "重置全部数据",
    exported: "已导出。",
    imported: "已导入。",
    exportFailed: "导出失败",
    importFailed: "导入失败",
    resetConfirm: "重置全部 WDIMTM 设置与本地记忆？",
    resetComplete: "重置完成。",
    resetFailed: "重置失败",

    privacyTitle: "隐私",
    privacy1: "只有选中文本、页面标题/URL，以及有界的周边上下文会离开内容脚本。",
    privacy2: "永远不会上传完整页面 DOM。",
    privacy3: "Mock：解释请求留在浏览器内（设置项可能会同步）。",
    privacy4:
      "自备密钥（BYOK）：解释请求（含相关记忆与镜头）会发往你配置的 OpenAI 兼容端点。密钥保存在 chrome.storage，默认不同步到产品云。",
    privacy4b:
      "Agentaab：解释请求会发往 Agentaab 应用端点，使用你的订阅令牌（sub2api 式计费在 WDIMTM 之外）。",
    privacy5:
      "本地记忆保存在 chrome.storage.local。不会自动记住你读过的内容——只有显式的「记住这个」或设置里的条目。",
    privacy6:
      "你在对话里附加的图片（包括你粘贴进来的系统截图），会和文字一起发往同一个 AI 端点，且只在你发送那条消息时发送。原图只留在当前标签页内存里；只有一张小缩略图会写入 session storage，以便重新打开会话时仍能看到你发过什么。",

    howToTitle: "如何使用",
    howTo1: "在页面上选中文字。",
    howTo2: "可在 bubble 上切换镜头（Lens）。",
    howTo3: "点击 WDIMTM。",
    howTo4: "使用「展开说明」「为什么重要」「核实」「深入对话」或「记住这个」。",
    howTo5: "按 Esc 或点击外部关闭。bubble 上的 💬 可打开页面对话。",

    saved: "已保存。",
    savedNoLocalAccess: "已保存，但本地端点的访问权限被拒绝 —— 在你授权之前该运行时无法连接。",
    signedIn: "已登录。",
    signedOut: "已退出。本地数据仍保留。",
    synced: "已同步。",
    signInFailed: "登录失败",
    syncFailed: "同步失败",
    neverSynced: "尚未同步到云端。",
    lastSynced: "上次同步：",
    localModeNoAccount: "本地模式 — 无账户。",
    notSignedIn: "未登录。",
    notSignedInCloudPending: "未登录。WDIMTM Cloud 仍在开发中 — 建议本地模式或 BYOK。",
    signedInAs: "已登录为",
  },
};

/**
 * @param {string} key
 * @param {'en' | 'zh_CN'} locale
 */
export function ot(key, locale = "en") {
  const table = OPTIONS_STRINGS[locale] || OPTIONS_STRINGS.en;
  return table[key] || OPTIONS_STRINGS.en[key] || key;
}

/**
 * Apply data-i18n / data-i18n-placeholder / data-i18n-title on the page.
 * @param {'en' | 'zh_CN'} locale
 * @param {ParentNode} [root]
 */
export function applyOptionsI18n(locale, root = document) {
  document.documentElement.lang = locale === "zh_CN" ? "zh-CN" : "en";
  document.title = ot("pageTitle", locale);

  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const text = ot(key, locale);
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    el.textContent = text;
  });

  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (!key) return;
    el.innerHTML = ot(key, locale);
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || "placeholder" in el) {
      el.placeholder = ot(key, locale);
    }
  });

  root.querySelectorAll("[data-i18n-option]").forEach((el) => {
    const key = el.getAttribute("data-i18n-option");
    if (!key) return;
    el.textContent = ot(key, locale);
  });
}
