/**
 * styles.inline.js is the same CSS as styles.css, embedded for the shadow root.
 * Keeping the copy generated means the two can never drift.
 *
 *   npm run build:css
 */
import { readFileSync, writeFileSync } from "node:fs";

const css = readFileSync(new URL("../extension/content/styles.css", import.meta.url), "utf8");
const out = `/* Auto-synced from styles.css — do not edit by hand. */\nwindow.__WDIMTM_CSS__ = ${JSON.stringify(
  css
)};\n`;
writeFileSync(new URL("../extension/content/styles.inline.js", import.meta.url), out);
console.log(`styles.inline.js updated (${css.length} bytes of CSS)`);
