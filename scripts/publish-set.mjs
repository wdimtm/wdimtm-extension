/**
 * Assembles the tree that goes to the public mirror and to the Chrome Web Store.
 *
 * The private repository stays the working copy. cloud/ is a second host for
 * core/, and GitHub issues live here, so the open client is developed in this
 * tree. What leaves is every tracked file that is not on the private list
 * below and does not import cloud/src. A new file is public until someone adds
 * it to that list — the opposite of an allow-list, which silently keeps new
 * work private.
 *
 * The store zip is built from this tree, not from the private checkout, so
 * the uploaded package cannot contain a file the mirror does not.
 *
 *   node scripts/publish-set.mjs <target-dir>
 *   node scripts/publish-set.mjs --list
 */

import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

/**
 * Closed features and the machinery that exists only to publish or track them.
 * Everything else that is tracked is the open client.
 */
export const PRIVATE = [
  // Paid service: Worker, credits, billing, D1.
  "cloud",
  // Price hypothesis, private roadmap, mirror token setup.
  "docs/internal",
  // The publisher. A copy of it on the public repo would try to publish itself.
  ".github/workflows/mirror.yml",
  // Stands in for the private backend.
  "scripts/wdimtm-cloud-mock-server.mjs",
];

/** npm scripts that only make sense with cloud/ present. */
export const DROP_SCRIPTS = [
  "cloud:mock",
  "cloud:dev",
  "cloud:deploy",
  "cloud:migrate",
  "cloud:migrate:remote",
  "test:cloud",
  "check:agentaab",
];

/**
 * An import of cloud/src, not a mention of it — the same pattern the mirror
 * workflow's last gate greps for. A file that imports the closed service cannot
 * run on the mirror, and a suite that fails on checkout is worse than a smaller
 * one. These used to be listed by hand above, and a new one (#158) was missed,
 * so the mirror refused every push from then on.
 */
const CLOUD_SRC_IMPORT = /(from|import|require)\s*\(?\s*['"][^'"]*cloud\/src/;

/**
 * @param {string} source
 */
export function importsCloudSrc(source) {
  return CLOUD_SRC_IMPORT.test(source);
}

/**
 * Private by path alone. A file can also be private by what it imports; see
 * publishableFiles.
 * @param {string} rel
 */
export function isPrivate(rel) {
  const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  return PRIVATE.some((entry) => norm === entry || norm.startsWith(`${entry}/`));
}

/**
 * @param {string} repoRoot
 * @returns {Promise<string[]>}
 */
export async function trackedFiles(repoRoot) {
  const { stdout } = await exec("git", ["ls-files", "-z"], { cwd: repoRoot });
  return stdout.split("\0").filter(Boolean);
}

/**
 * Every tracked file that goes out: not private by path, and — for scripts —
 * not importing cloud/src.
 * @param {string} repoRoot
 * @returns {Promise<string[]>}
 */
export async function publishableFiles(repoRoot) {
  const out = [];
  for (const rel of await trackedFiles(repoRoot)) {
    if (isPrivate(rel)) continue;
    if (/\.m?js$/.test(rel) && importsCloudSrc(await readFile(path.join(repoRoot, rel), "utf8"))) {
      continue;
    }
    out.push(rel);
  }
  return out;
}

/**
 * Copy the publish set into `target`, replacing it. Rewrites package.json so
 * the copy does not advertise scripts or a repository the stranger does not have.
 *
 * @param {string} target
 * @param {string} [repoRoot]
 */
export async function assemble(target, repoRoot = root) {
  const files = await publishableFiles(repoRoot);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  for (const rel of files) {
    const from = path.join(repoRoot, rel);
    const to = path.join(target, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to);
  }

  const pkgPath = path.join(target, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  for (const name of DROP_SCRIPTS) delete pkg.scripts?.[name];
  pkg.repository = {
    type: "git",
    url: "git+https://github.com/wdimtm/wdimtm-extension.git",
  };
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return files;
}

async function main() {
  if (process.argv.includes("--list")) {
    console.log("private (stays in this repo):");
    for (const entry of PRIVATE) console.log("   ", entry);
    console.log("    and every script that imports cloud/src");
    console.log("npm scripts dropped:", DROP_SCRIPTS.join(", "));
    console.log("everything else that is tracked is published");
    return;
  }

  const target = process.argv[2];
  if (!target) {
    console.error("usage: node scripts/publish-set.mjs <target-dir>");
    process.exit(1);
  }
  const files = await assemble(target);
  console.log(`publish set assembled → ${target} (${files.length} files)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
