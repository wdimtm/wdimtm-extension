import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExplainContext,
  buildModelMessages,
  buildUserPrompt,
  personalizationSummary,
} from "../../core/explain-context.js";
import { capabilityForMode, normalizeMode } from "../../core/modes.js";

describe("modes", () => {
  it("normalizes legacy why → why_it_matters", () => {
    assert.equal(normalizeMode("why"), "why_it_matters");
    assert.equal(normalizeMode("opportunities"), "opportunity");
    assert.equal(normalizeMode("explain"), "explain");
  });

  it("marks verify/research as current web_search tools; opportunity remains future", () => {
    assert.equal(capabilityForMode("verify").status, "current");
    assert.deepEqual(capabilityForMode("verify").tools, ["web_search"]);
    assert.equal(capabilityForMode("research").status, "current");
    assert.deepEqual(capabilityForMode("research").tools, ["web_search"]);
    assert.equal(capabilityForMode("opportunity").status, "future");
    assert.equal(capabilityForMode("explain").kind, "single_shot");
    assert.equal(capabilityForMode("explain").status, "current");
  });
});

describe("explain context builder", () => {
  const basePage = {
    url: "https://example.com/post",
    title: "Hot keys and Memcached",
    context: "Discussing cache sharding and single-key overload.",
  };

  it("separates profile from non-profile memories", () => {
    const ctx = buildExplainContext({
      selection: "A popular key can overload one cache node.",
      page: basePage,
      profile: "I am a backend engineer working on Redis.",
      memories: [
        { type: "interest", content: "I track distributed caching patterns" },
        { type: "profile", content: "Should not replace explicit profile if set" },
      ],
      mode: "explain",
      lens: { id: "engineering", instructions: "Focus on trade-offs." },
    });
    assert.equal(ctx.flags.hasProfile, true);
    assert.equal(ctx.flags.hasMemories, true);
    assert.equal(ctx.flags.personalization, "rich");
    assert.equal(ctx.profile.includes("backend engineer"), true);
    assert.ok(ctx.memories.every((m) => m.type !== "profile"));
    assert.equal(ctx.mode, "explain");
  });

  it("general vs personalized prompts differ clearly", () => {
    const general = buildExplainContext({
      selection: "Memcached is a simpler alternative to Redis.",
      page: basePage,
      mode: "explain",
      lens: { id: "general" },
    });
    const personalized = buildExplainContext({
      selection: "Memcached is a simpler alternative to Redis.",
      page: basePage,
      mode: "explain",
      profile: "Staff engineer owning cache infra at a consumer app.",
      memories: [{ type: "goal", content: "Reduce p99 latency for session store" }],
      lens: { id: "engineering", instructions: "Architecture trade-offs." },
    });

    const gPrompt = buildUserPrompt(general);
    const pPrompt = buildUserPrompt(personalized);

    assert.match(gPrompt, /## PAGE FACTS/);
    assert.match(gPrompt, /## USER PROFILE/);
    assert.match(gPrompt, /\(none provided\)/);
    assert.match(gPrompt, /\(none\)/); // memories

    assert.match(pPrompt, /Staff engineer/);
    assert.match(pPrompt, /Reduce p99 latency/);
    assert.ok(!pPrompt.includes("(none provided)"));
    assert.notEqual(gPrompt, pPrompt);

    const gSys = buildModelMessages(general)[0].content;
    const pSys = buildModelMessages(personalized)[0].content;
    assert.match(gSys, /What does this mean to me/);
    assert.match(gSys, /no user profile\/memories/i);
    assert.match(pSys, /profile \+ memories are present/i);

    assert.equal(personalizationSummary(general).personalization, "none");
    assert.equal(personalizationSummary(personalized).personalization, "rich");
  });

  it("passes mode and probe question into the task section", () => {
    const ctx = buildExplainContext({
      selection: "fee switch next week",
      page: basePage,
      mode: "why",
      lens: { id: "investing" },
    });
    assert.equal(ctx.mode, "why_it_matters");
    assert.match(buildUserPrompt(ctx), /mode: why_it_matters/);

    const probe = buildExplainContext({
      selection: "fee switch next week",
      page: basePage,
      mode: "probe",
      followUpQuestion: "How does this affect token holders?",
      lens: { id: "investing" },
    });
    assert.match(buildUserPrompt(probe), /How does this affect token holders/);
  });

  it("works with no memories and no profile", () => {
    const ctx = buildExplainContext({
      selection: "hello world",
      page: { url: "https://x.com", title: "t" },
    });
    assert.equal(ctx.flags.personalization, "none");
    const messages = buildModelMessages(ctx);
    assert.equal(messages.length, 2);
    assert.ok(messages[1].content.includes("hello world"));
  });
});
