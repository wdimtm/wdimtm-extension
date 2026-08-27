/**
 * Builds the upload artifact for the Chrome Web Store.
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
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { checkStoreListing } from "./check-store-listing.mjs";

const run = promisify(execFile);
const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const dist = path.join(root, "dist");
const outDir = path.join(root, "dist-package");

/** Things that must be true, and things that only deserve a warning. */
const problems = [];
const warnings = [];

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "extension/manifest.json"), "utf8"));

if (manifest.version !== pkg.version) {
  problems.push(
    `version mismatch: extension/manifest.json is ${manifest.version}, package.json is ${pkg.version}`
  );
}

const listing = await checkStoreListing();
for (const p of listing.missing) {
  problems.push(`no justification in docs/internal/chrome-web-store.md for: ${p}`);
}
for (const p of listing.stale) {
  problems.push(`docs/internal/chrome-web-store.md justifies a removed permission: ${p}`);
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
  process.exit(1);
}

// Always rebuild: packaging whatever happened to be in dist/ is how a fix that
// was never compiled gets uploaded.
await run(process.execPath, [path.join(root, "scripts/build.mjs")], { cwd: root });

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const zipName = `wdimtm-${manifest.version}.zip`;
const zipPath = path.join(outDir, zipName);

try {
  // -r recurse, -X drop macOS extended attributes, -x skip Finder droppings.
  await run("zip", ["-r", "-X", "-q", zipPath, ".", "-x", ".*", "-x", "__MACOSX/*"], {
    cwd: dist,
  });
} catch (err) {
  console.error(
    "zip failed. The Chrome Web Store needs a zip with manifest.json at its root:\n" +
      `  cd dist && zip -r ../${zipName} .`
  );
  throw err;
}

const { size } = await stat(zipPath);
console.log(`packaged → ${path.relative(root, zipPath)} (${(size / 1024).toFixed(0)} KB)`);
for (const w of warnings) console.log(`\n  ! ${w}`);
console.log(
  "\nUpload it at https://chrome.google.com/webstore/devconsole → Items → Add new item."
);
