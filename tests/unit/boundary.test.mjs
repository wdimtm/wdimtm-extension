import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

/**
 * The boundary is only worth extracting if it is enforced. Without this, the
 * first `import { getSettings }` inside core silently recreates exactly the
 * coupling that made cloud/ inextractable in the first place.
 */
describe("core/host boundary", () => {
  it("passes its own check", () => {
    const out = execFileSync("node", ["scripts/check-boundary.mjs", "--check"], {
      encoding: "utf8",
    });
    assert.match(out, /Boundary intact/);
  });

  it("reports a split rather than silently passing on an empty scan", () => {
    const out = execFileSync("node", ["scripts/check-boundary.mjs"], { encoding: "utf8" });
    const core = Number(/core: (\d+) files/.exec(out)?.[1]);
    const host = Number(/host shell: (\d+) files/.exec(out)?.[1]);
    assert.ok(core > 30, `expected a substantial core, got ${core}`);
    assert.ok(host > 0, `expected a host shell, got ${host}`);
  });
});
