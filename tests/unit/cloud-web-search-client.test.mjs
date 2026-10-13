/**
 * The extension side of #141: in WDIMTM Cloud mode the extension never
 * searches (no user key needed, no double search) and shows the search the
 * server ran. BYOK keeps searching with the user's own key.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { buildChatSystemPrompt, buildChatWebSearchSection } from "../../core/chat-prompt.js";
import { chat, explain } from "../../core/runtime/adapter.js";
import { toPromptaasInputs } from "../../core/runtime/research/index.js";
import { DEFAULT_SETTINGS } from "../../core/settings-defaults.js";
import { chatSearchMeta, humanizeSearchError } from "../../core/web-search.js";
import { OPTIONS_STRINGS } from "../../extension/lib/options-i18n.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A user who also has a BYOK search key configured — Cloud must not use it. */
const SEARCH_SETTINGS = {
  webSearchEnabled: true,
  webSearchProvider: "tavily",
  webSearchApiKey: "tvly-user-key",
  webSearchMaxResults: 5,
  stream: false,
  memoryProvider: "none",
};

const CLOUD = {
  ...DEFAULT_SETTINGS,
  ...SEARCH_SETTINGS,
  runtime: "wdimtm-cloud",
  cloudBaseUrl: "https://cloud.test",
  cloudAccessToken: "tok",
};

const BYOK = {
  ...DEFAULT_SETTINGS,
  ...SEARCH_SETTINGS,
  runtime: "openai-compatible",
  apiBaseUrl: "https://llm.test/v1",
  apiKey: "sk-user",
  model: "gpt-4o-mini",
};

const REQUEST = {
  selection: "Sovereign AI budgets are rising in the EU",
  page: { url: "https://example.com/post", title: "EU AI spend" },
  lens: { id: "general" },
};

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** @param {(href: string, body: any) => Response | undefined} [route] */
function stubFetch(route) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: href, body });
    const routed = route?.(href, body);
    if (routed) return routed;
    if (href === "https://api.tavily.com/search") {
      return jsonResponse({ results: [{ title: "T", url: "https://news.example/a", content: "c" }] });
    }
    if (href.endsWith("/chat/completions")) {
      return jsonResponse({ choices: [{ message: { content: "BYOK answer." } }] });
    }
    throw new Error(`unexpected fetch: ${href}`);
  };
  return calls;
}

const tavily = (calls) => calls.filter((c) => c.url.includes("api.tavily.com"));

