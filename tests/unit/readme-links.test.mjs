import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { EXCLUDE, INCLUDE } from "../../scripts/publish-set.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const READMES = ["README.md", "README.zh-CN.md"];

/** Relative (non-http, non-anchor) link and image targets. */
function targets(markdown) {
  const images = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
  const links = [...markdown.matchAll(/(?<!!)\[[^\]]+\]\((?!https?:)([^)#]+)\)/g)].map((m) =>
    m[1].trim()
  );
  return { images, links: links.filter((l) => l && !l.startsWith("#")) };
}

/** Is this path carried to the public mirror? */
function published(target) {
  const top = target.split("/")[0];
  if (!INCLUDE.includes(top) && !INCLUDE.includes(target)) return false;
  return !EXCLUDE.some((ex) => target === ex || target.startsWith(`${ex}/`));
}

describe("README links survive the trip to the mirror", () => {
  for (const name of READMES) {
    it(`${name}: every image exists and is published`, async () => {
      const md = await readFile(path.join(root, name), "utf8");
      const { images } = targets(md);
      assert.ok(images.length > 0, "a README with no screenshots is the thing this guards");
      for (const src of images) {
        assert.ok(existsSync(path.join(root, src)), `${src} does not exist`);
        assert.ok(published(src), `${src} is not in the publish set — broken on the mirror`);
      }
    });

    it(`${name}: no relative link points at something the mirror drops`, async () => {
      const md = await readFile(path.join(root, name), "utf8");
      for (const link of targets(md).links) {
        assert.ok(existsSync(path.join(root, link)), `${link} does not exist`);
        // A link into cloud/ or docs/internal/ renders as a 404 for every
        // visitor to the public repository, which is where this README lives.
        assert.ok(published(link), `${link} is not published — dead link on the mirror`);
      }
    });
  }

  it("the Chinese README is published alongside the English one", () => {
    for (const name of READMES) assert.ok(INCLUDE.includes(name), `${name} missing from INCLUDE`);
  });
});
