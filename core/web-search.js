/**
 * Optional web search for verify / research modes and page chat.
 * Providers: tavily | brave | serper | none
 */

/**
 * @typedef {Object} WebSearchHit
 * @property {string} title
 * @property {string} url
 * @property {string} snippet
 *
 * @typedef {Object} WebSearchResult
 * @property {boolean} used
 * @property {string} provider
 * @property {string} query
 * @property {WebSearchHit[]} hits
 * @property {string} [error]
 */

/**
 * @param {string} selection
 * @param {string} [pageTitle]
 * @returns {string}
 */
export function buildSearchQuery(selection, pageTitle = "") {
  const sel = String(selection || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
  const title = String(pageTitle || "").trim().slice(0, 80);
  if (!sel) return title || "";
  // Prefer selection; add title only if it adds distinct tokens
  if (title && !sel.toLowerCase().includes(title.toLowerCase().slice(0, 20))) {
    return `${sel} ${title}`.slice(0, 320);
  }
  return sel;
}

/**
 * Query for page chat: prefer the latest user turn, ground with selection/title.
 * @param {string} userMessage
 * @param {string} [selection]
 * @param {string} [pageTitle]
 * @returns {string}
 */
export function buildChatSearchQuery(userMessage, selection = "", pageTitle = "") {
  const q = String(userMessage || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
  if (!q) return buildSearchQuery(selection, pageTitle);
  const sel = String(selection || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const title = String(pageTitle || "").trim().slice(0, 60);
  let out = q;
  if (sel && !q.toLowerCase().includes(sel.toLowerCase().slice(0, 24))) {
    out = `${q} ${sel}`.slice(0, 320);
  }
  if (title && !out.toLowerCase().includes(title.toLowerCase().slice(0, 20))) {
    out = `${out} ${title}`.slice(0, 340);
  }
  return out;
}

/**
 * @param {string} mode
 * @param {string} [lensId]
 * @returns {boolean}
 */
export function modeWantsWebSearch(mode, lensId = "") {
  const m = String(mode || "").toLowerCase();
  if (
    m === "verify" ||
    m === "research" ||
    m === "fact-check" ||
    m === "factcheck" ||
    m === "chat"
  ) {
    return true;
  }
  if (lensId === "fact-check" && (m === "explain" || m === "more")) return true;
  return false;
}

/**
 * @param {{
 *   provider: string,
 *   apiKey: string,
 *   query: string,
 *   maxResults?: number,
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<WebSearchResult>}
 */
export async function runWebSearch(opts) {
  const provider = String(opts.provider || "none").toLowerCase();
  const apiKey = String(opts.apiKey || "").trim();
  const query = String(opts.query || "").trim();
  const maxResults = Math.min(8, Math.max(1, Number(opts.maxResults) || 5));
  // Must preserve `this` for WorkerGlobalScope.fetch — bare `globalThis.fetch`
  // extracted as a free function throws "Illegal invocation" in service workers.
  const fetchImpl =
    opts.fetchImpl ||
    ((input, init) => globalThis.fetch(input, init));

  /** @type {WebSearchResult} */
  const empty = {
    used: false,
    provider,
    query,
    hits: [],
  };

  if (!query) {
    return { ...empty, error: "empty_query" };
  }
  if (provider === "none" || !provider) {
    return { ...empty, error: "provider_disabled" };
  }
  if (!apiKey) {
    return { ...empty, error: "missing_api_key" };
  }
  if (typeof fetchImpl !== "function") {
    return { ...empty, error: "no_fetch" };
  }

  try {
    if (provider === "tavily") {
      return await searchTavily({ apiKey, query, maxResults, fetchImpl });
    }
    if (provider === "brave") {
      return await searchBrave({ apiKey, query, maxResults, fetchImpl });
    }
    if (provider === "serper") {
      return await searchSerper({ apiKey, query, maxResults, fetchImpl });
    }
    return { ...empty, error: `unknown_provider:${provider}` };
  } catch (err) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Format hits for the model context builder.
 * @param {WebSearchResult} result
 * @returns {string}
 */
export function formatWebEvidence(result) {
  if (!result?.hits?.length) {
    if (result?.error) {
      return `(web search unavailable: ${result.error})`;
    }
    return "(no web results)";
  }
  return result.hits
    .map((h, i) => {
      const title = h.title || "(no title)";
      const url = h.url || "";
      const snip = (h.snippet || "").replace(/\s+/g, " ").trim().slice(0, 320);
      return `[${i + 1}] ${title}\nURL: ${url}\n${snip}`;
    })
    .join("\n\n");
}

/**
 * Whether settings allow a live search attempt.
 * @param {{
 *   webSearchEnabled?: boolean,
 *   webSearchProvider?: string,
 *   webSearchApiKey?: string,
 * }} settings
 */
export function isWebSearchConfigured(settings) {
  const provider = String(settings?.webSearchProvider || "none").toLowerCase();
  const key = String(settings?.webSearchApiKey || "").trim();
  // Master switch must be on; provider + key required.
  return (
    settings?.webSearchEnabled === true &&
    provider !== "none" &&
    provider !== "" &&
    Boolean(key)
  );
}

/**
 * Human-readable search failure for UI and prompts.
 * @param {string} [error]
 * @param {{ zh?: boolean }} [opts]
 * @returns {string}
 */
export function humanizeSearchError(error, opts = {}) {
  const zh = Boolean(opts.zh);
  const e = String(error || "").toLowerCase();
  if (!error) {
    return zh ? "未知错误" : "Unknown error";
  }
  if (e === "provider_disabled" || e.includes("provider_disabled")) {
    return zh
      ? "未选择搜索提供商（Options → Web search）"
      : "No search provider selected (Options → Web search)";
  }
  if (e === "missing_api_key" || e.includes("missing_api_key")) {
    return zh
      ? "缺少搜索 API Key（Options → Web search）"
      : "Missing search API key (Options → Web search)";
  }
  if (e === "empty_query") {
    return zh ? "搜索词为空" : "Empty search query";
  }
  if (e.includes("401") || e.includes("403") || e.includes("unauthorized")) {
    return zh
      ? `搜索鉴权失败（检查 API Key）：${error}`
      : `Search auth failed (check API key): ${error}`;
  }
  if (e.includes("429") || e.includes("quota") || e.includes("rate")) {
    return zh ? `搜索配额/限流：${error}` : `Search rate limit / quota: ${error}`;
  }
  if (e.includes("illegal invocation")) {
    return zh
      ? "扩展内部 fetch 调用错误（请更新扩展后重试）"
      : "Internal fetch binding error (reload the extension and retry)";
  }
  if (e.includes("failed to fetch") || e.includes("network") || e.includes("offline")) {
    return zh
      ? `无法连接搜索服务（网络或 host permission）：${error}`
      : `Cannot reach search API (network or host permission): ${error}`;
  }
  return String(error);
}

/**
 * Short status line for chat UI.
 * @param {{
 *   status?: string,
 *   used?: boolean,
 *   provider?: string,
 *   resultCount?: number,
 *   error?: string,
 *   query?: string,
 * } | null | undefined} meta
 * @param {{ zh?: boolean }} [opts]
 */
export function formatSearchStatusLabel(meta, opts = {}) {
  const zh = Boolean(opts.zh);
  if (!meta || meta.status === "off" || meta.status === "not_configured") {
    return zh
      ? "网页搜索：未开启（Options → Web search）"
      : "Web search: off (Options → Web search)";
  }
  if (meta.status === "failed" || (meta.error && !meta.used)) {
    const why = humanizeSearchError(meta.error, { zh });
    return zh ? `网页搜索失败：${why}` : `Web search failed: ${why}`;
  }
  if (meta.used || meta.status === "ok") {
    const n = meta.resultCount ?? 0;
    const p = meta.provider || "web";
    return zh ? `网页搜索：${p} · ${n} 条` : `Web search: ${p} · ${n} hits`;
  }
  if (meta.status === "empty") {
    return zh ? "网页搜索：无结果" : "Web search: no results";
  }
  return zh ? "网页搜索：—" : "Web search: —";
}

/** @param {{ apiKey: string, query: string, maxResults: number, fetchImpl: typeof fetch }} p */
async function searchTavily(p) {
  const res = await p.fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: p.apiKey,
      query: p.query,
      search_depth: "basic",
      max_results: p.maxResults,
      include_answer: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`tavily_http_${res.status}:${body.slice(0, 120)}`);
  }
  const data = await res.json();
  const hits = (data.results || []).slice(0, p.maxResults).map((r) => ({
    title: String(r.title || ""),
    url: String(r.url || ""),
    snippet: String(r.content || r.snippet || ""),
  }));
  return {
    used: hits.length > 0,
    provider: "tavily",
    query: p.query,
    hits,
  };
}

/** @param {{ apiKey: string, query: string, maxResults: number, fetchImpl: typeof fetch }} p */
async function searchBrave(p) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", p.query);
  url.searchParams.set("count", String(p.maxResults));
  const res = await p.fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": p.apiKey,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`brave_http_${res.status}:${body.slice(0, 120)}`);
  }
  const data = await res.json();
  const raw = data.web?.results || data.results || [];
  const hits = raw.slice(0, p.maxResults).map((r) => ({
    title: String(r.title || ""),
    url: String(r.url || r.link || ""),
    snippet: String(r.description || r.snippet || ""),
  }));
  return {
    used: hits.length > 0,
    provider: "brave",
    query: p.query,
    hits,
  };
}

/** @param {{ apiKey: string, query: string, maxResults: number, fetchImpl: typeof fetch }} p */
async function searchSerper(p) {
  const res = await p.fetchImpl("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": p.apiKey,
    },
    body: JSON.stringify({ q: p.query, num: p.maxResults }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`serper_http_${res.status}:${body.slice(0, 120)}`);
  }
  const data = await res.json();
  const organic = data.organic || [];
  const hits = organic.slice(0, p.maxResults).map((r) => ({
    title: String(r.title || ""),
    url: String(r.link || r.url || ""),
    snippet: String(r.snippet || ""),
  }));
  return {
    used: hits.length > 0,
    provider: "serper",
    query: p.query,
    hits,
  };
}
