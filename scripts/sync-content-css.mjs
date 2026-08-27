/**
 * Regenerate extension/content/styles.inline.js from styles.css.
 *
 * The content script cannot `fetch()` its own stylesheet on every page, so the
 * CSS is shipped as a JS string and injected into the shadow root. Run this
 * after editing styles.css: `npm run sync:css`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dir = new URL("../extension/content/", import.meta.url);
const src = new URL("styles.css", dir);
const out = new URL("styles.inline.js", dir);

const css = await readFile(src, "utf8");

// Escape non-ASCII so the emitted content script stays byte-safe regardless of
// how the browser decodes the file.
const literal = JSON.stringify(css).replace(/[\u0080-\uffff]/g, (ch) =>
  `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`
);

const banner = "/* Auto-synced from styles.css — do not edit by hand. */\n";
await writeFile(out, `${banner}export const CONTENT_CSS = ${literal};\n`, "utf8");

console.log(`synced ${css.length} chars → ${fileURLToPath(out)}`);
