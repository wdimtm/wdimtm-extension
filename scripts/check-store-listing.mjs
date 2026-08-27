/**
 * Guards the one thing that reliably bounces a Chrome Web Store submission:
 * a permission in the manifest with no justification written for it, or a
 * justification left behind for a permission that was removed.
 *
 * The listing copy lives in docs/internal/chrome-web-store.md, which is not
 * published to the public mirror — so a missing file is "nothing to check",
 * not a failure.
 *
 *   node scripts/check-store-listing.mjs
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

const MANIFEST = path.join(root, "extension/manifest.json");
const LISTING = path.join(root, "docs/internal/chrome-web-store.md");

/**
 * Every permission string the dashboard will ask us to justify, in the order
 * the manifest declares them.
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
export function declaredPermissions(manifest) {
  const out = [
    ...(manifest.permissions || []),
    ...(manifest.host_permissions || []),
    ...(manifest.optional_permissions || []),
    ...(manifest.optional_host_permissions || []),
  ];
  for (const script of manifest.content_scripts || []) {
    out.push(...(script.matches || []));
  }
  return [...new Set(out.map(String))];
}

/**
 * A justification counts as present when the listing mentions the permission
 * verbatim in backticks — that is how every entry in the file is written, and
 * matching loosely would let a renamed host slip through.
 * @param {string} listing
 * @param {string} permission
 */
export function isJustified(listing, permission) {
  return listing.includes(`\`${permission}\``);
}

/**
 * @param {{ manifest: Record<string, any>, listing: string }} input
 * @returns {{ missing: string[], stale: string[] }}
 */
export function diffListing({ manifest, listing }) {
  const declared = declaredPermissions(manifest);
  const missing = declared.filter((p) => !isJustified(listing, p));

  // Anything the listing justifies as a match pattern that the manifest no
  // longer declares. Only `…/*` counts: bare permission names (`storage`) are
  // too generic to scan for, and the file also quotes plain URLs — an API base
  // URL in the test instructions is not a permission.
  const justified = [...listing.matchAll(/`((?:https?|\*):\/\/[^`]+\/\*)`/g)].map((m) => m[1]);
  const stale = [...new Set(justified)].filter((p) => !declared.includes(p));

  return { missing, stale };
}

/**
 * @returns {Promise<{ skipped: boolean, missing: string[], stale: string[] }>}
 */
export async function checkStoreListing() {
  if (!existsSync(LISTING)) return { skipped: true, missing: [], stale: [] };
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const listing = await readFile(LISTING, "utf8");
  return { skipped: false, ...diffListing({ manifest, listing }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkStoreListing();
  if (result.skipped) {
    console.log("store listing: docs/internal/chrome-web-store.md not present — skipped.");
    process.exit(0);
  }
  for (const p of result.missing) {
    console.error(`missing justification for manifest permission: ${p}`);
  }
  for (const p of result.stale) {
    console.error(`listing justifies a host the manifest no longer declares: ${p}`);
  }
  if (result.missing.length || result.stale.length) {
    console.error("\nFix docs/internal/chrome-web-store.md before submitting.");
    process.exit(1);
  }
  console.log("store listing: every manifest permission has a justification.");
}
