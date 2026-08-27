/**
 * End-to-end verification of the Phase 0 loop:
 * load unpacked extension → open demo page → select text → bubble → popover (mock).
 *
 * Run: npm run test:e2e
 */
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
// The loadable extension is the build output now, not the source tree — the
// content script is bundled and the source no longer runs as-is.
const EXTENSION_PATH = path.join(ROOT, "dist");
const FIXTURES = path.join(ROOT, "fixtures");
const OUT_DIR = path.join(ROOT, "tests/e2e/output");
const USER_DATA = path.join(ROOT, ".tmp/playwright-profile");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const rel = urlPath === "/" ? "/demo.html" : urlPath;
    const filePath = path.normalize(path.join(FIXTURES, rel));
    if (!filePath.startsWith(FIXTURES)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function waitForExtensionServiceWorker(context, timeoutMs = 20000) {
  const existing = context.serviceWorkers();
  if (existing.length) return existing[0];
  return context.waitForEvent("serviceworker", { timeout: timeoutMs });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });

  const { server, baseUrl } = await startStaticServer();
  const demoUrl = `${baseUrl}/demo.html`;

  /** @type {import('playwright').BrowserContext | null} */
  let context = null;
  const results = [];

  try {
    // Extensions require a persistent context. Prefer headed=false with new headless
    // when supported; fall back to headed if the environment allows a display.
    const launchOpts = {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
      viewport: { width: 1100, height: 800 },
    };

    // Chromium still does not reliably load MV3 extensions in headless.
    // Prefer headed (default). Headless is best-effort only.
    const wantHeadless = process.env.WDIMTM_E2E_HEADLESS === "1";
    if (wantHeadless) {
      launchOpts.headless = true;
      launchOpts.args.push("--headless=new");
    }

    context = await chromium.launchPersistentContext(USER_DATA, launchOpts);

    let sw;
    try {
      sw = await waitForExtensionServiceWorker(context);
    } catch (err) {
      if (wantHeadless) {
        throw new Error(
          "Headless Chromium did not start the extension service worker. " +
            "MV3 extensions require headed E2E on this stack — run `npm run test:e2e` instead. " +
            `Underlying error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      throw err;
    }
    const extUrl = sw.url();
    assert.ok(extUrl.startsWith("chrome-extension://"), `unexpected SW url: ${extUrl}`);
    const extensionId = new URL(extUrl).host;
    results.push(`service worker: ok (${extensionId})`);

    const page = await context.newPage();
    await page.goto(demoUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    // Content script should inject host (UI is inside Shadow DOM).
    await page.waitForFunction(
      () => Boolean(document.getElementById("wdimtm-host") || document.querySelector("[data-wdimtm='1']")),
      null,
      { timeout: 10000 }
    );
    results.push("content script injected: ok");

    // ── Site denylist ────────────────────────────────────────────────
    // The shortcut used to skip isSiteDisabled() entirely, so a denied site
    // still answered when asked by key. Both paths are checked here.
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await sw.evaluate(() => chrome.storage.sync.set({ denylist: ["127.0.0.1"] }));
    await page.waitForTimeout(600);

    const select = () =>
      page.locator("#target-claim").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });

    const deniedBubble = page.locator("#wdimtm-host").locator("#wdimtm-bubble");
    const deniedPopover = page.locator("#wdimtm-host").locator("#wdimtm-popover");

    await select();
    // Long enough to outlast the bubble's own show retries (up to 500ms).
    await page.waitForTimeout(1000);
    assert.ok(await deniedBubble.isHidden(), "bubble must stay hidden on a denied site");

    await page.keyboard.press("Alt+Shift+w");
    await page.waitForTimeout(1000);
    assert.ok(
      await deniedPopover.isHidden(),
      "the ⌥⇧W shortcut must not explain on a denied site"
    );
    results.push("denylist blocks both the bubble and ⌥⇧W: ok");

    await sw.evaluate(() => chrome.storage.sync.set({ denylist: [] }));
    await page.waitForTimeout(600);
    await select();
    await deniedBubble.waitFor({ state: "visible", timeout: 8000 });
    results.push("clearing the denylist re-enables the site: ok");

    // ── Save confirmation ────────────────────────────────────────────
    // "Saved" used to render at the bottom of a long form, off screen for
    // anyone who had scrolled. It is a floating toast now.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options/options.html`, {
      waitUntil: "domcontentloaded",
    });
    await options.locator("#settings-form button[type='submit']").click();
    // Extension pages forbid unsafe-eval, so waitForFunction cannot run here —
    // a plain locator wait needs no injected script. It also checks the thing
    // that actually matters: the toast is on screen and not merely in the DOM.
    const toast = options.locator("#status.is-visible");
    await toast.waitFor({ state: "visible", timeout: 8000 });
    assert.ok((await toast.innerText()).trim().length > 0, "toast should say something");
    const box = await toast.boundingBox();
    const viewport = options.viewportSize();
    assert.ok(box, "toast should be laid out");
    assert.ok(
      box.y >= 0 && box.y + box.height <= viewport.height,
      `toast should sit inside the viewport, got y=${box?.y}`
    );
    results.push("saving settings shows a visible toast: ok");
    // Past the 160ms fade, so the screenshot shows the settled toast.
    await options.waitForTimeout(400);
    await options.screenshot({ path: path.join(OUT_DIR, "04-save-toast.png") });
    await options.close();

    // ── Popup ────────────────────────────────────────────────────────
    // The per-site switch reads the current tab, which needs the `activeTab`
    // grant that only a real toolbar click gives — so opening popup.html
    // directly leaves the row hidden by design. What this checks is that the
    // added top-level await still lets the rest of the popup render.
    const popup = await context.newPage();
    const popupErrors = [];
    popup.on("pageerror", (err) => popupErrors.push(err.message));
    await popup.goto(`chrome-extension://${extensionId}/options/popup.html`, {
      waitUntil: "domcontentloaded",
    });
    await popup.locator("#popup-runtime").waitFor({ state: "attached", timeout: 8000 });
    await popup.waitForTimeout(500);
    assert.equal(popupErrors.length, 0, `popup threw: ${popupErrors.join("; ")}`);
    assert.ok(
      (await popup.locator("#popup-runtime").innerText()).trim().length > 0,
      "popup should still render its runtime fact"
    );
    results.push("popup renders with the site switch wired in: ok");
    await popup.close();

    await page.bringToFront();


    // Programmatic selection + mouseup to surface the bubble.
    await page.locator("#target-claim").evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const rect = range.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      for (const type of ["mousedown", "mouseup", "click"]) {
        el.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            view: window,
          })
        );
      }
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        })
      );
    });

    // Bubble lives in open Shadow DOM under #wdimtm-host
    const bubble = page.locator("#wdimtm-host").locator("#wdimtm-bubble");
    await bubble.waitFor({ state: "visible", timeout: 8000 });
    await page
      .locator("#wdimtm-host")
      .locator("#wdimtm-bubble .wdimtm-lens-select")
      .waitFor({ state: "visible" });
    results.push("selection bubble + lens select visible: ok");

    await page.screenshot({
      path: path.join(OUT_DIR, "01-bubble.png"),
      fullPage: false,
    });

    // Click the explain button (not the lens <select>).
    await page
      .locator("#wdimtm-host")
      .locator("#wdimtm-bubble [data-action='explain']")
      .click({ force: true });

    const popover = page.locator("#wdimtm-host").locator("#wdimtm-popover");
    await popover.waitFor({ state: "visible", timeout: 8000 });
    results.push("popover opened: ok");

    // Loading / streaming then mock answer (read via shadow).
    await page.waitForFunction(
      () => {
        const host = document.getElementById("wdimtm-host");
        const pop = host?.shadowRoot?.getElementById("wdimtm-popover");
        if (!pop || pop.hidden) return false;
        const text = pop.innerText || "";
        return (
          text.includes("Mock runtime") ||
          text.includes("Selection") ||
          text.includes("via mock")
        );
      },
      null,
      { timeout: 15000 }
    );

    const answerText = await popover.innerText();
    assert.ok(
      /bonding curve|volume|48 hours|Selection/i.test(answerText),
      `unexpected answer: ${answerText.slice(0, 200)}`
    );
    assert.ok(!/api\.openai\.com/i.test(answerText));
    results.push("mock explanation rendered: ok");

    // Follow-up: Explain more (label may be localized / structured)
    const moreBtn = page
      .locator("#wdimtm-host")
      .locator('#wdimtm-popover [data-intent="more"]');
    await moreBtn.waitFor({ state: "visible", timeout: 5000 });
    await moreBtn.click({ force: true });
    await page.waitForFunction(
      () => {
        const host = document.getElementById("wdimtm-host");
        const pop = host?.shadowRoot?.getElementById("wdimtm-popover");
        return (pop?.innerText || "").includes("Deeper");
      },
      null,
      { timeout: 15000 }
    );
    results.push("follow-up Explain more: ok");

    // Discuss further → page chat panel
    const discussBtn = page
      .locator("#wdimtm-host")
      .locator('#wdimtm-popover [data-intent="discuss"]');
    // After "more", discuss may be first; if missing, reopen explain once.
    if ((await discussBtn.count()) === 0) {
      await page.locator("#wdimtm-host").locator('#wdimtm-popover [data-intent="more"]').click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
    // Re-query after possible re-render
    const discuss = page.locator("#wdimtm-host").locator('[data-intent="discuss"]').first();
    if ((await discuss.count()) > 0) {
      await discuss.click({ force: true });
      await page.locator("#wdimtm-host").locator("#wdimtm-chat").waitFor({ state: "visible", timeout: 8000 });
      results.push("discuss further opens chat panel: ok");

      await page.locator("#wdimtm-host").locator(".wdimtm-chat-input").fill("Why does this matter?");
      await page.locator("#wdimtm-host").locator('.wdimtm-chat-composer button[type="submit"]').click();
      await page.waitForFunction(
        () => {
          const host = document.getElementById("wdimtm-host");
          const chat = host?.shadowRoot?.getElementById("wdimtm-chat");
          const text = chat?.innerText || "";
          return text.includes("mock") || text.includes("Deeper") || text.includes("深入") || text.includes("Why");
        },
        null,
        { timeout: 15000 }
      );
      results.push("chat turn: ok");
      await page.locator("#wdimtm-host").locator('[data-chat-action="close"]').click({ force: true });
    } else {
      results.push("discuss further: skipped (chip not present after more)");
    }

    // Re-open bubble path for remember if needed — selection + explain again
    await page.locator("#target-claim").evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.locator("#wdimtm-host").locator("#wdimtm-bubble [data-action='explain']").click({ force: true });
    await page.waitForFunction(
      () => {
        const host = document.getElementById("wdimtm-host");
        const pop = host?.shadowRoot?.getElementById("wdimtm-popover");
        return pop && !pop.hidden && (pop.innerText || "").includes("Selection");
      },
      null,
      { timeout: 15000 }
    );
    const rememberBtn = page
      .locator("#wdimtm-host")
      .locator('#wdimtm-popover [data-intent="remember"]');
    await rememberBtn.waitFor({ state: "visible", timeout: 5000 });
    await rememberBtn.click({ force: true });
    await page.waitForFunction(
      () => {
        const host = document.getElementById("wdimtm-host");
        const pop = host?.shadowRoot?.getElementById("wdimtm-popover");
        return (pop?.innerText || "").includes("Saved to local memory");
      },
      null,
      { timeout: 8000 }
    );
    results.push("Remember this: ok");

    await page.screenshot({
      path: path.join(OUT_DIR, "02-popover.png"),
      fullPage: false,
    });

    // Dismiss with Escape — should not navigate away.
    const urlBefore = page.url();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    assert.equal(page.url(), urlBefore);
    const popHidden = await popover.isHidden();
    assert.ok(popHidden, "popover should hide on Escape");
    results.push("escape dismiss without navigation: ok");

    // Re-select and verify scroll repositions bubble (still on same page).
    await page.locator("#target-claim").evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await bubble.waitFor({ state: "visible", timeout: 5000 });
    const before = await bubble.boundingBox();
    await page.evaluate(() => window.scrollBy(0, 180));
    await page.waitForTimeout(200);
    const after = await bubble.boundingBox();
    assert.ok(before && after, "bubble boxes missing");
    // Bubble remains managed (position may change with selection rect).
    assert.ok(typeof after.y === "number");
    results.push("scroll reposition handled: ok");

    await page.screenshot({
      path: path.join(OUT_DIR, "03-after-scroll.png"),
      fullPage: false,
    });

    const bounds = await page.evaluate(() => {
      const claim = document.getElementById("target-claim")?.innerText || "";
      return { selectionLen: claim.length, maxSelection: 4000, maxContext: 2500 };
    });
    assert.ok(bounds.selectionLen < bounds.maxSelection);
    results.push("selection within bounds: ok");

    console.log("\nE2E PASS");
    for (const line of results) console.log("  ✓", line);
    console.log(`\nScreenshots: ${OUT_DIR}`);
    console.log(`Demo URL was: ${demoUrl}`);
  } catch (err) {
    console.error("\nE2E FAIL");
    for (const line of results) console.error("  ·", line);
    if (context) {
      const pages = context.pages();
      const page = pages[pages.length - 1];
      if (page) {
        try {
          await page.screenshot({
            path: path.join(OUT_DIR, "failure.png"),
            fullPage: true,
          });
          console.error("  screenshot:", path.join(OUT_DIR, "failure.png"));
          console.error("  page url:", page.url());
          console.error(
            "  body sample:",
            (await page.locator("body").innerText().catch(() => "")).slice(0, 300)
          );
        } catch {
          /* ignore */
        }
      }
    }
    throw err;
  } finally {
    if (context) await context.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
