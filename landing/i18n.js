/**
 * Landing page i18n (en + zh_CN).
 * - Prefer ?lang= / localStorage
 * - Else browser language (zh* → zh_CN)
 */
(function () {
  const STORAGE_KEY = "wdimtm-landing-lang";
  const SUPPORTED = ["en", "zh_CN"];

  /** @type {Record<string, Record<string, string>>} */
  const STRINGS = {
    en: {
      "meta.title": "WDIMTM — What Does It Mean To Me?",
      "meta.description":
        "Browser-native AI for the moment you see something on the web and think: what does this mean to me? Select text. Stay on the page. Understand.",
      "meta.ogDescription":
        "Select anything on a page. Get a concise, personal explanation — without leaving the tab.",
      "nav.aria": "Primary",
      "nav.why": "Why",
      "nav.how": "How",
      "nav.lenses": "Lenses",
      "nav.access": "Access",
      "nav.install": "Install",
      "nav.github": "GitHub",
      "nav.cta": "Get the extension",
      "nav.homeAria": "WDIMTM home",
      "lang.aria": "Language",
      "lang.en": "EN",
      "lang.zh": "中文",

      "hero.eyebrow": "Browser-native · select → understand",
      "hero.titleHtml": "What does it<br /><em>mean to me?</em>",
      "hero.ledeHtml":
        "WDIMTM is an AI explainer for the moment you hit something confusing on the web. Stay on the page. Select the text. Get a short answer that respects <em>your</em> context — not a generic chatbot dump.",
      "hero.install": "Install the extension",
      "hero.source": "View source",
      "hero.meta1Html": "<strong>Chrome MV3</strong> extension",
      "hero.meta2Html": "<strong>BYOK</strong> OpenAI-compatible or Claude",
      "hero.meta3Html": "<strong>No prompt</strong> required",

      "mock.pageTitle": "Hot keys & distributed caches",
      "mock.p1":
        "Memcached is another distributed, in-memory key–value cache, often used as a simpler alternative to Redis.",
      "mock.sel":
        "Switching from Redis to Memcached does not automatically solve a hot-key problem: a single extremely popular key can overload the one cache node responsible for it.",
      "mock.p3":
        "Typical mitigations include replicating the value across nodes, splitting one logical key into multiple keys, client-side caching, or request coalescing.",
      "mock.explain": "Explain",
      "mock.lens": "Engineering",
      "mock.popoverTitle": "What does it mean to me?",
      "mock.groundingLabel": "Grounding",
      "mock.grounding":
        "Sharding by key still pins one hot key to a single node — changing cache product doesn’t remove that load concentration.",
      "mock.forYouLabel": "For you",
      "mock.forYou":
        "You own session-cache infra: treat “hot key” as an architecture smell, not a Redis-vs-Memcached debate.",
      "mock.chip1": "What is a hot key?",
      "mock.chip2": "Implementation trade-offs?",
      "mock.chip3": "Remember this",
      "mock.meta": "via openai-compatible · engineering",

      "why.kicker": "The problem",
      "why.title": "Chatbots make you leave the moment",
      "why.body":
        "Most AI tools force a detour: copy, switch app, invent a prompt, paste, wait. WDIMTM is built for the opposite — stay in the flow of reading.",
      "why.badTitle": "Typical AI workflow",
      "why.bad1": "See something confusing",
      "why.bad2": "Copy text",
      "why.bad3": "Switch to ChatGPT / Claude",
      "why.bad4": "Write a prompt",
      "why.bad5": "Paste context again…",
      "why.goodTitle": "WDIMTM",
      "why.good1": "See something confusing",
      "why.good2": "Select it on the page",
      "why.good3Html": "Understand — with your lens &amp; memory",

      "how.kicker": "How it works",
      "how.title": "One selection. Your lens. Personal relevance.",
      "how.body":
        "Page facts, your profile, relevant memories and the active lens compose into one OpenAI-compatible request — returning a concise explanation, predicted follow-ups, and an optional memory suggestion. When a short answer is not enough, the same context escalates into a conversation.",
      "how.f1.title": "Bounded page context",
      "how.f1.body":
        "Uses the selection and its neighbourhood — never the full DOM. Fast, private, and grounded in what you’re actually reading.",
      "how.f2.title": "Lenses, not prompts",
      "how.f2.body":
        "Explain, Sanity check, Fact check, Opportunities, Engineering, Investing. WDIMTM can suggest the lens from the selection, or you pin one and it stops guessing.",
      "how.f3.titleHtml": "What it means <em>to you</em>",
      "how.f3.body":
        "Optional profile + memories shape implications. No forced personalization — if nothing personal applies, you still get a clean explanation.",
      "how.f4.title": "From answer to conversation",
      "how.f4.body":
        "Follow-up chips are derived from the content, not the same three buttons forever. When one tap isn’t enough, Discuss further opens a page chat carrying the same selection and context.",
      "how.f5.title": "Live evidence, only when asked",
      "how.f5.body":
        "Verify, Research and page chat can pull fresh web snippets through your own Tavily, Brave or Serper key. Ordinary Explain stays offline and single-shot.",
      "how.f6.title": "User-controlled memory",
      "how.f6.body":
        "Suggestions only. Nothing is saved until you confirm. Inspect, edit, forget, or switch memory off entirely.",
      "how.f7.title": "Start from what you already said",
      "how.f7.body":
        "Import a ChatGPT or Claude export and WDIMTM distills it into candidate memories. Reviewed one by one before anything is saved, read in the page only, never written to disk, never sent to a server of ours.",
      "how.f8.title": "Screenshots are questions too",
      "how.f8.body":
        "Take a system screenshot and paste it straight into the page chat — or upload, or drag it in. No text prompt required, and no screen-capture permission: the extension never records your screen itself.",
      "how.f9.title": "Off where you want it off",
      "how.f9.body":
        "One switch in the toolbar turns WDIMTM off for the site you are on, and the denylist keeps it off. Nothing is read on a site you excluded — the content script never activates there.",

      "lenses.kicker": "Lenses",
      "lenses.title": "Same text. Different questions.",
      "lenses.body":
        "A fee switch headline means one thing to an engineer and another to an investor. Lenses encode that without making you prompt-engineer.",
      "lenses.general": "Explain",
      "lenses.generalDesc": "Plain-language unpacking",
      "lenses.sanity": "Sanity check",
      "lenses.sanityDesc": "Logic, plausibility, missing pieces",
      "lenses.fact": "Fact check",
      "lenses.factDesc": "Checkable claims and what would verify them",
      "lenses.opp": "Opportunities",
      "lenses.oppDesc": "Incentives, mispricing, monetisation",
      "lenses.eng": "Engineering",
      "lenses.engDesc": "Architecture, trade-offs, failure modes",
      "lenses.invest": "Investing",
      "lenses.investDesc": "Risk, thesis, competitive dynamics",
      "lenses.note":
        "…plus custom lenses written in your own words, and edits to any built-in.",

      "access.kicker": "Access",
      "access.title": "You bring the model. We bring the moment.",
      "access.body":
        "WDIMTM owns context and personalization — not your GPU bill. Choose how inference is paid for.",
      "access.byok.tag": "Recommended",
      "access.byok.title": "Bring your own key",
      "access.byok.body":
        "Any OpenAI-compatible API — OpenAI, OpenRouter, a local model, your own gateway — or Anthropic directly with a Claude key. One request per explain, streaming supported, and you pay the provider rather than us.",
      "access.byok.runtime": "Runtime ids:",
      "access.cloud.tag": "Not open yet",
      "access.cloud.title": "WDIMTM Cloud",
      "access.cloud.body":
        "An optional hosted mode for people who would rather not hold a key: managed inference, memory that syncs across devices, and research that keeps running after the tab closes. Same extension, same answers — it changes who pays and where the key lives. Local and bring-your-own-key stay free, permanently.",
      "access.cloud.runtime": "Runtime id:",

      "install.kicker": "Install",
      "install.title": "Build it and load it",
      "install.body":
        "Not on the Chrome Web Store yet. Install from source — Chrome or any Chromium, developer mode, about three minutes.",
      "install.s1.title": "Clone and build",
      "install.s1.bodyHtml":
        "Then <code>npm install &amp;&amp; npm run build</code>. The loadable extension is <code>dist/</code>, which the build produces — there is nothing to load before you run it.",
      "install.s2.title": "Load the extension",
      "install.s2.bodyHtml":
        "Open <code>chrome://extensions</code> → enable Developer mode → <strong>Load unpacked</strong> → select the <code>dist/</code> folder.",
      "install.s3.title": "Add your key",
      "install.s3.bodyHtml":
        "Open WDIMTM Options → <strong>AI access</strong> → <strong>Use my own API key</strong>, and pick an OpenAI-compatible endpoint or Anthropic. Hit <strong>Test connection</strong>, save, then select text on any page. Until you do this you get sample answers, clearly labelled as such.",

      "cta.title": "Stop translating confusion into prompts",
      "cta.body":
        "Select what you don’t understand. Get a short, personal explanation — without leaving the tab.",
      "cta.install": "Install the extension",
      "cta.star": "Star on GitHub",

      "footer.contract": "Runtime contract",
      "footer.access": "Access modes",
      "footer.privacy": "Privacy",
      "footer.tagline": "What does it mean to me?",
    },

    zh_CN: {
      "meta.title": "WDIMTM — 于我何意",
      "meta.description":
        "浏览器原生 AI：当你在网上看到一段内容，想问「于我何意」——选中文字，留在当前页，立刻理解。",
      "meta.ogDescription": "在任意网页选中内容，获得简洁、贴合你的解释——无需离开当前标签页。",
      "nav.aria": "主导航",
      "nav.why": "为何",
      "nav.how": "原理",
      "nav.lenses": "镜头",
      "nav.access": "接入",
      "nav.install": "安装",
      "nav.github": "GitHub",
      "nav.cta": "获取扩展",
      "nav.homeAria": "WDIMTM 首页",
      "lang.aria": "语言",
      "lang.en": "EN",
      "lang.zh": "中文",

      "hero.eyebrow": "浏览器原生 · 选中 → 理解",
      "hero.titleHtml": "于我<br /><em>何意</em>",
      "hero.ledeHtml":
        "WDIMTM 是一个面向「网页上突然看不懂」时刻的 AI 解释器。留在当前页，选中文字，得到尊重<strong>你的</strong>语境的短答——而不是通用聊天机器人的长篇堆砌。",
      "hero.install": "安装扩展",
      "hero.source": "查看源码",
      "hero.meta1Html": "<strong>Chrome MV3</strong> 扩展",
      "hero.meta2Html": "<strong>自带密钥</strong> OpenAI 兼容或 Claude",
      "hero.meta3Html": "<strong>无需写提示词</strong>",

      "mock.pageTitle": "热 key 与分布式缓存",
      "mock.p1":
        "Memcached 是另一种分布式内存键值缓存，常被视为比 Redis 更简单的替代方案。",
      "mock.sel":
        "从 Redis 换成 Memcached 并不会自动解决热 key 问题：一个极热门的 key 仍可能压垮负责它的那一个缓存节点。",
      "mock.p3":
        "常见缓解手段包括跨节点复制该值、把一个逻辑 key 拆成多个 key、客户端缓存，或请求合并。",
      "mock.explain": "解释",
      "mock.lens": "工程视角",
      "mock.popoverTitle": "于我何意",
      "mock.groundingLabel": "事实依据",
      "mock.grounding":
        "按 key 分片仍会把热 key 钉在单一节点——换缓存产品并不会消掉这种负载集中。",
      "mock.forYouLabel": "与你相关",
      "mock.forYou":
        "你负责会话/缓存基建：应把「热 key」当成架构异味，而不是 Redis vs Memcached 之争。",
      "mock.chip1": "什么是热 key？",
      "mock.chip2": "实现上的权衡？",
      "mock.chip3": "记住这个",
      "mock.meta": "via openai-compatible · 工程视角",

      "why.kicker": "问题",
      "why.title": "聊天机器人逼你离开当下",
      "why.body":
        "多数 AI 工具都要绕路：复制、切应用、编提示词、粘贴、等待。WDIMTM 反其道而行——留在阅读流里。",
      "why.badTitle": "典型 AI 流程",
      "why.bad1": "看到不懂的内容",
      "why.bad2": "复制文字",
      "why.bad3": "切到 ChatGPT / Claude",
      "why.bad4": "写一段提示词",
      "why.bad5": "再粘贴一遍上下文…",
      "why.goodTitle": "WDIMTM",
      "why.good1": "看到不懂的内容",
      "why.good2": "在页面上选中它",
      "why.good3Html": "理解——带着你的镜头与记忆",

      "how.kicker": "原理",
      "how.title": "一次选中。你的镜头。与你相关。",
      "how.body":
        "页面事实、你的画像、相关记忆与当前镜头，合成一次 OpenAI 兼容请求——返回简洁解释、预测追问，以及可选的记忆建议。当一段短答不够时，同一份上下文可以直接升级成对话。",
      "how.f1.title": "有边界的页面上下文",
      "how.f1.body":
        "只用选区与它的邻域——从不抓整页 DOM。更快、更私密，且锚定你正在读的内容。",
      "how.f2.title": "用镜头，而不是写提示词",
      "how.f2.body":
        "通俗解释、有没有道理、核实主张、找机会、工程视角、投资视角。WDIMTM 可以按选区自动推荐镜头，也可以钉住一个，它就不再猜。",
      "how.f3.titleHtml": "它<em>对你</em>意味着什么",
      "how.f3.body":
        "可选的画像与记忆塑造「所以呢」。不强行个性化——没有个人信息时，仍会给出干净的解释。",
      "how.f4.title": "从答案到对话",
      "how.f4.body":
        "追问芯片来自内容本身，不是永远那三个按钮。点一下还不够时，「深入对话」会带着同一份选区与上下文打开页面对话。",
      "how.f5.title": "要证据时才联网",
      "how.f5.body":
        "核实、研究与页面对话可以用你自己的 Tavily / Brave / Serper 密钥抓取实时网页片段。普通的「解释」仍然离线、单次调用。",
      "how.f6.title": "用户可控的记忆",
      "how.f6.body": "只给建议。你确认前什么都不存。可查看、编辑、遗忘，或彻底关闭记忆。",
      "how.f7.title": "从你已经说过的话开始",
      "how.f7.body":
        "导入 ChatGPT 或 Claude 的导出记录，WDIMTM 会把它提炼成候选记忆。保存前逐条审阅，只在页面内读取，从不写入磁盘，也从不发往我们的服务器。",
      "how.f8.title": "截图也是提问",
      "how.f8.body":
        "系统截图之后直接粘贴进页面对话，也可以上传或拖入。不需要配文字，也不需要任何录屏权限——扩展从不自己抓取你的屏幕。",
      "how.f9.title": "该关的地方就关掉",
      "how.f9.body":
        "工具栏上一个开关就能在当前网站停用 WDIMTM，禁用列表会让它一直保持关闭。被排除的网站上什么都不会被读取——内容脚本根本不会激活。",

      "lenses.kicker": "镜头",
      "lenses.title": "同一段文字。不同的问题。",
      "lenses.body":
        "一条费率切换的标题，对工程师和投资人含义完全不同。镜头替你编码这些视角，不必自己提示词工程。",
      "lenses.general": "通俗解释",
      "lenses.generalDesc": "把话说明白",
      "lenses.sanity": "有没有道理",
      "lenses.sanityDesc": "逻辑、可信度、缺了什么",
      "lenses.fact": "核实主张",
      "lenses.factDesc": "哪些说法可核验，怎么验",
      "lenses.opp": "找机会",
      "lenses.oppDesc": "激励、错价、变现",
      "lenses.eng": "工程视角",
      "lenses.engDesc": "架构、权衡、失效模式",
      "lenses.invest": "投资视角",
      "lenses.investDesc": "风险、论点、竞争格局",
      "lenses.note": "……以及你用自己的话写下的自定义镜头，内置镜头也都可以改。",

      "access.kicker": "接入",
      "access.title": "模型你来带。场景我们守。",
      "access.body": "WDIMTM 负责上下文与个性化——不负责你的算力账单。推理如何付费由你选。",
      "access.byok.tag": "推荐",
      "access.byok.title": "自带 API Key",
      "access.byok.body":
        "任意 OpenAI 兼容 API —— OpenAI、OpenRouter、本地模型、自建网关 —— 或者用 Claude 密钥直连 Anthropic。每次解释一次请求，支持流式，费用直接付给服务商而不是我们。",
      "access.byok.runtime": "运行时 id：",
      "access.cloud.tag": "尚未开放",
      "access.cloud.title": "WDIMTM Cloud",
      "access.cloud.body":
        "给不想自己管密钥的人准备的可选托管模式：托管推理、跨设备同步的记忆，以及关掉标签页也会继续跑的研究任务。同一个扩展、同样的答案 —— 变的只是谁付钱、密钥放在哪。本地模式与自带密钥永久免费。",
      "access.cloud.runtime": "运行时 id：",

      "install.kicker": "安装",
      "install.title": "构建，然后加载",
      "install.body":
        "暂未上架 Chrome 应用商店。请从源码安装 —— Chrome 或任意 Chromium，开发者模式，约三分钟。",
      "install.s1.title": "克隆并构建",
      "install.s1.bodyHtml":
        "然后执行 <code>npm install &amp;&amp; npm run build</code>。可加载的扩展是构建产物 <code>dist/</code> —— 没跑构建之前没有东西可加载。",
      "install.s2.title": "加载扩展",
      "install.s2.bodyHtml":
        "打开 <code>chrome://extensions</code> → 开启开发者模式 → <strong>加载已解压的扩展程序</strong> → 选择 <code>dist/</code> 目录。",
      "install.s3.title": "填入你的密钥",
      "install.s3.bodyHtml":
        "打开 WDIMTM 选项 → <strong>AI 接入</strong> → <strong>使用我自己的 API Key</strong>，选择 OpenAI 兼容端点或 Anthropic。点<strong>测试连接</strong>，保存，然后在任意页面选中文字。在此之前你看到的都是明确标注的示例答案。",

      "cta.title": "别再把困惑翻译成提示词",
      "cta.body": "选中你看不懂的内容。得到简短、贴合你的解释——无需离开标签页。",
      "cta.install": "安装扩展",
      "cta.star": "在 GitHub 上 Star",

      "footer.contract": "运行时约定",
      "footer.access": "接入方式",
      "footer.privacy": "隐私政策",
      "footer.tagline": "于我何意",
    },
  };

  /**
   * @param {string | null | undefined} raw
   * @returns {"en" | "zh_CN"}
   */
  function normalizeLang(raw) {
    if (!raw) return "en";
    const s = String(raw).trim().replace(/-/g, "_");
    if (s === "zh" || s === "zh_CN" || s === "zh_Hans" || s.toLowerCase().startsWith("zh")) {
      return "zh_CN";
    }
    if (s === "en" || s.toLowerCase().startsWith("en")) return "en";
    return SUPPORTED.includes(s) ? /** @type {"en"|"zh_CN"} */ (s) : "en";
  }

  /** @returns {"en" | "zh_CN"} */
  function detectLang() {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("lang");
      if (q) return normalizeLang(q);
    } catch {
      /* ignore */
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return normalizeLang(stored);
    } catch {
      /* ignore */
    }
    const nav =
      (navigator.languages && navigator.languages[0]) ||
      navigator.language ||
      navigator.userLanguage ||
      "en";
    return normalizeLang(nav);
  }

  /**
   * @param {"en" | "zh_CN"} lang
   * @param {string} key
   */
  function t(lang, key) {
    return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  }

  /**
   * @param {"en" | "zh_CN"} lang
   */
  function apply(lang) {
    const dict = STRINGS[lang] || STRINGS.en;
    document.documentElement.lang = lang === "zh_CN" ? "zh-CN" : "en";
    document.documentElement.dataset.lang = lang;

    const title = dict["meta.title"];
    if (title) document.title = title;

    const desc = document.querySelector('meta[name="description"]');
    if (desc && dict["meta.description"]) desc.setAttribute("content", dict["meta.description"]);

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && dict["meta.title"]) ogTitle.setAttribute("content", dict["meta.title"]);

    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc && dict["meta.ogDescription"]) {
      ogDesc.setAttribute("content", dict["meta.ogDescription"]);
    }

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key || dict[key] == null) return;
      el.textContent = dict[key];
    });

    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (!key || dict[key] == null) return;
      el.innerHTML = dict[key];
    });

    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      if (!key || dict[key] == null) return;
      el.setAttribute("aria-label", dict[key]);
    });

    document.querySelectorAll("[data-lang-option]").forEach((btn) => {
      const opt = btn.getAttribute("data-lang-option");
      const active = opt === lang || (opt === "zh_CN" && lang === "zh_CN");
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }

    // Keep ?lang= in URL without reload noise when user switches
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("lang") !== lang) {
        url.searchParams.set("lang", lang === "zh_CN" ? "zh" : "en");
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    } catch {
      /* ignore */
    }
  }

  function bindSwitcher() {
    document.querySelectorAll("[data-lang-option]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = normalizeLang(btn.getAttribute("data-lang-option"));
        apply(next);
      });
    });
  }

  const initial = detectLang();
  // Apply ASAP if DOM ready; otherwise wait
  function boot() {
    apply(initial);
    bindSwitcher();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Expose for debugging
  window.WDIMTM_I18N = { apply, detectLang, t, STRINGS, normalizeLang };
})();
