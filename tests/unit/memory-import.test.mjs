import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDistillBatches,
  buildDistillPrompt,
  estimateTokens,
  extractJsonArray,
  fingerprintConversations,
  parseDistillResponse,
  renderConversation,
} from "../../core/memory-import/distill.js";
import {
  buildProfileBatches,
  buildProfilePrompt,
  parseProfileResponse,
  PROFILE_CONFIDENCE,
} from "../../core/memory-import/profile.js";
import {
  buildMergePrompt,
  confidenceFor,
  dedupeLexical,
  normalizeForCompare,
  parseMergeResponse,
  rankForReview,
  splitForReduce,
} from "../../core/memory-import/merge.js";

/**
 * @param {string} id
 * @param {string} title
 * @param {number} [assistantChars]
 */
function conversation(id, title, assistantChars = 50) {
  return {
    id,
    title,
    createdAt: "2026-01-01T00:00:00.000Z",
    turns: [
      { role: "user", text: `question about ${title}` },
      { role: "assistant", text: "y".repeat(assistantChars) },
    ],
  };
}

/**
 * @param {Partial<import('../../core/memory-sources/types.js').MemoryCandidate>} patch
 */
function candidate(patch = {}) {
  return {
    type: "interest",
    text: "I work on DeFi protocol design",
    evidenceTitles: ["A"],
    confidence: 0.8,
    ...patch,
  };
}

describe("renderConversation", () => {
  it("truncates the assistant side far harder than the user side", () => {
    const rendered = renderConversation(
      {
        id: "x",
        title: "T",
        createdAt: "",
        turns: [
          { role: "user", text: "u".repeat(1500) },
          { role: "assistant", text: "a".repeat(1500) },
        ],
      },
      1
    );
    const userLine = rendered.split("\n").find((l) => l.startsWith("user:"));
    const assistantLine = rendered.split("\n").find((l) => l.startsWith("assistant:"));
    assert.ok(userLine.length > 1400, "user turn kept");
    assert.ok(assistantLine.length < 400, "assistant turn truncated");
  });

  it("escapes quotes and newlines out of the title attribute", () => {
    const rendered = renderConversation(
      { id: "x", title: 'weird "title"\nsecond line', createdAt: "", turns: [{ role: "user", text: "hi" }] },
      1
    );
    const first = rendered.split("\n")[0];
    assert.equal(first.startsWith('<conversation n="1" title="'), true);
    assert.equal(first.endsWith('">'), true);
    assert.equal(first.split('"').length, 5, "no stray quotes inside the attribute");
  });
});

describe("buildDistillBatches", () => {
  it("is deterministic", () => {
    const input = [conversation("a", "Alpha"), conversation("b", "Beta")];
    assert.deepEqual(buildDistillBatches(input), buildDistillBatches(input));
  });

  it("splits on the character budget and restarts numbering per batch", () => {
    const input = [
      conversation("a", "Alpha", 400),
      conversation("b", "Beta", 400),
      conversation("c", "Gamma", 400),
    ];
    const batches = buildDistillBatches(input, { batchChars: 600 });
    assert.ok(batches.length > 1);
    for (const batch of batches) {
      assert.ok(batch.text.includes('n="1"'), "each batch numbers from 1");
    }
    assert.deepEqual(
      batches.flatMap((b) => b.conversations.map((c) => c.id)),
      ["a", "b", "c"],
      "no conversation is lost or reordered"
    );
  });

  it("gives an oversized conversation its own batch rather than dropping it", () => {
    const batches = buildDistillBatches(
      [conversation("a", "Alpha", 100), conversation("big", "Huge", 20000)],
      { batchChars: 500 }
    );
    assert.equal(batches.length, 2);
    assert.equal(batches[1].conversations[0].id, "big");
  });

  it("returns no batches for no conversations", () => {
    assert.deepEqual(buildDistillBatches([]), []);
  });
});

describe("estimateTokens", () => {
  it("charges CJK text more per character than Latin text", () => {
    const latin = estimateTokens("a".repeat(60));
    const cjk = estimateTokens("模".repeat(60));
    assert.ok(cjk > latin, `expected CJK (${cjk}) to exceed Latin (${latin})`);
  });
});

describe("fingerprintConversations", () => {
  it("is stable for the same conversations and changes when they differ", () => {
    const a = [conversation("a", "Alpha"), conversation("b", "Beta")];
    const b = [conversation("a", "Alpha"), conversation("c", "Gamma")];
    assert.equal(fingerprintConversations(a), fingerprintConversations(a));
    assert.notEqual(fingerprintConversations(a), fingerprintConversations(b));
  });
});

describe("extractJsonArray", () => {
  it("survives markdown fences and surrounding prose", () => {
    assert.deepEqual(extractJsonArray('Sure!\n```json\n[{"a":1}]\n```\nHope that helps'), [{ a: 1 }]);
  });

  it("returns null for unusable output", () => {
    assert.equal(extractJsonArray("no json here"), null);
    assert.equal(extractJsonArray("[{broken"), null);
    assert.equal(extractJsonArray(undefined), null);
  });
});

