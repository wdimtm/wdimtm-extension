/**
 * 402 Payment Required from the hosted runtime (#75): which reason, which
 * words, and which way out. Every body shape the server might send, including
 * none at all, has to classify without throwing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cloudFetch } from "../../core/cloud.js";
import { classifyRuntimeError } from "../../core/runtime-errors.js";
import { t } from "../../core/i18n.js";

/** An error shaped the way cloudFetch throws a 402. */
function cloud402(body) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const err = new Error(`WDIMTM Cloud request failed (402): ${text.slice(0, 240)}`);
  /** @type {any} */ (err).status = 402;
  if (body && typeof body === "object") /** @type {any} */ (err).body = body;
  return err;
}

describe("402 from WDIMTM Cloud", () => {
  it("reads the free allowance as used up when nothing is left", () => {
    const c = classifyRuntimeError(
      cloud402({
        error: "Not enough credits: explain costs 1, 0 left.",
        code: "insufficient_credits",
        quota: { remaining: 0, allowanceRemaining: 0, purchasedRemaining: 0 },
      }),
      "cloud"
    );
    assert.equal(c.code, "payment_required");
    assert.equal(c.reason, "allowance_exhausted");
    assert.match(c.message, /free WDIMTM credits/);
    assert.equal(c.checkoutUrl, undefined);
  });

  it("says 'not enough' when some credits are left but this request costs more", () => {
    const c = classifyRuntimeError(
      cloud402({ code: "insufficient_credits", quota: { remaining: 3, purchasedRemaining: 3 } }),
      "cloud"
    );
    assert.equal(c.reason, "insufficient_credits");
    assert.match(c.message, /not enough|don't have enough/i);
  });

  it("finds the body in the message when it was not attached", () => {
    const err = new Error(
      'WDIMTM Cloud request failed (402): {"code":"insufficient_credits","quota":{"remaining":2}}'
    );
    assert.equal(classifyRuntimeError(err, "cloud").reason, "insufficient_credits");
  });

  it("survives a 402 with no body, a cut-off body, and a body that is not an object", () => {
    for (const err of [
      cloud402(),
      cloud402('{"code":"insufficient_credits","quota":{"remai'),
      cloud402("Payment Required"),
      cloud402(["not", "an", "object"]),
      Object.assign(new Error("boom"), { status: 402, body: null }),
    ]) {
      const c = classifyRuntimeError(err, "cloud");
      assert.equal(c.code, "payment_required");
      assert.equal(c.reason, "allowance_exhausted");
    }
  });
});

describe("402 from a runtime in front of Agentaab", () => {
  const exhausted = {
    error: "Payment required",
    reason: "free_quota_exhausted",
    runtime_access: {
      payment_required: true,
      free_quota_remaining: 0,
      paid_credits: 0,
      checkout_url: "https://checkout.stripe.test/c/pay/cs_1",
    },
  };

  it("passes the checkout link through as the way out", () => {
    const c = classifyRuntimeError(cloud402(exhausted), "cloud");
    assert.equal(c.reason, "allowance_exhausted");
    assert.equal(c.checkoutUrl, "https://checkout.stripe.test/c/pay/cs_1");
  });

  it("never passes on a checkout link that is not https", () => {
    for (const url of ["http://checkout.test/pay", "javascript:alert(1)", "not a url", 42]) {
      const body = { ...exhausted, runtime_access: { ...exhausted.runtime_access, checkout_url: url } };
      assert.equal(classifyRuntimeError(cloud402(body), "cloud").checkoutUrl, undefined);
    }
  });

  it("does not ask the user to pay when the creator's budget stopped the run", () => {
    for (const reason of ["creator_budget_exhausted", "budget_exceeded"]) {
      const c = classifyRuntimeError(
        cloud402({ reason, runtime_access: { checkout_url: "https://checkout.test/x" } }),
        "cloud"
      );
      assert.equal(c.reason, "budget_exhausted");
      assert.equal(c.checkoutUrl, undefined, "no buy link for a stop paying cannot lift");
      assert.doesNotMatch(c.message, /buy/i);
    }
  });

  it("reads the reason from runtime_access when the top level has none", () => {
    const c = classifyRuntimeError(
      cloud402({ runtime_access: { reason: "budget", payment_required: true } }),
      "cloud"
    );
    assert.equal(c.reason, "budget_exhausted");
  });
});

describe("402 outside Cloud", () => {
  it("points a BYOK user at their own provider, not at WDIMTM credits", () => {
    const c = classifyRuntimeError(
      new Error('LLM request failed (402): {"error":"Insufficient credits"}'),
      "byok"
    );
    assert.equal(c.code, "quota");
    assert.match(c.message, /provider/i);
    assert.doesNotMatch(c.message, /WDIMTM/);
    assert.equal(c.reason, undefined);
  });

  it("does not read a 402 into a number that merely contains it", () => {
    const c = classifyRuntimeError(new Error("Request id 14025 failed"), "cloud");
    assert.notEqual(c.code, "payment_required");
  });
});

describe("cloudFetch keeps the 402 body", () => {
  it("attaches the status and the whole JSON body, however long", async () => {
    const realFetch = globalThis.fetch;
    const body = {
      error: "Not enough credits: research costs 8, 3 left.",
      code: "insufficient_credits",
      quota: { remaining: 3, allowanceRemaining: 0, purchasedRemaining: 3, padding: "x".repeat(400) },
    };
    globalThis.fetch = async () =>
      new Response(JSON.stringify(body), { status: 402, headers: { "Content-Type": "application/json" } });
    try {
      const err = await cloudFetch({ baseUrl: "https://cloud.test", accessToken: "t" }, "/explain", {
        method: "POST",
        body: {},
      }).catch((e) => e);
      assert.equal(err.status, 402);
      assert.deepEqual(err.body, body);
      assert.equal(classifyRuntimeError(err, "cloud").reason, "insufficient_credits");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("popover copy and actions", () => {
  const content = readFileSync(new URL("../../extension/content/content.js", import.meta.url), "utf8");

  it("has words for every reason and the buy button, in both languages", () => {
    for (const key of ["buyCredits", "errAllowanceExhausted", "errInsufficientCredits", "errBudgetExhausted"]) {
      assert.notEqual(t(key, "en"), key, `en.${key}`);
      assert.notEqual(t(key, "zh_CN"), t(key, "en"), `zh_CN.${key} is translated`);
    }
  });

  it("offers Buy credits for a 402, and opens Settings at the Cloud packages without a link", () => {
    assert.match(content, /btn\("buy-credits", "buyCredits"/);
    assert.match(content, /payload: \{ section: "cloud" \}/);
  });
});
