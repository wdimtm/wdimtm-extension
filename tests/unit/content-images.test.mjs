import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTENT = path.join(ROOT, "extension/content/content.js");

/**
 * The module content.js uses for paste / upload / drop. Resolved from the
 * import itself, so this keeps checking the shipped path if it moves again.
 */
async function loadContentImageHelpers() {
  const src = fs.readFileSync(CONTENT, "utf8");
  const match = /import \* as WdimtmImages from "([^"]+)"/.exec(src);
  assert.ok(match, "content.js imports an image helper namespace");
  return {
    src,
    mod: await import(pathToFileURL(path.resolve(path.dirname(CONTENT), match[1])).href),
  };
}

/** @param {string} type @param {string} [name] */
function fakeFile(type, name = "shot.png") {
  return { type, name };
}

describe("content-script image helpers", () => {
  // #96 swapped a global for an import of core/images.js, which has no DOM
  // helpers — every paste, upload and drop then threw "is not a function".
  it("exports every member content.js calls", async () => {
    const { src, mod } = await loadContentImageHelpers();
    const used = new Set();
    for (const m of src.matchAll(/imageHelpers\(\)\?\.(\w+)/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bimg\??\.(\w+)\(/g)) used.add(m[1]);
    assert.ok(used.has("imageFilesFrom") && used.has("fileToAttachment"));
    for (const name of used) {
      assert.notEqual(mod[name], undefined, `content image helpers export ${name}`);
    }
  });

  it("pulls supported images out of a clipboard payload", async () => {
    const { mod } = await loadContentImageHelpers();
    const png = fakeFile("image/png");
    const pdf = fakeFile("application/pdf", "a.pdf");
    assert.deepEqual(mod.imageFilesFrom({ files: [png, pdf] }), [png]);
  });

  it("falls back to clipboard items when files is empty", async () => {
    // Chrome exposes a ⌘⇧4 screenshot only as a DataTransferItem.
    const { mod } = await loadContentImageHelpers();
    const png = fakeFile("image/png");
    const dt = {
      files: [],
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => png },
      ],
    };
    assert.deepEqual(mod.imageFilesFrom(dt), [png]);
  });

  it("caps the count and tolerates a missing payload", async () => {
    const { mod } = await loadContentImageHelpers();
    const many = Array.from({ length: 9 }, () => fakeFile("image/jpeg"));
    assert.equal(mod.imageFilesFrom({ files: many }).length, mod.MAX_ATTACHMENTS);
    assert.deepEqual(mod.imageFilesFrom(null), []);
  });

  it("rejects unsupported types before touching the DOM", async () => {
    const { mod } = await loadContentImageHelpers();
    await assert.rejects(
      mod.fileToAttachment(fakeFile("image/svg+xml", "a.svg"), "paste"),
      /Unsupported image type/
    );
  });
});
