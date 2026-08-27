import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parse as parseChatgpt, sniff as sniffChatgpt } from "../../core/memory-sources/chatgpt.js";
import { parse as parseClaude, sniff as sniffClaude } from "../../core/memory-sources/claude.js";
import { parse as parseClaudeMemory } from "../../core/memory-sources/claude-memory.js";
import { parseExport } from "../../core/memory-sources/index.js";
import { toIsoDate } from "../../core/memory-sources/types.js";
import { prefilter } from "../../core/memory-import/prefilter.js";

/** @param {string} name */
function fixture(name) {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/memory-import/${name}`, import.meta.url)), "utf8");
}

const CHATGPT = fixture("chatgpt-sample.json");
const CLAUDE = fixture("claude-sample.json");

describe("chatgpt parser", () => {
  it("follows current_node and ignores abandoned regenerations", () => {
    const { conversations } = parseChatgpt(JSON.parse(CHATGPT));
    const defi = conversations.find((c) => c.id === "conv-defi");
    assert.ok(defi);
    const texts = defi.turns.map((t) => t.text);
    assert.ok(!texts.some((t) => t.includes("ABANDONED")));
    assert.equal(defi.turns.length, 2);
  });

  it("drops system turns", () => {
    const { conversations } = parseChatgpt(JSON.parse(CHATGPT));
    const defi = conversations.find((c) => c.id === "conv-defi");
    assert.deepEqual(
      defi.turns.map((t) => t.role),
      ["user", "assistant"]
    );
  });

  it("drops hidden messages and reads code blocks from content.text", () => {
    const { conversations } = parseChatgpt(JSON.parse(CHATGPT));
    const rust = conversations.find((c) => c.id === "conv-rust");
    assert.ok(rust);
    const texts = rust.turns.map((t) => t.text);
    assert.ok(!texts.some((t) => t.includes("HIDDEN")));
    assert.ok(texts.some((t) => t.includes("println!")));
  });

  it("counts unparseable entries instead of throwing", () => {
    const entries = JSON.parse(CHATGPT);
    const { conversations, skipped } = parseChatgpt(entries);
    // The fixture carries exactly one entry with no mapping at all.
    assert.equal(skipped, 1);
    assert.equal(conversations.length + skipped, entries.length, "every entry is accounted for");
  });

  it("survives a parent cycle in mapping", () => {
    const cyclic = [
      {
        conversation_id: "cycle",
        title: "Cycle",
        current_node: "a",
        mapping: {
          a: {
            id: "a",
            parent: "b",
            message: {
              author: { role: "user" },
              content: { content_type: "text", parts: ["hello"] },
            },
          },
          b: { id: "b", parent: "a", message: null },
        },
      },
    ];
    const { conversations } = parseChatgpt(cyclic);
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].turns.length, 1);
  });

  it("sniffs its own format and rejects the other", () => {
    assert.equal(sniffChatgpt(JSON.parse(CHATGPT)), true);
    assert.equal(sniffChatgpt(JSON.parse(CLAUDE)), false);
  });

  // Shapes below were found in a real 714-conversation export.

  it("drops reasoning traces, which are a third of a real export's messages", () => {
    const { conversations } = parseChatgpt(JSON.parse(CHATGPT));
    const reasoning = conversations.find((c) => c.id === "conv-reasoning");
    assert.ok(reasoning);
    const texts = reasoning.turns.map((t) => t.text);
    assert.ok(!texts.some((t) => t.includes("INTERNAL REASONING TRACE")), "thoughts dropped");
    assert.ok(!texts.some((t) => t.includes("Thought for a few seconds")), "recap dropped");
    assert.deepEqual(texts, ["Which fund should I look at?", "Here is the actual answer."]);
  });

  it("reads transcripts out of a voice conversation", () => {
    const { conversations } = parseChatgpt(JSON.parse(CHATGPT));
    const voice = conversations.find((c) => c.id === "conv-voice");
    assert.ok(voice, "a spoken conversation must not parse to nothing");
    assert.equal(voice.turns.length, 2);
    assert.match(voice.turns[0].text, /liquidation bot/);
  });

  it("keeps custom instructions, the user describing themselves", () => {
    const { conversations } = parseChatgpt(JSON.parse(CHATGPT));
    const ctx = conversations.find((c) => c.id === "conv-context");
    assert.ok(ctx);
    assert.match(ctx.turns[0].text, /backend engineer working on payments/);
    assert.match(ctx.turns[0].text, /Answer concisely/);
    assert.equal(ctx.turns[0].role, "user");
  });

  it("omits an empty custom-instructions block rather than emitting a bare label", () => {
    const { conversations } = parseChatgpt([
      {
        conversation_id: "empty-ctx",
        title: "Empty context",
        current_node: "c1",
        mapping: {
          c0: { id: "c0", message: null, parent: null },
          c1: {
            id: "c1",
            parent: "c0",
            message: {
              author: { role: "user" },
              content: { content_type: "user_editable_context", user_profile: "", user_instructions: "" },
            },
          },
        },
      },
    ]);
    assert.equal(conversations.length, 0, "nothing usable means the conversation is skipped");
  });

  it("keeps the text of an image message and drops the image pointer", () => {
    const { conversations } = parseChatgpt(JSON.parse(CHATGPT));
    const image = conversations.find((c) => c.id === "conv-image");
    assert.ok(image);
    assert.equal(image.turns[0].text, "What is wrong with this chart?");
    assert.ok(!image.turns[0].text.includes("file-service"));
  });
});

describe("claude parser", () => {
  it("reads typed content blocks and ignores non-text blocks", () => {
    const { conversations } = parseClaude(JSON.parse(CLAUDE));
    const uniswap = conversations.find((c) => c.id === "conv-uniswap");
    assert.ok(uniswap);
    assert.equal(uniswap.turns.length, 2);
    assert.ok(uniswap.turns[1].text.includes("lifecycle"));
  });

  it("falls back to the flat text field", () => {
    const { conversations } = parseClaude(JSON.parse(CLAUDE));
    const legacy = conversations.find((c) => c.id === "conv-legacy");
    assert.ok(legacy);
    assert.equal(legacy.turns[0].text, "Summarize this paper for me.");
  });

  it("normalizes the human sender to the user role", () => {
    const { conversations } = parseClaude(JSON.parse(CLAUDE));
    const legacy = conversations.find((c) => c.id === "conv-legacy");
    assert.equal(legacy.turns[0].role, "user");
  });

  it("sniffs its own format and rejects the other", () => {
    assert.equal(sniffClaude(JSON.parse(CLAUDE)), true);
    assert.equal(sniffClaude(JSON.parse(CHATGPT)), false);
  });

  // Shapes below were found in a real 487-conversation export.

  it("drops extended thinking and tool blocks, keeping only the reply", () => {
    const { conversations } = parseClaude(JSON.parse(CLAUDE));
    const thinking = conversations.find((c) => c.id === "conv-thinking");
    assert.ok(thinking);
    const texts = thinking.turns.map((t) => t.text);
    assert.ok(!texts.some((t) => t.includes("INTERNAL EXTENDED THINKING")));
    assert.ok(!texts.some((t) => t.includes("RAW TOOL OUTPUT")));
    assert.ok(!texts.some((t) => t.includes("order book depth")), "tool input stays out");
    assert.deepEqual(texts, [
      "Which exchange has the deepest order book?",
      "Depth varies by pair rather than by venue.",
    ]);
  });

  it("prefers content blocks over an empty text field", () => {
    const { conversations } = parseClaude(JSON.parse(CLAUDE));
    const thinking = conversations.find((c) => c.id === "conv-thinking");
    assert.equal(thinking.turns[0].text, "Which exchange has the deepest order book?");
  });

  it("skips a wholly empty record rather than emitting a contentless conversation", () => {
    const { conversations, skipped } = parseClaude(JSON.parse(CLAUDE));
    assert.ok(!conversations.some((c) => c.id === "conv-blank"));
    assert.ok(skipped >= 1, "the blank record is counted, not silently dropped");
  });
});

describe("parseExport", () => {
  it("detects the source format", () => {
    const chatgpt = parseExport(CHATGPT);
    assert.equal(chatgpt.ok, true);
    assert.equal(chatgpt.sourceId, "chatgpt");

    const claude = parseExport(CLAUDE);
    assert.equal(claude.ok, true);
    assert.equal(claude.sourceId, "claude");
  });

  it("reports invalid JSON separately from an unknown format", () => {
    assert.equal(parseExport("not json at all").code, "invalid_json");
    assert.equal(parseExport('[{"something": "else"}]').code, "unknown_format");
  });
});

describe("toIsoDate", () => {
  it("accepts epoch seconds, ISO strings, and rejects junk", () => {
    assert.equal(toIsoDate(1699999999.123).startsWith("2023-"), true);
    assert.equal(toIsoDate("2026-02-01T10:00:00Z"), "2026-02-01T10:00:00.000Z");
    assert.equal(toIsoDate(null), "");
    assert.equal(toIsoDate("nonsense"), "");
  });
});

describe("prefilter", () => {
  it("drops conversations with no user turn", () => {
    const { conversations } = parseClaude(JSON.parse(CLAUDE));
    const { kept, dropped } = prefilter(conversations);
    assert.equal(dropped, 1);
    assert.ok(!kept.some((c) => c.id === "conv-assistant-only"));
  });
});

describe("claude memory store", () => {
  const MEMORIES = fixture("claude-memories-sample.json");

  it("is recognized without the user naming a vendor", () => {
    const outcome = parseExport(MEMORIES);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.kind, "profile");
    assert.equal(outcome.sourceId, "claude-memory");
  });

  it("is never mistaken for conversation history, in either direction", () => {
    assert.equal(parseExport(CLAUDE).kind, "conversations");
    assert.equal(parseExport(CHATGPT).kind, "conversations");
    assert.equal(sniffClaude(JSON.parse(MEMORIES)), false);
    assert.equal(sniffChatgpt(JSON.parse(MEMORIES)), false);
  });

  it("yields the prose profile and each memory file as its own block", () => {
    const { blocks } = parseClaudeMemory(JSON.parse(MEMORIES));
    assert.deepEqual(
      blocks.map((b) => b.label),
      ["Profile summary", "/preferences.md", "/topics/investing.md"]
    );
    assert.match(blocks[0].text, /transaction monitoring/);
  });

  it("counts an empty memory file rather than emitting a blank block", () => {
    const { blocks, skipped } = parseClaudeMemory(JSON.parse(MEMORIES));
    assert.equal(skipped, 1);
    assert.ok(!blocks.some((b) => b.label === "/topics/empty.md"));
  });

  it("keeps the path as the block label, since it maps onto memory types", () => {
    const { blocks } = parseClaudeMemory(JSON.parse(MEMORIES));
    assert.ok(blocks.some((b) => b.label === "/preferences.md"));
  });
});