describe("Cloud mode: the extension does not search", () => {
  it("explain (verify) sends no evidence and reports the server's search", async () => {
    const serverSearch = { used: true, provider: "tavily", resultCount: 4 };
    const calls = stubFetch((href) =>
      href === "https://cloud.test/v1/explain"
        ? jsonResponse({ explanation: "Cloud answer.", meta: { webSearch: serverSearch } })
        : undefined
    );
    const res = await explain({ ...REQUEST, mode: "verify" }, { settings: CLOUD });

    assert.equal(tavily(calls).length, 0, "no client-side search in Cloud mode");
    const sent = calls.find((c) => c.url === "https://cloud.test/v1/explain").body;
    assert.equal(sent.webEvidence, undefined);
    assert.equal(sent.webSearchMeta, undefined);
    assert.equal(JSON.stringify(sent).includes("tvly-user-key"), false);
    assert.deepEqual(res.meta.webSearch, serverSearch);
  });

  it("chat hands search to the server with the switch, selection and title", async () => {
    const serverSearch = { used: true, status: "ok", provider: "tavily", resultCount: 3, query: "q" };
    const calls = stubFetch((href) =>
      href === "https://cloud.test/v1/chat"
        ? jsonResponse({ reply: "Cloud chat.", meta: { webSearch: serverSearch } })
        : undefined
    );
    const res = await chat(
      { ...REQUEST, messages: [{ role: "user", content: "latest news?" }] },
      { settings: CLOUD }
    );

    assert.equal(tavily(calls).length, 0);
    const sent = calls.find((c) => c.url === "https://cloud.test/v1/chat").body;
    assert.deepEqual(sent.search, {
      enabled: true,
      selection: REQUEST.selection,
      pageTitle: "EU AI spend",
      answerLanguage: sent.search.answerLanguage,
    });
    assert.doesNotMatch(sent.system, /## WEB SEARCH STATUS/, "the server appends that section");
    assert.equal(JSON.stringify(sent).includes("tvly-user-key"), false);
    assert.deepEqual(res.webSearch, serverSearch);
  });

  it("chat passes the switch through when it is off", async () => {
    const calls = stubFetch((href) =>
      href === "https://cloud.test/v1/chat" ? jsonResponse({ reply: "ok" }) : undefined
    );
    await chat(
      { ...REQUEST, messages: [{ role: "user", content: "hi" }] },
      { settings: { ...CLOUD, webSearchEnabled: false, webSearchApiKey: "" } }
    );
    const sent = calls.find((c) => c.url === "https://cloud.test/v1/chat").body;
    assert.equal(sent.search.enabled, false);
  });
});

describe("BYOK mode keeps the user's own search", () => {
  it("explain (verify) searches with the user's key", async () => {
    const calls = stubFetch();
    const res = await explain({ ...REQUEST, mode: "verify" }, { settings: BYOK });
    const [search] = tavily(calls);
    assert.equal(search.body.api_key, "tvly-user-key");
    assert.equal(res.meta.webSearch.used, true);
  });

  it("chat searches with the user's key and builds the search section itself", async () => {
    const calls = stubFetch();
    const res = await chat(
      { ...REQUEST, messages: [{ role: "user", content: "latest news?" }] },
      { settings: BYOK }
    );
    assert.equal(tavily(calls).length, 1);
    const llm = calls.find((c) => c.url.endsWith("/chat/completions")).body;
    assert.match(llm.messages[0].content, /## WEB SEARCH STATUS\nstatus: ok/);
    assert.equal(res.webSearch.status, "ok");
  });
});

describe("chat prompt search section", () => {
  const base = { selection: "claim X", page: { url: "https://example.com", title: "t" } };

  it("is left to the server when delegated", () => {
    const s = buildChatSystemPrompt({ ...base, webSearchMeta: { used: false, status: "delegated" } });
    assert.doesNotMatch(s, /## WEB SEARCH STATUS/);
  });

  it("is unchanged for BYOK", () => {
    const meta = { used: true, status: "ok", provider: "tavily", resultCount: 1 };
    const evidence = "[1] Source\nURL: https://news.example/a\nSnippet";
    const s = buildChatSystemPrompt({ ...base, webSearchMeta: meta, webEvidence: evidence });
    assert.ok(s.endsWith(`\n${buildChatWebSearchSection(meta, evidence)}`));
    assert.match(s, /Selected text:\nclaim X\n## WEB SEARCH STATUS\nstatus: ok\nprovider: tavily\nresultCount: 1\n## WEB EVIDENCE/);
  });

  it("never sends a Cloud user to find a provider or API key", () => {
    const off = buildChatWebSearchSection({ used: false, status: "off" }, undefined, { cloud: true });
    assert.match(off, /no API key needed/);
    assert.doesNotMatch(off, /provider \+ API key/);
    const failed = buildChatWebSearchSection(
      { used: false, status: "failed", error: "tavily_http_500" },
      undefined,
      { cloud: true }
    );
    assert.doesNotMatch(failed, /provider \+ API key/);
    assert.match(failed, /try(ing)? again later/i);
  });
});

describe("search helpers shared by BYOK and Cloud", () => {
  it("chatSearchMeta describes ok / failed / empty", () => {
    assert.equal(
      chatSearchMeta({ used: true, provider: "tavily", query: "q", hits: [{ url: "u" }] }).status,
      "ok"
    );
    const failed = chatSearchMeta({ used: false, provider: "tavily", query: "q", hits: [], error: "tavily_http_429" });
    assert.equal(failed.status, "failed");
    assert.match(failed.humanError, /rate limit/i);
    assert.equal(chatSearchMeta({ used: false, provider: "tavily", query: "q", hits: [] }).status, "empty");
  });

  it("search_unavailable does not point at Options", () => {
    assert.doesNotMatch(humanizeSearchError("search_unavailable"), /Options/);
    assert.match(humanizeSearchError("search_unavailable", { zh: true }), /暂不可用/);
  });
});

describe("research brief evidence", () => {
  const input = { goal: "g", mode: "deep_research", selection: "s", page: { url: "u", title: "t" } };

  it("carries pre-fetched evidence in the brief, not as a flat input", () => {
    const withEvidence = toPromptaasInputs({ ...input, webEvidence: "[1] T\nURL: https://news.example/a" });
    assert.match(withEvidence.messages[1].content, /WEB EVIDENCE\n\[1\] T\nURL: https:\/\/news\.example\/a$/);
    assert.equal("web_evidence" in withEvidence, false);
    const without = toPromptaasInputs(input);
    assert.match(without.messages[1].content, /WEB EVIDENCE\n$/);
  });
});

describe("Options: web search in Cloud mode", () => {
  const html = readFileSync(new URL("../../extension/options/options.html", import.meta.url), "utf8");

  it("has the Cloud note, and keeps provider/key inside the BYOK-only wrapper", () => {
    assert.match(html, /id="web-search-cloud-note" data-i18n="webSearchCloudIncluded" hidden/);
    const start = html.indexOf('<div id="web-search-byok-fields">');
    const end = html.indexOf("</div>", start);
    assert.ok(start > 0);
    const wrapped = html.slice(start, end);
    for (const id of ["webSearchProvider", "webSearchApiKey", "webSearchMaxResults"]) {
      assert.ok(wrapped.includes(`id="${id}"`), `${id} hides in Cloud mode`);
    }
    assert.equal(wrapped.includes('id="webSearchEnabled"'), false, "the switch stays visible");
  });

  it("translates the new strings", () => {
    for (const key of ["webSearchCloudIncluded", "webSearchEnabledCloud", "privacy4c"]) {
      assert.ok(OPTIONS_STRINGS.en[key], key);
      assert.ok(OPTIONS_STRINGS.zh_CN[key], key);
    }
  });
});
