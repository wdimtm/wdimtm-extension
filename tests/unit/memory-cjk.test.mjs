import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createLocalMemoryProvider } from "../../extension/lib/memory.js";
import { queryTokens } from "../../core/memory-tokens.js";

function stubStorage() {
  const local = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          const out = { ...(defaults || {}) };
          for (const k of Object.keys(defaults || {})) if (k in local) out[k] = local[k];
          return out;
        },
        async set(patch) { Object.assign(local, patch); },
      },
    },
  };
}

describe("queryTokens", () => {
  it("yields keywords for a Chinese-only query", () => {
    const tokens = queryTokens("我想了解向量数据库的索引");
    assert.ok(tokens.length > 0);
    assert.ok(tokens.includes("向量"));
    assert.ok(tokens.includes("数据"));
    assert.ok(tokens.includes("索引"));
  });

  it("handles a single Chinese character", () => {
    assert.deepEqual(queryTokens("猫"), ["猫"]);
  });

  it("splits mixed Chinese and Latin text and keeps the old length floor for Latin", () => {
    const tokens = queryTokens("用 Postgres 做 RAG 检索");
    assert.ok(tokens.includes("postgres"));
    assert.ok(tokens.includes("检索"));
    assert.equal(tokens.includes("rag"), true);
    assert.equal(tokens.includes("做"), false);
  });

  it("still returns nothing for punctuation only", () => {
    assert.deepEqual(queryTokens("？！ ... ,"), []);
  });
});

describe("memory search with Chinese queries", () => {
  beforeEach(stubStorage);

  it("ranks the relevant Chinese memory first", async () => {
    const provider = createLocalMemoryProvider();
    await provider.add({ type: "note", text: "喜欢周末去爬山和徒步", confidence: 1 });
    await provider.add({ type: "note", text: "正在学习向量数据库的索引原理", confidence: 1 });
    await provider.add({ type: "note", text: "常用咖啡豆是埃塞俄比亚的", confidence: 1 });
    const hits = await provider.search("向量数据库怎么建索引", 3);
    assert.equal(hits[0].text, "正在学习向量数据库的索引原理");
  });
});
