import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFollowUps,
  defaultFollowUps,
  extractFollowUpsTrailer,
  normalizeFollowUps,
  suggestContentFollowUps,
  suggestMemory,
  enrichResponse,
} from "../../core/followups.js";

describe("follow-ups", () => {
  it("normalizes string and object follow-ups", () => {
    const a = normalizeFollowUps(["Explain more", "Remember this"]);
    assert.equal(a[0].intent, "more");
    assert.equal(a[1].intent, "remember");
    const b = normalizeFollowUps([{ id: "x", label: "Verify", intent: "verify" }]);
    assert.equal(b[0].intent, "verify");
  });

  it("defaults include remember", () => {
    const d = defaultFollowUps("explain", { zh: true });
    assert.ok(d.some((f) => f.intent === "remember"));
    assert.ok(d.some((f) => f.label.includes("展开") || f.intent === "more"));
  });

  it("suggests memory for arbitrage selections", () => {
    const s = suggestMemory({
      selection: "这里可能存在 cross-exchange arbitrage 和激励错配",
      page: { title: "market notes" },
      mode: "explain",
      lens: { id: "opportunities" },
    });
    assert.ok(s);
    assert.equal(s.type, "interest");
  });

  it("enrichResponse attaches structured followUps", () => {
    const r = enrichResponse({ explanation: "hi", followUps: [] }, "explain", false, {
      selection: "Redis is an in-memory cache used for sessions.",
    });
    assert.ok(r.followUps.length >= 3);
    assert.equal(typeof r.followUps[0].intent, "string");
  });

  it("suggests content-aware chips for Memcached/Redis selection", () => {
    const chips = suggestContentFollowUps({
      selection:
        "Memcached is another distributed, in-memory key–value cache, often used as a simpler alternative to Redis. A single extremely popular key can overload the one cache node.",
      explanation: "Hot keys can pin load to one shard.",
      lensId: "engineering",
      zh: false,
    });
    assert.ok(chips.length >= 1);
    // Should surface term or comparison / engineering probes
    const labels = chips.map((c) => c.label).join(" ");
    assert.ok(
      /Memcached|Redis|alternative|trade-off|mechanism|numbers|hot/i.test(labels) ||
        chips.some((c) => c.intent === "probe" || c.intent === "simplify"),
      `unexpected chips: ${labels}`
    );
  });

  it("buildFollowUps prefers content probes over pure generics", () => {
    const merged = buildFollowUps([], {
      selection:
        "Switching from Redis to Memcached does not automatically solve hot-key overload: a popular key pins one node.",
      explanation: "Sharding by key still concentrates load for one hot key.",
      mode: "explain",
      zh: false,
      lensId: "engineering",
    });
    assert.ok(merged.length >= 3);
    assert.ok(merged.some((f) => f.intent === "discuss" || f.intent === "remember"));
    assert.ok(
      merged.some((f) => f.intent === "probe" || /Memcached|Redis|trade|implement/i.test(f.label)),
      `expected a content-specific chip, got: ${merged.map((f) => f.label).join(", ")}`
    );
  });

  it("extracts and strips model FOLLOWUPS trailer", () => {
    const raw = [
      "Memcached is a simple distributed cache.",
      "",
      "Hot keys still pin load to one node.",
      "",
      "<<<WDIMTM_FOLLOWUPS>>>",
      "What is a hot key?",
      "How does consistent hashing help?",
      "<<<END>>>",
    ].join("\n");
    const { explanation, followUps } = extractFollowUpsTrailer(raw);
    assert.ok(!explanation.includes("WDIMTM_FOLLOWUPS"));
    assert.ok(explanation.includes("Memcached"));
    assert.equal(followUps.length, 2);
    assert.equal(followUps[0].intent, "probe");
    assert.match(followUps[0].label, /hot key/i);
  });

  it("extracts memory trailer without dumping long text", async () => {
    const { extractResponseTrailers } = await import(
      "../../core/followups.js"
    );
    const raw = [
      "Answer body here.",
      "<<<WDIMTM_FOLLOWUPS>>>",
      "What next?",
      "<<<END>>>",
      "<<<WDIMTM_MEMORY>>>",
      '{"type":"interest","content":"I track cache hot-key mitigations","reason":"selection"}',
      "<<<END>>>",
    ].join("\n");
    const parsed = extractResponseTrailers(raw);
    assert.equal(parsed.explanation.includes("Answer body"), true);
    assert.ok(!parsed.explanation.includes("WDIMTM_MEMORY"));
    assert.equal(parsed.memorySuggestion?.type, "interest");
    assert.match(parsed.memorySuggestion?.content || "", /hot-key/);
  });
});

