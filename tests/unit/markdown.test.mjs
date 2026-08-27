import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  formatInlineMarkdown,
  formatMarkdown,
} from "../../core/markdown.js";

describe("markdown renderer", () => {
  it("escapes raw HTML from the model", () => {
    const html = formatMarkdown(`Hello <script>alert(1)</script> **world**`);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<strong>world<\/strong>/);
  });

  it("renders bold, italic, inline code, and links", () => {
    const html = formatMarkdown(
      `Use **Redis** for _cache_ and \`SET\` key. See [docs](https://example.com/docs).`
    );
    assert.match(html, /<strong>Redis<\/strong>/);
    assert.match(html, /<em>cache<\/em>/);
    assert.match(html, /<code>SET<\/code>/);
    assert.match(html, /href="https:\/\/example.com\/docs"/);
    assert.match(html, /rel="noopener noreferrer"/);
  });

  it("autolinks bare https URLs", () => {
    const html = formatMarkdown(`Read https://example.com/path more`);
    assert.match(html, /<a href="https:\/\/example.com\/path"/);
  });

  it("rejects non-http link schemes", () => {
    const html = formatMarkdown(`Click [x](javascript:alert(1)) please`);
    assert.doesNotMatch(html, /href=/);
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /Click x please/);
  });

  it("renders fenced code blocks without interpreting markdown inside", () => {
    const md = ["```js", "const x = **not bold**", "```"].join("\n");
    const html = formatMarkdown(md);
    assert.match(html, /<pre class="wdimtm-pre"/);
    assert.match(html, /data-lang="js"/);
    assert.match(html, /const x = \*\*not bold\*\*/);
    assert.doesNotMatch(html, /<strong>not bold<\/strong>/);
  });

  it("renders headings, lists, blockquotes, and hr", () => {
    const md = [
      "## Why",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "> note",
      "",
      "---",
      "",
      "Done",
    ].join("\n");
    const html = formatMarkdown(md);
    assert.match(html, /<h2 class="wdimtm-h">Why<\/h2>/);
    assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
    assert.match(html, /<blockquote class="wdimtm-quote">note<\/blockquote>/);
    assert.match(html, /<hr class="wdimtm-hr"/);
    assert.match(html, /<p>Done<\/p>/);
  });

  it("formatInlineMarkdown works on escaped input", () => {
    const s = formatInlineMarkdown(escapeHtml("a **b** c"));
    assert.equal(s, "a <strong>b</strong> c");
  });

  it("returns empty string for blank input", () => {
    assert.equal(formatMarkdown("   \n  "), "");
  });

  it("renders GFM pipe tables", () => {
    const md = [
      "| 方面 | Redis Cluster | 一致性哈希 |",
      "| --- | --- | --- |",
      "| 基本单位 | 固定 hash slot | 哈希环上的虚拟节点 |",
      "| 节点变化 | 需要迁移 slot | 通常只影响相邻 key |",
    ].join("\n");
    const html = formatMarkdown(md);
    assert.match(html, /<table class="wdimtm-table">/);
    assert.match(html, /<th>方面<\/th>/);
    assert.match(html, /<th>Redis Cluster<\/th>/);
    assert.match(html, /<td>固定 hash slot<\/td>/);
    assert.match(html, /一致性哈希/);
    assert.doesNotMatch(html, /\| --- \|/);
  });
});
