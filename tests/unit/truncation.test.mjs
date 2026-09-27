import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { chatWithAnthropic, explainWithAnthropic } from "../../core/runtime/anthropic.js";
import { complete } from "../../core/runtime/completion.js";
import {
  DEFAULT_OPENAI_MODEL,
  chatWithOpenAICompatible,
  explainWithOpenAICompatible,
  pingOpenAICompatible,
} from "../../core/runtime/openai-compatible.js";
import {
  CUT_OFF_BEFORE_ANSWER,
  REASONING_HEADROOM_TOKENS,
  isCutOff,
  looksLikeReasoningModel,
  openAIOutputParams,
  tokenBudgetForMode,
  wantsOpenAIReasoningParams,
} from "../../core/runtime/token-budget.js";
import { chatWithWdimtmCloud, explainWithWdimtmCloud } from "../../core/runtime/wdimtm-cloud.js";

const REQUEST = {
  selection: "the fee switch activates next week",
  page: { url: "https://example.com/post", title: "Fee switch" },
  lens: { id: "general" },
};

const CHAT = { system: "You are WDIMTM.", messages: [{ role: "user", content: "go on" }] };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * @param {(body: any) => Response} respond
 * @returns {{ body?: any }}
 */
function stubFetch(respond) {
  const seen = {};
  globalThis.fetch = async (_url, init = {}) => {
    seen.body = JSON.parse(String(init.body || "{}"));
    return respond(seen.body);
  };
  return seen;
}

const json = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** @param {object[]} frames */
const sse = (frames) =>
  new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n", {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });

const openAIConfig = { apiBaseUrl: "https://llm.test/v1", apiKey: "sk-test", model: "gpt-4o-mini" };
const anthropicConfig = {
  apiBaseUrl: "https://anthropic.test/v1",
  apiKey: "sk-ant-test",
  model: "claude-opus-5",
};

describe("token budget", () => {
  it("leaves room for a full answer in every mode", () => {
    for (const mode of ["explain", "more", "verify", "why_it_matters", "research"]) {
      assert.ok(tokenBudgetForMode(mode) >= 1500, mode);
    }
  });

  it("recognizes reasoning models by name", () => {
    for (const id of [
      "o3-mini",
      "o1",
      "openai/o4-mini",
      "gpt-5",
      "gpt-5-mini",
      "deepseek-r1",
      "deepseek-reasoner",
      "deepseek/deepseek-r1:free",
      "qwq-32b",
      "qwen3-235b-a22b-thinking-2507",
    ]) {
      assert.equal(looksLikeReasoningModel(id), true, id);
    }
    for (const id of ["gpt-4o-mini", "gpt-4.1", "deepseek-chat", "llama-3.1-8b", "qwen-plus", ""]) {
      assert.equal(looksLikeReasoningModel(id), false, id);
    }
  });

  it("adds reasoning headroom only for reasoning models", () => {
    assert.deepEqual(openAIOutputParams(1500, "gpt-4o-mini", 0.4), {
      max_tokens: 1500,
      temperature: 0.4,
    });
    assert.deepEqual(openAIOutputParams(1500, "deepseek-r1", 0.4), {
      max_tokens: 1500 + REASONING_HEADROOM_TOKENS,
      temperature: 0.4,
    });
  });

  it("speaks OpenAI's reasoning-model parameters to bare OpenAI ids only", () => {
    for (const id of ["gpt-5.6-luna", "gpt-5", "o3-mini", "o1"]) {
      assert.equal(wantsOpenAIReasoningParams(id), true, id);
    }
    // Routed ids go to a server that translates the classic fields itself.
    for (const id of ["openai/gpt-5.6-luna", "gpt-4o-mini", "deepseek-r1", "llama3.2"]) {
      assert.equal(wantsOpenAIReasoningParams(id), false, id);
    }
    assert.deepEqual(openAIOutputParams(1500, "gpt-5.6-luna", 0.4), {
      max_completion_tokens: 1500 + REASONING_HEADROOM_TOKENS,
    });
    assert.deepEqual(openAIOutputParams(1500, "openai/gpt-5.6-luna", 0.4), {
      max_tokens: 1500 + REASONING_HEADROOM_TOKENS,
      temperature: 0.4,
    });
  });

  it("treats only ceiling stops as cut off", () => {
    assert.equal(isCutOff("length"), true);
    assert.equal(isCutOff("max_tokens"), true);
    assert.equal(isCutOff("model_context_window_exceeded"), true);
    for (const r of ["stop", "end_turn", "stop_sequence", "tool_use", undefined, null]) {
      assert.equal(isCutOff(r), false, String(r));
    }
  });
});