describe("parseDistillResponse", () => {
  const batch = buildDistillBatches([conversation("a", "Alpha"), conversation("b", "Beta")])[0];

  it("maps conversation numbers back to titles", () => {
    const out = parseDistillResponse('[{"type":"interest","text":"I like X","from":[2],"confidence":0.9}]', batch);
    assert.deepEqual(out[0].evidenceTitles, ["Beta"]);
    assert.equal(out[0].confidence, 0.9);
  });

  it("falls back to note for an unknown type and drops empty text", () => {
    const out = parseDistillResponse('[{"type":"nonsense","text":"I like X"},{"text":"  "}]', batch);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "note");
  });

  it("ignores out-of-range conversation numbers", () => {
    const out = parseDistillResponse('[{"type":"note","text":"I like X","from":[99]}]', batch);
    assert.deepEqual(out[0].evidenceTitles, []);
  });

  it("returns null when the response is unusable, so the batch can be retried", () => {
    assert.equal(parseDistillResponse("the model apologized instead", batch), null);
  });
});

describe("buildDistillPrompt", () => {
  it("sends the batch body as the user turn", () => {
    const batch = buildDistillBatches([conversation("a", "Alpha")])[0];
    const prompt = buildDistillPrompt(batch);
    assert.ok(prompt.system.includes("JSON array"));
    assert.equal(prompt.user, batch.text);
  });
});

describe("confidenceFor", () => {
  it("stays below explicit memories and rises with support", () => {
    assert.ok(confidenceFor(1) < 1);
    assert.ok(confidenceFor(30) <= 0.9);
    assert.ok(confidenceFor(10) > confidenceFor(2));
  });

  it("saturates rather than growing without bound", () => {
    assert.equal(confidenceFor(10), confidenceFor(1000));
  });
});

describe("dedupeLexical", () => {
  it("collapses duplicates that differ only in punctuation or case", () => {
    const out = dedupeLexical([
      candidate({ text: "I work on DeFi protocol design", evidenceTitles: ["A"] }),
      candidate({ text: "i work on defi protocol design.", evidenceTitles: ["B"] }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].supportCount, 2);
    assert.deepEqual(out[0].evidenceTitles, ["A", "B"]);
  });

  it("collapses near-duplicates above the overlap threshold", () => {
    const out = dedupeLexical([
      candidate({ text: "I work on DeFi protocol design" }),
      candidate({ text: "I work on DeFi protocol design today" }),
    ]);
    assert.equal(out.length, 1);
  });

  it("keeps the same wording apart when the type differs", () => {
    const out = dedupeLexical([
      candidate({ type: "interest", text: "DeFi incentives" }),
      candidate({ type: "knowledge", text: "DeFi incentives" }),
    ]);
    assert.equal(out.length, 2);
  });

  it("drops candidates that normalize to nothing", () => {
    assert.deepEqual(dedupeLexical([candidate({ text: "!!!" })]), []);
  });
});

describe("splitForReduce", () => {
  it("keeps everything in one group when it fits", () => {
    const groups = splitForReduce(dedupeLexical([candidate(), candidate({ text: "I ship products" })]));
    assert.equal(groups.length, 1);
  });

  it("groups by type once the budget is exceeded", () => {
    const many = [];
    for (let i = 0; i < 40; i += 1) {
      many.push(candidate({ type: "interest", text: `interest number ${i} ${"x".repeat(40)}` }));
      many.push(candidate({ type: "goal", text: `goal number ${i} ${"y".repeat(40)}` }));
    }
    const groups = splitForReduce(dedupeLexical(many), { budgetChars: 600 });
    assert.ok(groups.length > 1);
    for (const group of groups) {
      assert.equal(new Set(group.map((c) => c.type)).size, 1, "a group holds one type");
    }
  });

  it("returns nothing for no candidates", () => {
    assert.deepEqual(splitForReduce([]), []);
  });
});

describe("buildMergePrompt", () => {
  it("numbers existing memories with an E prefix and candidates plainly", () => {
    const prompt = buildMergePrompt(dedupeLexical([candidate()]), [
      { id: "mem_1", type: "interest", text: "Already known" },
    ]);
    assert.ok(prompt.user.includes("E1. [interest] Already known"));
    assert.ok(prompt.user.includes("1. [interest] I work on DeFi protocol design"));
  });
});

describe("parseMergeResponse", () => {
  const candidates = dedupeLexical([
    candidate({ text: "I work on DeFi protocol design", evidenceTitles: ["A"] }),
    candidate({ text: "I research incentive mechanisms", evidenceTitles: ["B"] }),
  ]);
  const existing = [{ id: "mem_existing" }];

  it("sums support across merged candidates and unions their evidence", () => {
    const out = parseMergeResponse(
      '[{"type":"interest","text":"I design DeFi incentive systems","from":[1,2],"duplicates":null}]',
      candidates,
      existing
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].supportCount, 2);
    assert.deepEqual(out[0].evidenceTitles, ["A", "B"]);
    assert.equal(out[0].confidence, confidenceFor(2));
  });

  it("resolves a duplicates label to an existing memory id", () => {
    const out = parseMergeResponse(
      '[{"type":"interest","text":"I work on DeFi","from":[1],"duplicates":"E1"}]',
      candidates,
      existing
    );
    assert.equal(out[0].existingId, "mem_existing");
  });

  it("ignores a duplicates label that points nowhere", () => {
    const out = parseMergeResponse(
      '[{"type":"interest","text":"I work on DeFi","from":[1],"duplicates":"E9"}]',
      candidates,
      existing
    );
    assert.equal(out[0].existingId, undefined);
  });

  it("returns null when the response is unusable", () => {
    assert.equal(parseMergeResponse("sorry, I cannot", candidates, existing), null);
  });
});

