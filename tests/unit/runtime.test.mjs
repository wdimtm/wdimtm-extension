import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { explainWithMock } from "../../core/runtime/mock.js";
import {
  MAX_CONTEXT,
  MAX_SELECTION,
  assertBoundedRequest,
  sliceAroundMatch,
  truncate,
} from "../../core/context-bounds.js";
import {
  resolveLens,
  createCustomLens,
  BUILTIN_LENSES,
  updateCustomLens,
  setLensOverride,
  clearLensOverride,
  listManageableLenses,
  forkLens,
} from "../../core/lenses.js";
import http from "node:http";

describe("mock runtime", () => {
  it("returns a short explanation for a selection", async () => {
    const res = await explainWithMock({
      selection: "bonding curve launch cleared $2M notional volume",
      page: {
        url: "http://127.0.0.1:4173/demo.html",
        title: "WDIMTM demo",
        context: "Traders are arguing about early volume on a new L2.",
      },
      lens: { id: "opportunities" },
    });

    assert.equal(res.runtime, "mock");
    assert.ok(res.explanation.includes("bonding curve"));
    // Structured follow-ups are attached by the runtime adapter (enrichResponse).
    assert.ok(Array.isArray(res.followUps));
  });

  it("supports more / why / verify modes", async () => {
    const base = {
      selection: "fee switch activates next week",
      page: { url: "https://example.com", title: "t" },
      lens: { id: "general" },
    };
    const more = await explainWithMock({ ...base, mode: "more" });
    const why = await explainWithMock({ ...base, mode: "why" });
    const why2 = await explainWithMock({ ...base, mode: "why_it_matters" });
    const verify = await explainWithMock({ ...base, mode: "verify" });
    assert.ok(more.explanation.includes("Deeper"));
    assert.ok(why.explanation.toLowerCase().includes("matter"));
    assert.ok(why2.explanation.toLowerCase().includes("matter"));
    assert.ok(verify.explanation.toLowerCase().includes("verif"));
  });

  it("personalizes mock output when profile/memories exist", async () => {
    const base = {
      selection: "bonding curve launch cleared $2M notional volume",
      page: { url: "https://example.com", title: "t" },
      lens: { id: "opportunities" },
    };
    const plain = await explainWithMock(base);
    const personalized = await explainWithMock({
      ...base,
      profile: "Crypto-native investor focused on L2 fee markets",
      memories: [{ type: "interest", content: "I track fee-switch catalysts" }],
    });
    assert.ok(plain.explanation.includes("For you") || plain.explanation.includes("对你而言"));
    assert.ok(
      personalized.explanation.includes("Crypto-native") ||
        personalized.explanation.includes("fee-switch") ||
        personalized.explanation.includes("profile")
    );
    assert.notEqual(plain.explanation, personalized.explanation);
  });

  it("streams chunks when onChunk provided", async () => {
    const chunks = [];
    const res = await explainWithMock(
      {
        selection: "hello world selection",
        page: { url: "https://example.com", title: "t" },
      },
      { onChunk: (t) => chunks.push(t) }
    );
    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(""), res.explanation);
  });

  it("replies in Chinese for CJK selections", async () => {
    const res = await explainWithMock({
      selection:
        "这是所有社媒绑架创作者的底层逻辑，整个流量池好像一个赌场",
      page: { url: "https://x.com/foo", title: "首页 / X" },
      lens: { id: "general" },
    });
    assert.ok(res.explanation.includes("选区") || res.explanation.includes("字"));
    assert.ok(!res.explanation.includes("1 words"));
    assert.ok(res.explanation.includes("Mock 运行时") || res.explanation.includes("流量"));
  });
});

describe("lenses", () => {
  it("resolves built-in and custom lenses", () => {
    const custom = [createCustomLens("Hiring", "Focus on candidate signal.")];
    const r = resolveLens({ id: custom[0].id }, "general", custom);
    assert.equal(r.instructions.includes("candidate"), true);
    const g = resolveLens(undefined, "engineering", custom);
    assert.equal(g.id, "engineering");
    assert.ok(BUILTIN_LENSES.length >= 6);
    assert.ok(BUILTIN_LENSES.some((l) => l.id === "sanity"));
  });

  it("applies built-in overrides when resolving", () => {
    const overrides = setLensOverride({}, "sanity", {
      instructions: "Be extra skeptical about incentives.",
    });
    const r = resolveLens({ id: "sanity" }, "general", [], overrides);
    assert.match(r.instructions, /extra skeptical/);
    const cleared = clearLensOverride(overrides, "sanity");
    const stock = resolveLens({ id: "sanity" }, "general", [], cleared);
    assert.ok(stock.instructions.includes("reasonable"));
  });

  it("updates and forks custom lenses", () => {
    const custom = [createCustomLens("Hiring", "Focus on signal.")];
    const updated = updateCustomLens(custom[0].id, { instructions: "Focus on red flags." }, custom);
    assert.equal(updated[0].instructions, "Focus on red flags.");
    const forked = forkLens(BUILTIN_LENSES.find((l) => l.id === "opportunities"));
    assert.equal(forked.builtin, false);
    assert.ok(forked.id.startsWith("custom-"));
    assert.ok(forked.instructions.includes("arbitrage") || forked.instructions.length > 10);
  });

  it("lists manageable lenses with override flags", () => {
    const list = listManageableLenses(
      [createCustomLens("X", "y")],
      { general: { instructions: "tweaked" } }
    );
    assert.ok(list.some((l) => l.id === "general" && l.overridden));
    assert.ok(list.some((l) => l.kind === "custom"));
  });
});

describe("bounded context rules", () => {
  it("truncates oversized selection/context", () => {
    const long = "x".repeat(MAX_SELECTION + 500);
    const t = truncate(long, MAX_SELECTION);
    assert.equal(t.length, MAX_SELECTION);
    assert.ok(t.endsWith("…"));
  });

  it("slices neighborhood instead of whole document", () => {
    const prefix = "a".repeat(5000);
    const needle = "UNIQUE_SIGNAL_TOKEN";
    const suffix = "b".repeat(5000);
    const whole = prefix + needle + suffix;
    const slice = sliceAroundMatch(whole, needle, 100);
    assert.ok(slice.length < 500);
    assert.ok(slice.includes(needle));
  });

  it("rejects unbounded explain payloads", () => {
    assert.throws(
      () =>
        assertBoundedRequest({
          selection: "ok",
          page: { context: "c".repeat(MAX_CONTEXT + 1) },
        }),
      /context exceeds/
    );
  });
});

describe("runtime isolation contract", () => {
  it("content script source does not import provider SDKs", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve(import.meta.dirname, "../..");
    const content = await fs.readFile(
      path.join(root, "extension/content/content.js"),
      "utf8"
    );
    assert.equal(content.includes("api.openai.com"), false);
    assert.equal(content.includes("apiKey"), false);
    assert.ok(content.includes("wdimtm:explain"));
    assert.ok(content.includes("followup"));
  });

  it("adapter is the only explain entry used by service worker", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve(import.meta.dirname, "../..");
    const sw = await fs.readFile(
      path.join(root, "extension/background/service-worker.js"),
      "utf8"
    );
    assert.ok(sw.includes('from "../../core/runtime/adapter.js"'));
    assert.equal(sw.includes("openai-compatible.js"), false);
  });
});