describe("openai-compatible cut-off", () => {
  it("flags a non-streamed explain that hit the ceiling", async () => {
    const seen = stubFetch(() =>
      json({ choices: [{ message: { content: "Half an answer" }, finish_reason: "length" }] })
    );
    const res = await explainWithOpenAICompatible(REQUEST, openAIConfig);
    assert.equal(res.truncated, true);
    assert.equal(res.explanation, "Half an answer");
    assert.equal(seen.body.max_tokens, tokenBudgetForMode("explain"));
  });

  it("does not flag an answer that finished", async () => {
    stubFetch(() => json({ choices: [{ message: { content: "Done." }, finish_reason: "stop" }] }));
    const res = await explainWithOpenAICompatible(REQUEST, openAIConfig);
    assert.equal(res.truncated, false);
  });

  it("reads finish_reason from the stream", async () => {
    stubFetch(() =>
      sse([
        { choices: [{ delta: { content: "Half " } }] },
        { choices: [{ delta: { content: "an answer" } }] },
        { choices: [{ delta: {}, finish_reason: "length" }] },
      ])
    );
    const chunks = [];
    const res = await explainWithOpenAICompatible(REQUEST, {
      ...openAIConfig,
      onChunk: (t) => chunks.push(t),
    });
    assert.equal(res.truncated, true);
    assert.equal(res.explanation, "Half an answer");
    assert.deepEqual(chunks, ["Half ", "an answer"]);
  });

  it("drops a half-sent trailer from a cut-off answer", async () => {
    stubFetch(() =>
      json({
        choices: [
          {
            message: { content: "The answer.\n<<<WDIMTM_FOLLOWUPS>>>\nWho pa" },
            finish_reason: "length",
          },
        ],
      })
    );
    const res = await explainWithOpenAICompatible(REQUEST, openAIConfig);
    assert.equal(res.explanation, "The answer.");
    assert.equal(res.truncated, true);
  });

  it("gives a reasoning model headroom and explains an empty cut-off", async () => {
    const seen = stubFetch(() =>
      json({ choices: [{ message: { content: "" }, finish_reason: "length" }] })
    );
    await assert.rejects(
      explainWithOpenAICompatible(REQUEST, { ...openAIConfig, model: "deepseek-r1" }),
      (err) => err.message === CUT_OFF_BEFORE_ANSWER
    );
    assert.equal(
      seen.body.max_tokens,
      tokenBudgetForMode("explain") + REASONING_HEADROOM_TOKENS
    );
  });

  it("flags cut-off chat, streamed and not", async () => {
    stubFetch(() =>
      sse([
        { choices: [{ delta: { content: "Sure" } }] },
        { choices: [{ delta: {}, finish_reason: "length" }] },
      ])
    );
    const streamed = await chatWithOpenAICompatible(CHAT, { ...openAIConfig, onChunk: () => {} });
    assert.equal(streamed.truncated, true);

    const seen = stubFetch(() =>
      json({ choices: [{ message: { content: "Sure" }, finish_reason: "stop" }] })
    );
    const plain = await chatWithOpenAICompatible(CHAT, openAIConfig);
    assert.equal(plain.truncated, false);
    assert.ok(seen.body.max_tokens >= 2000);
  });
});

