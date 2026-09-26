import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";

import { DROP_SCRIPTS, PRIVATE, assemble, isPrivate } from "../../scripts/publish-set.mjs";
import { shouldStagePublishSet } from "../../scripts/package.mjs";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");

describe("publish set", () => {
  it("keeps the closed service private and publishes the client", () => {
    assert.equal(isPrivate("cloud/src/worker.js"), true);
    assert.equal(isPrivate("docs/internal/MIRROR.md"), true);
    assert.equal(isPrivate(".github/workflows/mirror.yml"), true);
    assert.equal(isPrivate("scripts/wdimtm-cloud-mock-server.mjs"), true);
    assert.equal(isPrivate("tests/unit/cloud-worker.test.mjs"), true);

    assert.equal(isPrivate("extension/manifest.json"), false);
    assert.equal(isPrivate("core/service-mode.js"), false);
    assert.equal(isPrivate("docs/service-modes.md"), false);
    assert.equal(isPrivate("docs/cloud-api-contract.md"), false);
    assert.equal(isPrivate("docs/research-agent-contract.md"), false);
    assert.equal(isPrivate("docs/chrome-web-store.md"), false);
    assert.equal(isPrivate("scripts/publish-store.mjs"), false);
    assert.equal(isPrivate(".github/workflows/ci.yml"), false);
  });

  it("partitions every tracked file, and the copy stands without the private set", async (t) => {
    let tracked;
    try {
      const { stdout } = await exec("git", ["ls-files", "-z"], { cwd: root });
      tracked = stdout.split("\0").filter(Boolean);
    } catch (error) {
      const message = `${error.stderr || ""}\n${error.message || ""}`;
      if (message.includes("not a git repository")) {
        // The mirror workflow tests the assembled file tree before it is a
        // checkout. A clone of either repository still runs this assertion.
        t.skip("assembled publish tree is a file copy, not a checkout");
        return;
      }
      throw error;
    }
    assert.ok(tracked.length > 0);

    const dir = await mkdtemp(path.join(os.tmpdir(), "wdimtm-publish-"));
    try {
      const published = await assemble(dir, root);
      assert.equal(published.length, tracked.filter((rel) => !isPrivate(rel)).length);

      for (const rel of tracked) {
        const present = existsSync(path.join(dir, rel));
        assert.equal(present, !isPrivate(rel), rel);
      }
      for (const entry of PRIVATE) {
        assert.equal(existsSync(path.join(dir, entry)), false, `${entry} leaked`);
      }

      const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
      for (const name of DROP_SCRIPTS) {
        assert.equal(pkg.scripts?.[name], undefined, `${name} still in the public package.json`);
      }
      assert.equal(pkg.scripts["store:upload"], "node scripts/publish-store.mjs");
      assert.equal(pkg.scripts["store:publish"], "node scripts/publish-store.mjs --submit-only");
      assert.match(pkg.repository.url, /wdimtm\/wdimtm-extension/);
      assert.equal(existsSync(path.join(dir, "docs/chrome-web-store.md")), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stages a publish set only when this tree still holds closed files", () => {
    const closedHere =
      existsSync(path.join(root, "cloud")) ||
      existsSync(path.join(root, "docs/internal"));
    assert.equal(shouldStagePublishSet(root), closedHere);
    assert.equal(
      shouldStagePublishSet(path.join(root, "docs")),
      false,
      "a tree without cloud/ or docs/internal is already the public set"
    );
  });
});
