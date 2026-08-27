import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  createLocalMemoryProvider,
  createNoneMemoryProvider,
  MEMORY_LIMIT,
  toExplainMemories,
} from "../../extension/lib/memory.js";

function installChromeMock() {
  /** @type {Record<string, unknown>} */
  const local = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          if (typeof defaults === "string") {
            return { [defaults]: local[defaults] };
          }
          const out = { ...defaults };
          for (const k of Object.keys(defaults)) {
            if (k in local) out[k] = local[k];
          }
          return out;
        },
        async set(obj) {
          Object.assign(local, obj);
        },
      },
    },
  };
  return local;
}

describe("memory providers", () => {
  beforeEach(() => {
    installChromeMock();
  });

  it("none provider rejects add and returns empty search", async () => {
    const p = createNoneMemoryProvider();
    assert.deepEqual(await p.list(), []);
    assert.deepEqual(await p.search("x"), []);
    await assert.rejects(() => p.add({ type: "note", text: "hi" }), /disabled/i);
  });

  it("local provider stores, searches, and removes", async () => {
    const p = createLocalMemoryProvider();
    await p.add({ type: "interest", text: "DeFi arbitrage opportunities", source: "explicit" });
    await p.add({ type: "goal", text: "Ship WDIMTM MVP", source: "explicit" });
    const all = await p.list();
    assert.equal(all.length, 2);

    const hit = await p.search("arbitrage liquidity", 5);
    assert.ok(hit.some((m) => m.text.includes("arbitrage")));

    const id = all[0].id;
    assert.equal(await p.remove(id), true);
    assert.equal((await p.list()).length, 1);

    await p.clear();
    assert.equal((await p.list()).length, 0);
  });

  it("ranks a low-confidence import below an equally matching explicit memory", async () => {
    const p = createLocalMemoryProvider();
    await p.add({ type: "interest", text: "DeFi liquidation incentives", source: "explicit" });
    await p.add({
      type: "interest",
      text: "DeFi liquidation incentives",
      source: "inferred",
      confidence: 0.6,
    });

    const hits = await p.search("DeFi liquidation incentives", 5);
    assert.equal(hits[0].source, "explicit");
  });

  it("treats a memory stored before confidence existed as fully trusted", async () => {
    const store = installChromeMock();
    // A record written by the pre-#49 code path: no confidence field at all.
    store["wdimtm.memories"] = [
      {
        id: "legacy",
        type: "interest",
        text: "DeFi liquidation incentives",
        source: "explicit",
        createdAt: "",
        updatedAt: "",
      },
    ];

    const p = createLocalMemoryProvider();
    await p.add({
      type: "interest",
      text: "DeFi liquidation incentives",
      source: "inferred",
      confidence: 0.6,
    });

    const hits = await p.search("DeFi liquidation incentives", 5);
    assert.equal(hits[0].id, "legacy", "legacy records must not be demoted by the new scoring");
  });

  it("addMany commits a batch and reports what it stored", async () => {
    const p = createLocalMemoryProvider();
    const stored = await p.addMany([
      { type: "interest", text: "A", source: "inferred", confidence: 0.7 },
      { type: "goal", text: "B", source: "inferred", confidence: 0.9 },
    ]);
    assert.equal(stored.length, 2);
    const all = await p.list();
    assert.equal(all.length, 2);
    assert.equal(all.find((m) => m.text === "A").confidence, 0.7);
  });

  it("caps stored memories at MEMORY_LIMIT", async () => {
    const p = createLocalMemoryProvider();
    const many = Array.from({ length: MEMORY_LIMIT + 20 }, (_, i) => ({
      type: /** @type {const} */ ("note"),
      text: `memory ${i}`,
    }));
    await p.addMany(many);
    assert.equal((await p.list()).length, MEMORY_LIMIT);
  });

  it("toExplainMemories merges profile + memories", () => {
    const out = toExplainMemories("Staff engineer", [
      {
        id: "1",
        type: "interest",
        text: "AI products",
        source: "explicit",
        createdAt: "",
        updatedAt: "",
      },
    ]);
    assert.equal(out[0].type, "profile");
    assert.equal(out[1].content, "AI products");
  });
});
