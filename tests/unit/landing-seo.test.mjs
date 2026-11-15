import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const landing = join(root, "landing");

describe("landing SEO artifacts (#127)", () => {
  it("sitemap.xml exists, declares urlset namespace, and lists only canonicals", () => {
    const xml = readFileSync(join(landing, "sitemap.xml"), "utf8");
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
    assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
    const opens = (xml.match(/<url>/g) || []).length;
    const closes = (xml.match(/<\/url>/g) || []).length;
    assert.equal(opens, closes);
    assert.ok(opens >= 2);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(new Set(locs), new Set(["https://wdimtm.com/", "https://wdimtm.com/privacy"]));
    assert.ok(!locs.some((u) => u.includes("checkout") || u.includes("?lang=")));
  });

  it("sitemap locs and hreflang match page canonical/hreflang tags", () => {
    const xml = readFileSync(join(landing, "sitemap.xml"), "utf8");
    const indexHtml = readFileSync(join(landing, "index.html"), "utf8");
    const privacyHtml = readFileSync(join(landing, "privacy.html"), "utf8");
    const canonical = (html) => {
      const m = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/i);
      assert.ok(m, "missing canonical");
      return m[1];
    };
    assert.ok(xml.includes(`<loc>${canonical(indexHtml)}</loc>`));
    assert.ok(xml.includes(`<loc>${canonical(privacyHtml)}</loc>`));
    const pageHreflang = [...indexHtml.matchAll(/<link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"\s*\/?>/gi)]
      .map((m) => [m[1], m[2]]);
    const sitemapHreflang = [...xml.matchAll(/<xhtml:link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"\s*\/>/g)]
      .map((m) => [m[1], m[2]]);
    assert.deepEqual(sitemapHreflang, pageHreflang);
  });

  it("robots.txt declares sitemap and disallows checkout", () => {
    const robots = readFileSync(join(landing, "robots.txt"), "utf8");
    assert.match(robots, /Sitemap:\s*https:\/\/wdimtm\.com\/sitemap\.xml/);
    assert.match(robots, /Disallow:\s*\/checkout\//);
    assert.match(robots, /User-agent:\s*\*/);
    assert.match(robots, /Allow:\s*\//);
  });

  it(".assetsignore does not exclude sitemap.xml or robots.txt", () => {
    const ignore = readFileSync(join(landing, ".assetsignore"), "utf8");
    const lines = ignore.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    assert.ok(!lines.includes("sitemap.xml"));
    assert.ok(!lines.includes("robots.txt"));
    assert.ok(!lines.includes("*.xml"));
    assert.ok(!lines.includes("*.txt"));
  });
});