describe("default OpenAI model", () => {
  const config = { apiBaseUrl: "https://llm.test/v1", apiKey: "sk-test" };
  const ok = () => json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });

  /** @param {any} body */
  const assertReasoningShape = (body) => {
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal("max_tokens" in body, false);
    assert.equal("temperature" in body, false);
    assert.ok(body.max_completion_tokens > REASONING_HEADROOM_TOKENS);
  };

  it("is gpt-5.6-luna", () => {
    assert.equal(DEFAULT_OPENAI_MODEL, "gpt-5.6-luna");
  });

  it("sends only parameters gpt-5.6-luna accepts, on every call", async () => {
    let seen = stubFetch(ok);
    await explainWithOpenAICompatible(REQUEST, config);
    assertReasoningShape(seen.body);

    seen = stubFetch(ok);
    await chatWithOpenAICompatible(CHAT, config);
    assertReasoningShape(seen.body);

    seen = stubFetch(ok);
    await complete({ system: "S", user: "U" }, config);
    assertReasoningShape(seen.body);

    seen = stubFetch(ok);
    const ping = await pingOpenAICompatible(config);
    assert.equal(ping.ok, true);
    assertReasoningShape(seen.body);
  });
});

describe("anthropic cut-off", () => {
  it("flags stop_reason max_tokens on a plain response", async () => {
    stubFetch(() =>
      json({ stop_reason: "max_tokens", content: [{ type: "text", text: "Half an answer" }] })
    );
    const res = await explainWithAnthropic(REQUEST, anthropicConfig);
    assert.equal(res.truncated, true);
  });

  it("does not flag end_turn", async () => {
    stubFetch(() => json({ stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] }));
    const res = await explainWithAnthropic(REQUEST, anthropicConfig);
    assert.equal(res.truncated, false);
  });

  it("reads the stop_reason from message_delta in the stream", async () => {
    stubFetch(() =>
      sse([
        { type: "message_start", message: { id: "msg_1" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Half" } },
        { type: "message_delta", delta: { stop_reason: "max_tokens" } },
        { type: "message_stop" },
      ])
    );
    const res = await explainWithAnthropic(REQUEST, { ...anthropicConfig, onChunk: () => {} });
    assert.equal(res.truncated, true);
    assert.equal(res.explanation, "Half");
  });

  it("explains a stream that thought until the ceiling and said nothing", async () => {
    stubFetch(() =>
      sse([
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "…" } },
        { type: "message_delta", delta: { stop_reason: "max_tokens" } },
      ])
    );
    await assert.rejects(
      chatWithAnthropic(CHAT, { ...anthropicConfig, onChunk: () => {} }),
      (err) => err.message === CUT_OFF_BEFORE_ANSWER
    );
  });

  it("flags cut-off chat", async () => {
    stubFetch(() => json({ stop_reason: "max_tokens", content: [{ type: "text", text: "Sure" }] }));
    const res = await chatWithAnthropic(CHAT, anthropicConfig);
    assert.equal(res.truncated, true);
  });
});

describe("wdimtm cloud cut-off", () => {
  const cloudConfig = { baseUrl: "https://cloud.test", accessToken: "tok" };

  it("carries truncated from the closing stream frame", async () => {
    stubFetch(() =>
      sse([{ delta: "Half" }, { done: true, explanation: "Half", truncated: true }])
    );
    const res = await explainWithWdimtmCloud(REQUEST, { ...cloudConfig, onChunk: () => {} });
    assert.equal(res.truncated, true);

    stubFetch(() => sse([{ delta: "Sure" }, { done: true, explanation: "Sure", truncated: true }]));
    const chat = await chatWithWdimtmCloud(CHAT, { ...cloudConfig, onChunk: () => {} });
    assert.equal(chat.truncated, true);
  });

  it("carries truncated from JSON responses", async () => {
    stubFetch(() => json({ explanation: "Half", truncated: true }));
    assert.equal((await explainWithWdimtmCloud(REQUEST, cloudConfig)).truncated, true);

    stubFetch(() => json({ reply: "Sure" }));
    assert.equal((await chatWithWdimtmCloud(CHAT, cloudConfig)).truncated, false);
  });
});
