import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DOMAIN_LENS_PRESETS,
  formatDomainLensRules,
  hasDomainRule,
  parseDomainLensRules,
  resolveDefaultLensId,
  resolveDomainLens,
  setDomainLens,
} from "../../core/domain-lenses.js";

const AVAILABLE = ["general", "sanity", "fact-check", "opportunities", "engineering", "investing"];

describe("domain lens rules", () => {
  it("parses one rule per line, tolerating the ways people write them", () => {
    const rules = parseDomainLensRules(
      [
        "x.com = sanity",
        "  news.ycombinator.com: engineering  ",
        "https://github.com/anything → engineering",
        "",
        "# a comment",
      ].join("\n")
    );
    assert.deepEqual(rules, [
      { host: "x.com", lensId: "sanity" },
      { host: "news.ycombinator.com", lensId: "engineering" },
      { host: "github.com", lensId: "engineering" },
    ]);
  });

  it("drops incomplete lines instead of storing half a rule", () => {
    assert.deepEqual(parseDomainLensRules("x.com\n= sanity\n   "), []);
  });

  it("round-trips through the textarea format", () => {
    const text = "x.com = sanity\ngithub.com = engineering";
    assert.equal(formatDomainLensRules(parseDomainLensRules(text)), text);
  });

  it("matches subdomains the same way the denylist does", () => {
    const rules = [{ host: "x.com", lensId: "sanity" }];
    assert.equal(resolveDomainLens("x.com", rules), "sanity");
    assert.equal(resolveDomainLens("mobile.x.com", rules), "sanity");
    // Not a suffix match on the raw string: "notx.com" is a different site.
    assert.equal(resolveDomainLens("notx.com", rules), null);
    assert.equal(resolveDomainLens("example.com", rules), null);
  });

  it("lets the more specific host win", () => {
    const rules = [
      { host: "reddit.com", lensId: "sanity" },
      { host: "old.reddit.com", lensId: "engineering" },
    ];
    assert.equal(resolveDomainLens("old.reddit.com", rules), "engineering");
    assert.equal(resolveDomainLens("www.reddit.com", rules), "sanity");
  });

  it("resolves a domain rule ahead of the global default", () => {
    const rules = [{ host: "x.com", lensId: "sanity" }];
    assert.equal(
      resolveDefaultLensId({
        hostname: "x.com",
        rules,
        defaultLensId: "general",
        availableLensIds: AVAILABLE,
      }),
      "sanity"
    );
    assert.equal(
      resolveDefaultLensId({
        hostname: "example.com",
        rules,
        defaultLensId: "investing",
        availableLensIds: AVAILABLE,
      }),
      "investing"
    );
  });

  it("ignores a rule whose lens no longer exists", () => {
    // A custom lens can be deleted while a rule still names it. Falling back is
    // right; sending an unknown lens id to the runtime is not.
    assert.equal(
      resolveDefaultLensId({
        hostname: "x.com",
        rules: [{ host: "x.com", lensId: "deleted-custom-lens" }],
        defaultLensId: "general",
        availableLensIds: AVAILABLE,
      }),
      "general"
    );
  });

  it("survives a page with no usable hostname", () => {
    const rules = [{ host: "x.com", lensId: "sanity" }];
    assert.equal(resolveDomainLens("", rules), null);
    assert.equal(
      resolveDefaultLensId({ hostname: "", rules, defaultLensId: "general" }),
      "general"
    );
  });

  it("remembers an explicit pick where the default came from", () => {
    // On a site that already has a rule, picking a lens must update *that* rule.
    // Writing it to the global default would silently change every other site
    // the user never touched.
    const rules = [{ host: "x.com", lensId: "sanity" }];
    assert.equal(hasDomainRule("mobile.x.com", rules), true);
    assert.equal(hasDomainRule("example.com", rules), false);

    const next = setDomainLens(rules, "x.com", "investing");
    assert.deepEqual(next, [{ host: "x.com", lensId: "investing" }]);
    assert.deepEqual(rules, [{ host: "x.com", lensId: "sanity" }], "input untouched");

    const added = setDomainLens(rules, "github.com", "engineering");
    assert.equal(added.length, 2);
  });

  it("offers presets that are only suggestions", () => {
    assert.ok(DOMAIN_LENS_PRESETS.length >= 3);
    for (const p of DOMAIN_LENS_PRESETS) {
      assert.ok(p.host && p.lensId, "a preset needs both halves");
      assert.ok(AVAILABLE.includes(p.lensId), `${p.lensId} must be a built-in lens`);
    }
  });
});

describe("content script uses the tested module", () => {
  it("imports it rather than reading a hand-kept copy off a global", () => {
    // This used to assert that a generated IIFE copy stayed in sync, because
    // content scripts cannot use `import`. Bundling removed the copy — and
    // with it a drift risk that three of the four copies were never actually
    // guarded against. What still matters is that the shipped path and the
    // tested path are the same module.
    const content = readFileSync(
      new URL("../../extension/content/content.js", import.meta.url),
      "utf8"
    );
    assert.match(content, /core\/domain-lenses\.js/);
    assert.doesNotMatch(content, /__WDIMTM_DOMAIN_LENS__/);
  });
});
