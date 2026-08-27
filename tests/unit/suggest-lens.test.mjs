import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveActiveLens, suggestLens } from "../../core/suggest-lens.js";

describe("suggestLens", () => {
  it("picks engineering for code-heavy selection", () => {
    const r = suggestLens({
      selection:
        "const cache = new Redis(); latency spikes when a hot key pins one shard in Memcached.",
      pageTitle: "Caching notes",
      pageUrl: "https://github.com/acme/infra",
    });
    assert.equal(r.id, "engineering");
    assert.ok(r.confidence >= 0.42);
  });

  it("picks investing for valuation language", () => {
    const r = suggestLens({
      selection: "ARR doubled to $40M with 75% gross margin; burn rate still high.",
      pageTitle: "Series B memo",
    });
    assert.equal(r.id, "investing");
  });

  it("picks opportunities for arbitrage / incentives", () => {
    const r = suggestLens({
      selection: "这里可能存在 cross-exchange arbitrage 与激励错配带来的套利空间",
      pageTitle: "市场笔记",
    });
    assert.equal(r.id, "opportunities");
  });

  it("picks fact-check for multi-number claims", () => {
    const r = suggestLens({
      selection:
        "According to the study, revenue hit $2.4 billion in 2024, up 38% YoY, while costs fell 12%.",
      pageTitle: "Earnings",
    });
    assert.equal(r.id, "fact-check");
  });

  it("falls back to general when signal is weak", () => {
    const r = suggestLens({
      selection: "The weather was nice and we walked by the river.",
      pageTitle: "Diary",
    });
    assert.equal(r.id, "general");
  });

  it("biases toward engineering when profile says engineer", () => {
    const plain = suggestLens({
      selection: "We need better distribution for this product wedge.",
      pageTitle: "Notes",
    });
    const eng = suggestLens({
      selection: "We need better distribution for this product wedge.",
      pageTitle: "Notes",
      profileText: "Staff engineer building infra platforms",
    });
    // Profile alone may not win over weak opportunity signal, but engineering score rises
    assert.ok((eng.scores?.engineering || 0) > (plain.scores?.engineering || 0));
  });
});

describe("resolveActiveLens", () => {
  it("manual mode always uses default or pinned lens", () => {
    const r = resolveActiveLens({
      lensMode: "manual",
      defaultLensId: "investing",
      selection: "const x = new Redis()",
    });
    assert.equal(r.lensId, "investing");
    assert.equal(r.source, "manual");
  });

  it("manual mode honors explicit pin over default", () => {
    const r = resolveActiveLens({
      lensMode: "manual",
      defaultLensId: "general",
      manualLensId: "sanity",
      selection: "const x = 1",
    });
    assert.equal(r.lensId, "sanity");
  });

  it("auto mode suggests from selection when not pinned", () => {
    const r = resolveActiveLens({
      lensMode: "auto",
      defaultLensId: "general",
      selection: "Kubernetes deploy failed with OOMKill on the API pod",
      pageUrl: "https://github.com/acme/app",
    });
    assert.equal(r.lensId, "engineering");
    assert.ok(r.source === "auto" || r.source === "default");
  });

  it("auto mode still honors an explicit pin", () => {
    const r = resolveActiveLens({
      lensMode: "auto",
      manualLensId: "fact-check",
      selection: "const redis = require('redis')",
    });
    assert.equal(r.lensId, "fact-check");
    assert.equal(r.source, "manual");
  });
});
