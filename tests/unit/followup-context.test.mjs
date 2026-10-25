/**
 * What a follow-up carries from the turns before it. Regression cover for the
 * "follow-ups repeat themselves / lose what was said" reports: a chip used to
 * be a fresh single-shot request, and page chat was seeded with only the last
 * answer, as an assistant turn nobody had asked for.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SEED_QUESTION,
  MAX_PRIOR_ANSWER,
  MAX_PRIOR_TURNS,
  appendTrailTurn,
  chatTurnsForModel,
  normalizePriorTurns,
  priorTurnsFromTrail,
  seedMessagesFor,
} from "../../core/followup-context.js";
import { buildExplainContext, buildModelMessages } from "../../core/explain-context.js";
import { toExplainMemories } from "../../core/memory-context.js";
import { chat } from "../../core/runtime/adapter.js";
import { DEFAULT_SETTINGS } from "../../core/settings-defaults.js";

const page = { url: "https://example.com/post", title: "Caching" };

describe("follow-up explain carries earlier answers", () => {
  it("puts earlier answers in the prompt and drops the restate-the-selection shape", () => {
    const ctx = buildExplainContext({
      selection: "Redis 作为缓存层，延迟 < 1ms",
      page,
      mode: "probe",
      followUpQuestion: "「Redis」是什么？",
      priorTurns: [{ mode: "explain", answer: "Redis 是内存 KV，这里用作缓存。" }],
    });
    const [system, user] = buildModelMessages(ctx);
    assert.match(user.content, /## EARLIER IN THIS THREAD/);
    assert.match(user.content, /Redis 是内存 KV/);
    assert.match(user.content, /### Asked: \(explain\)/);
    assert.doesNotMatch(system.content, /1\) Grounding/);
    assert.match(system.content, /do not repeat points from EARLIER IN THIS THREAD/);
  });

  it("keeps the full answer shape for a first explain", () => {
    const ctx = buildExplainContext({ selection: "Redis caches hot keys.", page });
    const [system, user] = buildModelMessages(ctx);
    assert.match(system.content, /1\) Grounding/);
    assert.doesNotMatch(user.content, /EARLIER IN THIS THREAD/);
  });

  it("bounds what a client may claim as earlier turns", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      mode: "more",
      question: `q${i}`,
      answer: "x".repeat(5000),
    }));
    const out = normalizePriorTurns([...many, null, { answer: "  " }, "junk"]);
    assert.equal(out.length, MAX_PRIOR_TURNS);
    assert.equal(out.at(-1).question, "q9");
    assert.ok(out.every((t) => t.answer.length <= MAX_PRIOR_ANSWER));
    assert.deepEqual(normalizePriorTurns("nope"), []);
  });
});

describe("popover trail → page chat seed", () => {
  it("seeds every answer after the question that produced it", () => {
    let turns = appendTrailTurn([], { mode: "explain", answer: "First answer." });
    turns = appendTrailTurn(turns, { mode: "probe", question: "What is X?", answer: "X is…" });
    const seeded = seedMessagesFor([], turns, { seedQuestion: "解释这段选区。" });
    assert.deepEqual(
      seeded.map((m) => [m.role, m.content]),
      [
        ["user", "解释这段选区。"],
        ["assistant", "First answer."],
        ["user", "What is X?"],
        ["assistant", "X is…"],
      ]
    );
    assert.equal(priorTurnsFromTrail(turns).length, 2);
  });

  it("adds only the turns a resumed thread does not hold yet", () => {
    let turns = appendTrailTurn([], { mode: "explain", answer: "First answer." });
    const thread = [...seedMessagesFor([], turns), { role: "user", content: "chat q" }, { role: "assistant", content: "chat a" }];
    turns = appendTrailTurn(turns, { mode: "more", question: "Explain more", answer: "Deeper." });
    const added = seedMessagesFor(thread, turns);
    assert.deepEqual(
      added.map((m) => m.content),
      ["Explain more", "Deeper."]
    );
    assert.deepEqual(seedMessagesFor([...thread, ...added], turns), []);
  });

  it("ignores empty answers", () => {
    assert.deepEqual(appendTrailTurn([], { mode: "explain", answer: "  " }), []);
  });
});

describe("chat turns sent to the model", () => {
  it("drops error bubbles and empty stopped turns, then merges so roles alternate", () => {
    const out = chatTurnsForModel([
      { role: "user", content: "q1" },
      { role: "assistant", content: "Error: upstream 502", error: true },
      { role: "user", content: "q2" },
      { role: "assistant", content: "" },
      { role: "user", content: "q3" },
    ]);
    assert.deepEqual(out, [{ role: "user", content: "q1\n\nq2\n\nq3" }]);
  });

  it("gives a legacy assistant-first thread its question back", () => {
    const out = chatTurnsForModel([
      { role: "assistant", content: "seeded answer", seedTurnId: "pt_1", webSearch: {} },
      { role: "user", content: "follow-up" },
    ]);
    assert.deepEqual(out, [
      { role: "user", content: DEFAULT_SEED_QUESTION },
      { role: "assistant", content: "seeded answer" },
      { role: "user", content: "follow-up" },
    ]);
  });

  it("keeps an image-only turn and its attachments", () => {
    const att = [{ mediaType: "image/png", data: "AAAA" }];
    const out = chatTurnsForModel([{ role: "user", content: "", attachments: att }]);
    assert.deepEqual(out, [{ role: "user", content: "", attachments: att }]);
  });
});

describe("page chat memories", () => {
  it("lists the profile once when it is also stored as a memory", () => {
    const out = toExplainMemories("我是后端工程师", [
      { type: "profile", text: "我是后端工程师" },
      { type: "interest", text: "Redis" },
    ]);
    assert.deepEqual(out, [
      { type: "profile", content: "我是后端工程师" },
      { type: "interest", content: "Redis" },
    ]);
  });

  it("searches memories with the current question, not only the selection", async () => {
    /** @type {string[]} */
    const queries = [];
    const memoryProvider = {
      async search(q) {
        queries.push(q);
        return [];
      },
    };
    await chat(
      {
        selection: "hot key overload",
        page,
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "a" },
          { role: "user", content: "what about Kubernetes autoscaling?" },
        ],
      },
      { settings: { ...DEFAULT_SETTINGS, runtime: "mock" }, memoryProvider }
    );
    assert.match(queries[0], /Kubernetes autoscaling/);
    assert.match(queries[0], /hot key overload/);
  });
});
