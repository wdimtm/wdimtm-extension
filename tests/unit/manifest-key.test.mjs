import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

/** The Chrome Web Store item. Google sign-in redirects to `https://<this id>.chromiumapp.org/google`. */
const STORE_EXTENSION_ID = "jgjbkfelaamlhknmccbbimihhhcimocn";

/** Chrome's extension id: the first 32 hex digits of SHA-256 over the public key, mapped 0-f to a-p. */
function extensionIdFromKey(key) {
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex");
  return [...digest.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

describe("manifest key", () => {
  it("gives an unpacked build the store item's id, so one OAuth redirect serves both", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "extension/manifest.json"), "utf8"));
    assert.equal(extensionIdFromKey(manifest.key), STORE_EXTENSION_ID);
  });
});