describe("rankForReview", () => {
  it("puts strong support first and collisions with existing memories last", () => {
    const ranked = rankForReview([
      { type: "note", text: "weak", evidenceTitles: [], supportCount: 1, confidence: 0.6 },
      { type: "note", text: "known", evidenceTitles: [], supportCount: 50, confidence: 0.9, existingId: "m1" },
      { type: "note", text: "strong", evidenceTitles: [], supportCount: 12, confidence: 0.9 },
    ]);
    assert.deepEqual(
      ranked.map((r) => r.text),
      ["strong", "weak", "known"]
    );
  });
});

describe("normalizeForCompare", () => {
  it("keeps CJK characters instead of stripping them as punctuation", () => {
    assert.equal(normalizeForCompare("我关注 DeFi 激励！"), "我关注 defi 激励");
  });
});

describe("profile distillation", () => {
  const blocks = [
    { label: "Profile summary", text: "Sam is a backend engineer working on payments." },
    { label: "/preferences.md", text: "Prefers short answers with the conclusion first." },
  ];

  it("puts a small memory store in a single batch", () => {
    const batches = buildProfileBatches(blocks);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].blocks.length, 2);
  });

  it("shows the model the source path, which hints at the memory type", () => {
    const [batch] = buildProfileBatches(blocks);
    assert.match(batch.text, /source="\/preferences\.md"/);
  });

  it("splits an oversized store and renumbers each batch from one", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      label: `/topics/t${i}.md`,
      text: "x".repeat(300),
    }));
    const batches = buildProfileBatches(many, { batchChars: 700 });
    assert.ok(batches.length > 1);
    for (const batch of batches) assert.match(batch.text, /n="1"/);
    assert.equal(
      batches.reduce((sum, b) => sum + b.blocks.length, 0),
      many.length,
      "no block is dropped"
    );
  });

  it("escapes quotes and newlines out of the source attribute", () => {
    const [batch] = buildProfileBatches([{ label: 'we"ird\nlabel', text: "hi" }]);
    const first = batch.text.split("\n")[0];
    assert.equal(first.split('"').length, 5, "no stray quotes inside the attributes");
  });

  it("asks the model to split rather than infer", () => {
    const [batch] = buildProfileBatches(blocks);
    const prompt = buildProfilePrompt(batch);
    assert.match(prompt.system, /already about this person/i);
    assert.equal(prompt.user, batch.text);
  });

  it("maps memory numbers back to their source labels", () => {
    const [batch] = buildProfileBatches(blocks);
    const out = parseProfileResponse(
      '[{"type":"preference","text":"I want the conclusion first","from":[2]}]',
      batch
    );
    assert.deepEqual(out[0].evidenceTitles, ["/preferences.md"]);
  });

  it("marks its candidates as curated, at the profile confidence", () => {
    const [batch] = buildProfileBatches(blocks);
    const out = parseProfileResponse('[{"type":"profile","text":"I am a backend engineer"}]', batch);
    assert.equal(out[0].confidence, PROFILE_CONFIDENCE);
    assert.equal(out[0].fromProfile, true);
  });

  it("returns null on an unusable response, so the batch can be retried", () => {
    const [batch] = buildProfileBatches(blocks);
    assert.equal(parseProfileResponse("I could not do that", batch), null);
  });
});

describe("curated memories survive the merge", () => {
  it("does not demote a profile statement to its support count", () => {
    const candidates = dedupeLexical([
      {
        type: "profile",
        text: "I am a backend engineer",
        evidenceTitles: ["/profile.md"],
        confidence: PROFILE_CONFIDENCE,
        fromProfile: true,
      },
    ]);
    assert.equal(candidates[0].fromProfile, true);

    const merged = parseMergeResponse(
      '[{"type":"profile","text":"I am a backend engineer","from":[1]}]',
      candidates,
      []
    );
    // Support of 1 would otherwise score 0.63.
    assert.equal(merged[0].confidence, PROFILE_CONFIDENCE);
    assert.ok(merged[0].confidence > confidenceFor(1));
  });

  it("leaves conversation-only candidates on the support scale", () => {
    const candidates = dedupeLexical([
      { type: "interest", text: "I follow DeFi", evidenceTitles: [], confidence: 0.8 },
    ]);
    const merged = parseMergeResponse(
      '[{"type":"interest","text":"I follow DeFi","from":[1]}]',
      candidates,
      []
    );
    assert.equal(merged[0].confidence, confidenceFor(1));
    assert.equal(merged[0].fromProfile, undefined);
  });
});
