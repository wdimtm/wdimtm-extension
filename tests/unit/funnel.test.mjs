/**
 * First-run funnel (#40): the free answer comes first, the pay prompt is one
 * optional line after it, and BYOK never sees it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LOW_CREDITS, creditNudge } from "../../core/funnel.js";
import { classifyRuntimeError } from "../../core/runtime-errors.js";
import { t } from "../../core/i18n.js";

const cloud = (quotaRemaining, firstHostedAnswer = false) =>
  creditNudge({ runtime: "wdimtm-cloud", entitlement: { quotaRemaining }, firstHostedAnswer });

describe("credit nudge", () => {
  it("mentions credit packs once, after the first hosted answer", () => {
    assert.deepEqual(cloud(49, true), { kind: "first", remaining: 49 });
    assert.equal(cloud(48, false), null, "and stays quiet after that");
  });

  it("offers a top-up when credits are nearly gone, and when they are gone", () => {
    assert.deepEqual(cloud(LOW_CREDITS), { kind: "low", remaining: LOW_CREDITS });
    assert.deepEqual(cloud(1), { kind: "low", remaining: 1 });
    assert.deepEqual(cloud(0), { kind: "empty", remaining: 0 });
    assert.deepEqual(cloud(-3), { kind: "empty", remaining: 0 }, "a negative balance reads as none");
    assert.equal(cloud(LOW_CREDITS + 1), null);
  });

  it("prefers the low-credit line over the first-answer line", () => {
    assert.equal(cloud(2, true).kind, "low");
  });

  it("never prompts a BYOK user, or a response without a balance", () => {
    for (const runtime of ["openai-compatible", "anthropic", "mock", undefined]) {
      assert.equal(creditNudge({ runtime, entitlement: { quotaRemaining: 0 }, firstHostedAnswer: true }), null);
    }
    assert.equal(creditNudge({ runtime: "wdimtm-cloud", entitlement: null, firstHostedAnswer: true }), null);
    assert.equal(creditNudge({ runtime: "wdimtm-cloud", entitlement: { quotaRemaining: "n/a" } }), null);
  });
});

describe("Cloud before sign-in", () => {
  it("asks a new install to sign in, not to sign in again", () => {
    const err = new Error('WDIMTM Cloud request failed (401): {"error":"Sign in to WDIMTM Cloud first."}');
    const c = classifyRuntimeError(err, "cloud");
    assert.equal(c.code, "sign_in_required");
    assert.match(c.message, /free/i);
    assert.match(c.message, /own API key/i, "BYOK stays a way out");
    assert.doesNotMatch(c.message, /expired/i);
  });

  it("still calls an expired session expired", () => {
    const err = new Error('WDIMTM Cloud request failed (401): {"error":"Session expired. Sign in again."}');
    assert.equal(classifyRuntimeError(err, "cloud").code, "unauthorized");
  });
});

describe("funnel copy", () => {
  it("calls them WDIMTM credits, in both languages, and never a relay or account", () => {
    for (const key of ["nudgeFirst", "nudgeLow", "nudgeEmpty", "errSignInRequired", "signInCloud"]) {
      for (const lang of ["en", "zh_CN"]) {
        const text = t(key, lang);
        assert.notEqual(text, key, `${lang}.${key}`);
        assert.doesNotMatch(text, /relay|中转|account/i);
      }
      assert.notEqual(t(key, "zh_CN"), t(key, "en"));
    }
    for (const key of ["nudgeFirst", "nudgeLow", "nudgeEmpty"]) {
      assert.match(t(key, "en"), /WDIMTM credit/);
    }
  });

  it("renders the line under the answer, not in place of it", () => {
    const content = readFileSync(new URL("../../extension/content/content.js", import.meta.url), "utf8");
    assert.match(content, /\$\{toolbar\}\s*\$\{nudge\}/);
  });
});
