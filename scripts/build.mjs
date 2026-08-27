/**
 * Builds the loadable extension into dist/.
 *
 * Replaces build-globals.mjs, which existed because content scripts cannot use
 * `import`. Its answer was to regenerate a few modules as IIFE copies hanging
 * off globalThis — and only one of the four copies was actually generated; the
 * other three were maintained by hand with nothing checking them for drift.
 * A bundler removes the whole category.
 *
 *   npm run build          # bundle into dist/
 *   npm run build -- --watch
 *
 * Load dist/ as the unpacked extension, not extension/.
 */

import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const out = path.join(root, "dist");
const watch = process.argv.includes("--watch");

/**
 * Content scripts get IIFE because they are injected as classic scripts; every
 * other entry is a real module page or an MV3 module worker.
 */
const ENTRIES = [
  { in: "extension/background/service-worker.js", out: "background/service-worker", format: "esm" },
  { in: "extension/options/options.js", out: "options/options", format: "esm" },
  { in: "extension/options/import.js", out: "options/import", format: "esm" },
  { in: "extension/options/popup.js", out: "options/popup", format: "esm" },
  { in: "extension/content/content.js", out: "content/content", format: "iife" },
];

/** Copied verbatim — nothing here needs compiling. */
const STATIC = [
  "extension/manifest.json",
  "extension/options/options.html",
  "extension/options/options.css",
  "extension/options/import.html",
  "extension/options/import.css",
  "extension/options/popup.html",
  "extension/icons",
  "extension/_locales",
];

async function copyStatic() {
  for (const rel of STATIC) {
    const from = path.join(root, rel);
    const to = path.join(out, rel.replace(/^extension\//, ""));
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to, { recursive: true });
  }
}

async function run() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const shared = {
    bundle: true,
    // Chrome ships the extension runtime; there is no older target to support.
    target: "chrome120",
    // Keep it readable in DevTools — this is a client someone may be reading
    // the source of, and the size difference does not matter here.
    minify: false,
    sourcemap: true,
    logLevel: "info",
  };

  for (const entry of ENTRIES) {
    const config = {
      ...shared,
      entryPoints: [path.join(root, entry.in)],
      outfile: path.join(out, `${entry.out}.js`),
      format: entry.format,
    };
    if (watch) {
      const ctx = await context(config);
      await ctx.watch();
    } else {
      await build(config);
    }
  }

  await copyStatic();
  console.log(watch ? "watching…" : `built → ${path.relative(root, out)}/`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
