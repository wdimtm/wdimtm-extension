import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDeniedHost,
  isHostDenied,
  normalizeHost,
  removeDeniedHost,
} from "../../core/site-scope.js";

describe("normalizeHost", () => {
  it("strips the things people paste along with a hostname", () => {
    assert.equal(normalizeHost("  HTTPS://Example.com/some/path?q=1  "), "example.com");
    assert.equal(normalizeHost("example.com:8443"), "example.com");
    assert.equal(normalizeHost("www.example.com"), "example.com");
  });

  it("returns an empty string for nothing usable", () => {
    assert.equal(normalizeHost(""), "");
    assert.equal(normalizeHost("   "), "");
    assert.equal(normalizeHost(null), "");
    assert.equal(normalizeHost(undefined), "");
  });
});

describe("isHostDenied", () => {
  it("matches the exact host", () => {
    assert.equal(isHostDenied("mail.google.com", ["mail.google.com"]), true);
  });

  it("matches subdomains at a dot boundary, not by raw suffix", () => {
    assert.equal(isHostDenied("blog.example.com", ["example.com"]), true);
    // "notexample.com" is a different site that happens to end in the same text.
    assert.equal(isHostDenied("notexample.com", ["example.com"]), false);
  });

  it("does not match a parent from a subdomain entry", () => {
    assert.equal(isHostDenied("example.com", ["blog.example.com"]), false);
  });

  it("ignores www. so a copied address bar host still covers the site", () => {
    // The bug this closes: pasting "www.example.com" used to leave every other
    // subdomain active, because the entry was compared verbatim.
    assert.equal(isHostDenied("blog.example.com", ["www.example.com"]), true);
    assert.equal(isHostDenied("example.com", ["www.example.com"]), true);
    assert.equal(isHostDenied("www.example.com", ["example.com"]), true);
  });

  it("tolerates entries pasted with a scheme, path or port", () => {
    assert.equal(isHostDenied("mail.google.com", ["https://mail.google.com/mail/u/0"]), true);
    assert.equal(isHostDenied("localhost", ["localhost:3000"]), true);
  });

  it("is case insensitive on both sides", () => {
    assert.equal(isHostDenied("Mail.Google.COM", ["MAIL.GOOGLE.com"]), true);
  });

  it("skips blank entries instead of denying everything", () => {
    assert.equal(isHostDenied("example.com", ["", "   ", null, undefined]), false);
  });

  it("denies nothing without a hostname or a list", () => {
    assert.equal(isHostDenied("", ["example.com"]), false);
    assert.equal(isHostDenied("example.com", []), false);
    assert.equal(isHostDenied("example.com"), false);
  });
});

describe("addDeniedHost / removeDeniedHost", () => {
  it("adds a normalized entry", () => {
    assert.deepEqual(addDeniedHost([], "https://www.Example.com/path"), ["example.com"]);
  });

  it("does not add a host the list already covers", () => {
    assert.deepEqual(addDeniedHost(["example.com"], "blog.example.com"), ["example.com"]);
    assert.deepEqual(addDeniedHost(["example.com"], "example.com"), ["example.com"]);
  });

  it("keeps existing entries untouched when adding", () => {
    assert.deepEqual(addDeniedHost(["a.com"], "b.com"), ["a.com", "b.com"]);
  });

  it("ignores an unusable hostname", () => {
    assert.deepEqual(addDeniedHost(["a.com"], ""), ["a.com"]);
  });

  it("removes every entry that was covering the host", () => {
    // Turning the toggle back off must actually re-enable the site, so a parent
    // entry that covers it has to go too — otherwise the switch would not stick.
    assert.deepEqual(removeDeniedHost(["example.com", "other.com"], "blog.example.com"), [
      "other.com",
    ]);
    assert.deepEqual(removeDeniedHost(["www.example.com"], "example.com"), []);
  });

  it("leaves unrelated entries in place", () => {
    assert.deepEqual(removeDeniedHost(["a.com", "b.com"], "a.com"), ["b.com"]);
  });
});
