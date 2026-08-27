/**
 * Render the extension and site icons from the same tokens as everything else.
 *
 * The mark is the one on the promo tile and the landing page: a gold ring with
 * a serif question mark on the cream ground. It was a purple disc with a
 * sans-serif "?" — a different product's icon sitting next to this one's
 * screenshots.
 *
 * Generated rather than drawn so it cannot drift from the palette again:
 *   npm run icons
 *
 * Sizes are optically tuned, not scaled. A ring that reads at 128px disappears
 * at 16, so the toolbar size trades the ring for weight.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);

/** The palette, identical to landing/styles.css and the store assets. */
const CREAM = "#f3f2f2";
const GOLD = "#b68235";
const DEEP = "#7d5411";

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&display=swap"' +
  ' rel="stylesheet">';

/**
 * @param {number} size
 * @param {{ ring: number, glyph: number, dy: number, solid?: boolean }} spec
 */
const html = (size, spec) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}
<style>
  html,body{margin:0;padding:0;background:transparent}
  .icon{
    width:${size}px;height:${size}px;box-sizing:border-box;border-radius:50%;
    background:${spec.solid ? GOLD : CREAM};
    ${spec.solid ? "" : `border:${spec.ring}px solid ${GOLD};`}
    display:flex;align-items:center;justify-content:center;
    font-family:"Cormorant Garamond",Palatino,serif;font-weight:600;
    font-size:${spec.glyph}px;line-height:1;
    color:${spec.solid ? CREAM : DEEP};
  }
  .glyph{transform:translateY(${spec.dy}px)}
</style></head><body><div class="icon"><span class="glyph">?</span></div></body></html>`;

/** Optical tuning per size — see the note at the top. */
const ICONS = [
  { out: "extension/icons/icon16.png", size: 16, spec: { ring: 1, glyph: 13, dy: 0.5, solid: true } },
  { out: "extension/icons/icon48.png", size: 48, spec: { ring: 2.5, glyph: 38, dy: 1.5 } },
  { out: "extension/icons/icon128.png", size: 128, spec: { ring: 6, glyph: 100, dy: 4 } },
  { out: "landing/favicon.png", size: 48, spec: { ring: 2.5, glyph: 38, dy: 1.5 } },
  { out: "landing/icon.png", size: 128, spec: { ring: 6, glyph: 100, dy: 4 } },
];

const browser = await chromium.launch();
for (const icon of ICONS) {
  const page = await browser.newPage({
    viewport: { width: icon.size, height: icon.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(html(icon.size, icon.spec));
  await page.waitForLoadState("networkidle");
  const file = new URL(icon.out, root);
  await mkdir(new URL(".", file), { recursive: true });
  await writeFile(fileURLToPath(file), await page.screenshot({ omitBackground: true }));
  console.log(`  ${icon.out}  ${icon.size}x${icon.size}`);
  await page.close();
}
await browser.close();
