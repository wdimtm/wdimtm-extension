/**
 * Assembles the tree that goes to the public mirror.
 *
 * A raw `git push` of main cannot be the mirror: main carries cloud/ (the paid
 * service) and docs/internal/ (operations, and an unvalidated price). So the
 * mirror is a published *snapshot* — explicit about what leaves, and reviewable
 * as a list rather than as a diff.
 *
 * The set is chosen so the mirror stands on its own: `npm install && npm test`
 * has to pass there, which is why the cloud-dependent tests and the cloud npm
 * scripts are dropped rather than left to fail for a stranger.
 *
 *   node scripts/publish-set.mjs <target-dir>
 *   node scripts/publish-set.mjs --list      # print the set, copy nothing
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

/** Whole directories and files that go as-is. */
export const INCLUDE = [
  "core",
  "extension",
  "fixtures",
  "landing",
  "docs",
  "scripts",
  "tests",
  "store-assets",
  "LICENSE",
  "README.md",
  ".gitignore",
  "package.json",
  "package-lock.json",
];

/** Removed after copying, by path relative to the target. */
export const EXCLUDE = [
  // The paid service and its operational docs.
  "docs/internal",
  // Tests that import cloud/src — they cannot pass without it, and shipping a
  // suite that fails on checkout is worse than shipping a smaller one.
  "tests/unit/cloud-credits.test.mjs",
  "tests/unit/cloud-packages.test.mjs",
  "tests/unit/cloud-research.test.mjs",
  "tests/unit/cloud-worker.test.mjs",
  // Deploys and mocks the private backend.
  "scripts/wdimtm-cloud-mock-server.mjs",
];

/** npm scripts that only make sense with cloud/ present. */
const DROP_SCRIPTS = ["cloud:mock", "cloud:dev", "cloud:deploy", "cloud:migrate", "cloud:migrate:remote"];

if (process.argv.includes("--list")) {
  console.log("include:");
  for (const p of INCLUDE) console.log("   ", p);
  console.log("exclude:");
  for (const p of EXCLUDE) console.log("   ", p);
  console.log("npm scripts dropped:", DROP_SCRIPTS.join(", "));
  process.exit(0);
}

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/publish-set.mjs <target-dir>");
  process.exit(1);
}

for (const rel of INCLUDE) {
  const from = path.join(root, rel);
  if (!existsSync(from)) continue;
  const to = path.join(target, rel);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

for (const rel of EXCLUDE) {
  await rm(path.join(target, rel), { recursive: true, force: true });
}

// package.json: drop the scripts that reference what is not published, and say
// plainly that this is a mirror.
const pkgPath = path.join(target, "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
for (const name of DROP_SCRIPTS) delete pkg.scripts?.[name];
pkg.repository = { type: "git", url: "git+https://github.com/wdimtm/wdimtm-extension.git" };
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`publish set assembled → ${target}`);
