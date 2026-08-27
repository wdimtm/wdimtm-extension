import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionKeyForUrl, buildChatSystemPrompt } from "../../extension/lib/chat.js";
import { defaultFollowUps } from "../../core/followups.js";
import { buildChatSearchQuery, modeWantsWebSearch } from "../../core/web-search.js";
import { runChat } from "../../core/runtime/chat.js";

describe("page chat", () => {
  it("includes discuss further and summarize in default follow-ups", () => {
    const fus = defaultFollowUps("explain", { zh: true });
    assert.ok(fus.some((f) => f.intent === "discuss"));
    assert.ok(fus.some((f) => f.intent === "summarize"));
    assert.ok(fus.some((f) => f.label.includes("深入") || f.intent === "discuss"));
  });

  it("builds stable session keys", () => {
    const a = sessionKeyForUrl("https://x.com/foo/status/1?s=20#x");
    const b = sessionKeyForUrl("https://x.com/foo/status/1?s=99");
    assert.equal(a, b);
  });

  it("builds system prompt with selection", () => {
    const s = buildChatSystemPrompt({
      selection: "bonding curve volume",
      page: { url: "https://example.com", title: "t", context: "ctx" },
      lens: { id: "general", instructions: "plain" },
    });
    assert.ok(s.includes("bonding curve"));
    assert.ok(s.includes("ctx"));
  });

  it("injects WEB EVIDENCE into chat system prompt when search ok", () => {
    const s = buildChatSystemPrompt({
      selection: "claim X",
      page: { url: "https://example.com", title: "t" },
      webEvidence: "[1] Source\nURL: https://news.example/a\nSnippet",
      webSearchMeta: { used: true, status: "ok", provider: "tavily", resultCount: 1 },
    });
    assert.match(s, /## WEB SEARCH STATUS/);
    assert.match(s, /status: ok/);
    assert.match(s, /## WEB EVIDENCE/);
    assert.match(s, /news\.example/);
    assert.match(s, /tavily/);
  });

  it("tells model search is off instead of inventing API errors", () => {
    const s = buildChatSystemPrompt({
      selection: "claim X",
      page: { url: "https://example.com", title: "t" },
      webSearchMeta: { used: false, status: "not_configured" },
    });
    assert.match(s, /status: not_configured/);
    assert.match(s, /NOT configured/i);
    assert.doesNotMatch(s, /## WEB EVIDENCE/);
  });

  it("surfaces failed search status for the model", () => {
    const s = buildChatSystemPrompt({
      selection: "claim X",
      page: { url: "https://example.com", title: "t" },
      webSearchMeta: {
        used: false,
        status: "failed",
        provider: "tavily",
        error: "tavily_http_401:bad key",
        humanError: "Search auth failed",
      },
    });
    assert.match(s, /status: failed/);
    assert.match(s, /Search auth failed|tavily_http_401/);
  });

  it("mode chat wants web search", () => {
    assert.equal(modeWantsWebSearch("chat"), true);
  });

  it("buildChatSearchQuery prefers user message", () => {
    const q = buildChatSearchQuery(
      "Is this supply chain claim accurate?",
      "ASML EUV monopoly",
      "Tech note"
    );
    assert.match(q, /supply chain claim/i);
    assert.match(q, /ASML/);
  });

  it("mock chat returns a reply", async () => {
    const res = await runChat(
      {
        selection: "ASML 光刻机供应链",
        page: { url: "https://example.com", title: "note" },
        lens: { id: "sanity" },
        messages: [{ role: "user", content: "这有没有道理？" }],
        answerLanguage: "zh_CN",
      },
      { runtime: "mock", languageInstruction: "Write in Simplified Chinese." }
    );
    assert.ok(res.reply.length > 20);
    assert.equal(res.runtime, "mock");
  });

  it("mock chat streams via onChunk and includes web evidence note", async () => {
    /** @type {string[]} */
    const chunks = [];
    const res = await runChat(
      {
        selection: "hot key overload",
        page: { url: "https://example.com", title: "cache" },
        lens: { id: "general" },
        messages: [{ role: "user", content: "Does this hold up?" }],
        answerLanguage: "en",
        webEvidence: "[1] Hot keys\nURL: https://docs.example/hot\nA hot key concentrates load.",
        webSearchMeta: {
          used: true,
          status: "ok",
          provider: "tavily",
          resultCount: 1,
        },
      },
      {
        runtime: "mock",
        languageInstruction: "Write in English.",
        onChunk: (t) => chunks.push(t),
      }
    );
    assert.ok(chunks.length > 0);
    assert.equal(chunks.join(""), res.reply);
    assert.match(res.reply, /WEB EVIDENCE/i);
    assert.equal(res.webSearch?.used, true);
  });
});
