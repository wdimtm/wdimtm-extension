/**
 * Builds the upload artifact for the Chrome Web Store.
 *
 * The zip is built from the public publish set, not from the private working
 * tree. A checkout that still contains cloud/ or docs/internal/ is assembled
 * first; the public mirror, which already is that set, builds in place. Either
 * way the bytes uploaded are the bytes a stranger gets from wdimtm-extension.
 *
 * `npm run build` produces a *loadable* directory; the dashboard wants a zip
 * whose manifest sits at the root. Doing that by hand is how a stale dist/, a
 * mismatched version, or an unjustified permission reaches a reviewer, so the
 * preflight checks that have caught us before run here rather than in a
 * checklist someone has to remember.
 *
 *   npm run package
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { checkStoreListing } from "./check-store-listing.mjs";
import { assemble } from "./publish-set.mjs";

const run = promisify(execFile);
const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

/**
 * The private working copy contains files that must not ship. Packaging it
 * directly is how a closed file ends up in the store zip.
 * @param {string} repoRoot
 */
export function shouldStagePublishSet(repoRoot) {
  return (
    existsSync(path.join(repoRoot, "cloud")) ||
    existsSync(path.join(repoRoot, "docs/internal"))
  );
}

/**
 * @param {string} repoRoot
 * @returns {Promise<{ tree: string, cleanup: () => Promise<void> }>}
 */
async function treeToPackage(repoRoot) {
  if (!shouldStagePublishSet(repoRoot)) return { tree: repoRoot, cleanup: async () => {} };

  const tree = path.join(os.tmpdir(), `wdimtm-publish-${process.pid}`);
  await assemble(tree, repoRoot);
  const modules = path.join(repoRoot, "node_modules");
  if (existsSync(modules)) {
    await symlink(modules, path.join(tree, "node_modules"), "dir");
  }
  return {
    tree,
    cleanup: () => rm(tree, { recursive: true, force: true }),
  };
}

async function main() {
const { tree, cleanup } = await treeToPackage(root);

try {
  /** Things that must be true, and things that only deserve a warning. */
  const problems = [];
  const warnings = [];

  const pkg = JSON.parse(await readFile(path.join(tree, "package.json"), "utf8"));
  const manifest = JSON.parse(
    await readFile(path.join(tree, "extension/manifest.json"), "utf8")
  );

  if (manifest.version !== pkg.version) {
    problems.push(
      `version mismatch: extension/manifest.json is ${manifest.version}, package.json is ${pkg.version}`
    );
  }

  const listing = await checkStoreListing(tree);
  if (listing.skipped) {
    problems.push("docs/chrome-web-store.md is missing from the tree being packaged");
  }
  for (const p of listing.missing) {
    problems.push(`no justification in docs/chrome-web-store.md for: ${p}`);
  }
  for (const p of listing.stale) {
    problems.push(`docs/chrome-web-store.md justifies a removed permission: ${p}`);
  }
  for (const f of listing.tooLong || []) {
    problems.push(
      `"${f.heading}" submits ${f.length} characters; the dashboard field holds ${f.limit}`
    );
  }

  // The OAuth client id can only be created once the extension has an id, so the
  // first submission legitimately ships without one. It must not be a surprise.
  if (String(manifest.oauth2?.client_id || "").includes("REPLACE_WITH")) {
    warnings.push(
      "oauth2.client_id is still the placeholder — WDIMTM Cloud sign-in will fail in this build.\n" +
        "    Fine for a BYOK-only submission; see cloud/README.md before selling anything."
    );
  }

  if (problems.length) {
    console.error("Cannot package:\n");
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("");
    // exitCode, not exit(): exit() would skip the finally that removes the staged tree.
    process.exitCode = 1;
    return;
  }

  // Always rebuild: packaging whatever happened to be in dist/ is how a fix that
  // was never compiled gets uploaded. Build the publish set, not the private tree.
  await run(process.execPath, [path.join(tree, "scripts/build.mjs")], { cwd: tree });

  const outDir = path.join(root, "dist-package");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const zipName = `wdimtm-${manifest.version}.zip`;
  const zipPath = path.join(outDir, zipName);

  try {
    // -r recurse, -X drop macOS extended attributes, -x skip Finder droppings.
    await run("zip", ["-r", "-X", "-q", zipPath, ".", "-x", ".*", "-x", "__MACOSX/*"], {
      cwd: path.join(tree, "dist"),
    });
  } catch (err) {
    console.error(
      "zip failed. The Chrome Web Store needs a zip with manifest.json at its root:\n" +
        `  cd dist && zip -r ../${zipName} .`
    );
    throw err;
  }

  const { size } = await stat(zipPath);
  const from = tree === root ? "this tree" : "the public publish set";
  console.log(
    `packaged → ${path.relative(root, zipPath)} (${(size / 1024).toFixed(0)} KB), built from ${from}`
  );
  for (const w of warnings) console.log(`\n  ! ${w}`);
  console.log(
    "\nUpload it at https://chrome.google.com/webstore/devconsole → Items → Add new item."
  );
} finally {
  await cleanup();
}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
