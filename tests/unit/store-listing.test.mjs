import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  FIELD_LIMIT,
  checkStoreListing,
  declaredPermissions,
  diffListing,
  overLongFields,
  quotedFields,
} from "../../scripts/check-store-listing.mjs";

const root = path.resolve(import.meta.dirname, "../..");

describe("store listing permission sync", () => {
  it("collects every permission the dashboard will ask about", () => {
    const declared = declaredPermissions({
      permissions: ["storage"],
      host_permissions: ["https://api.openai.com/*"],
      optional_host_permissions: ["http://127.0.0.1/*"],
      content_scripts: [{ matches: ["http://*/*", "https://*/*"] }],
    });
    assert.deepEqual(declared, [
      "storage",
      "https://api.openai.com/*",
      "http://127.0.0.1/*",
      "http://*/*",
      "https://*/*",
    ]);
  });

  it("reports a permission the listing never justifies", () => {
    const { missing } = diffListing({
      manifest: { host_permissions: ["https://api.anthropic.com/*"] },
      listing: "justifies `https://api.openai.com/*` only",
    });
    assert.deepEqual(missing, ["https://api.anthropic.com/*"]);
  });

  it("reports a justification left behind by a removed permission", () => {
    const { stale } = diffListing({
      manifest: { host_permissions: [] },
      listing: "still explains `https://oauth2.googleapis.com/*`",
    });
    assert.deepEqual(stale, ["https://oauth2.googleapis.com/*"]);
  });

  it("does not mistake a quoted API base URL for a permission", () => {
    const { stale } = diffListing({
      manifest: { host_permissions: [] },
      listing: "API base URL: `https://api.openai.com/v1`",
    });
    assert.deepEqual(stale, []);
  });

  it("the shipped manifest and listing agree", async () => {
    const result = await checkStoreListing();
    if (result.skipped) return; // public mirror: the listing copy is not published
    assert.deepEqual(result.missing, [], "manifest permissions with no justification");
    assert.deepEqual(result.stale, [], "justifications for permissions that are gone");
  });

  it("the manifest declares no loopback port, because match patterns have none", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(root, "extension/manifest.json"), "utf8")
    );
    for (const pattern of manifest.optional_host_permissions || []) {
      assert.ok(
        !/:\d+\/\*$/.test(pattern),
        `${pattern} is redundant — a host match pattern already covers every port`
      );
    }
  });
});

describe("dashboard field limits", () => {
  it("reads a quoted field as the text that gets pasted, line breaks and all", () => {
    const fields = quotedFields(
      ["**`storage`**", "", "> Stores settings.", "> 1. one", "> 2. two", ""].join("\n")
    );
    assert.deepEqual(fields, [{ heading: "storage", body: "Stores settings.\n1. one\n2. two" }]);
  });

  it("flags a justification the dashboard would truncate", () => {
    const listing = `**\`storage\`**\n\n> ${"x".repeat(FIELD_LIMIT + 1)}\n`;
    assert.deepEqual(overLongFields(listing), [
      { heading: "storage", length: FIELD_LIMIT + 1 },
    ]);
  });

  it("leaves a field that exactly fills the field alone", () => {
    const listing = `**\`storage\`**\n\n> ${"x".repeat(FIELD_LIMIT)}\n`;
    assert.deepEqual(overLongFields(listing), []);
  });

  it("every field in the shipped listing fits the dashboard", async () => {
    const result = await checkStoreListing();
    if (result.skipped) return; // public mirror: the listing copy is not published
    assert.deepEqual(result.tooLong, [], "fields the dashboard would cut off mid-sentence");
  });
});
