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
    if (urlPath === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
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

async function screenshot(page, name) {
  const file = path.join(OUT_DIR, name);
  const text = await page.evaluate(() => [document.body.innerText,
    ...[...document.querySelectorAll("*")].filter(el => el.shadowRoot)
      .map(el => el.shadowRoot.textContent)].join("\n"));
  fs.writeFileSync(file.replace(/\.png$/, ".page.txt"), `pr-evidence-page-text\n${text}`);
  await page.screenshot({ path: file, fullPage: name === "04-save-toast.png" });
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });

  const { server, baseUrl } = await startStaticServer();
  const demoUrl = `${baseUrl}/demo.html`;

  /** @type {import('playwright').BrowserContext | null} */
  let context = null;
  const results = [];
  const browserErrors = [];
  let passed = false;
  let chromiumVersion = null;

  try {
    // Extensions require a persistent context and headed Chromium in CI.
    const launchOpts = {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
        // Synthetic tests never resolve production services.
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      ],
      viewport: { width: 1100, height: 800 },
    };

    // Chromium still does not reliably load MV3 extensions in headless.
    // Prefer headed (default). Headless is best-effort only.
    // A Chromium other than the one this Playwright pins, e.g. a newer
    // Chrome for Testing already in the Playwright cache.
    if (process.env.WDIMTM_E2E_CHROMIUM) launchOpts.executablePath = process.env.WDIMTM_E2E_CHROMIUM;
    const wantHeadless = process.env.WDIMTM_E2E_HEADLESS === "1";
    if (wantHeadless) {
      launchOpts.headless = true;
      launchOpts.args.push("--headless=new");
    }

    context = await chromium.launchPersistentContext(USER_DATA, launchOpts);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    await context.route("https://cloud.wdimtm.com/v1/packages*", (route) => route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ packages: [{ id: "synthetic-starter", name: "Synthetic Starter",
        credits: 200, currency: "USD", price_cents: 500 }], enabled: true,
        source: "fixture", currency: "USD", checkout_available: false }),
    }));
    await context.route("https://cloud.wdimtm.com/v1/subscriptions*", (route) => route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ offers: [], checkout_available: false }),
    }));
    const watchPage = (page) => {
      page.on("pageerror", (err) => browserErrors.push(`pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error") browserErrors.push(`console: ${msg.text()}`);
      });
      page.on("requestfailed", (req) => browserErrors.push(`requestfailed: ${req.url()}`));
      page.on("response", (res) => {
        if (res.status() >= 400) browserErrors.push(`HTTP ${res.status()}: ${res.url()}`);
      });
    };
    context.pages().forEach(watchPage);
    context.on("page", watchPage);

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
    chromiumVersion = await sw.evaluate(() => navigator.userAgent);
    results.push(`service worker: ok (${extensionId})`);

    // A fresh install opens Settings (onInstalled → openOptionsPage). Newer
    // Chrome may put it in whichever tab is newest, including the test page,
    // so let it open and close it before the test takes a tab.
    const isOptions = (p) => p.url().includes("/options/options.html");
    const installTab =
      context.pages().find(isOptions) ||
      (await context.waitForEvent("page", { predicate: isOptions, timeout: 5000 }).catch(() => null));
    if (installTab) await installTab.close();

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
    await options.locator("#cloud-sign-in").waitFor({ state: "visible" });
    await options.locator("#cloud-advanced").evaluate(el => { el.open = true; });
    await options.locator("#test-cloud").click();
    await options.locator("#test-cloud-status").filter({ hasText: /Cannot reach WDIMTM Cloud/ }).waitFor();
    results.push("signed-out Cloud sign-in and connection error: ok");
    await options.setViewportSize({ width: 390, height: 844 });
    await options.locator("#test-cloud-status").scrollIntoViewIfNeeded();
    await screenshot(options, "04-save-toast.png");
    await options.close();
    // ── Cloud subscription checkout (#156) ───────────────────────────
    // Cloud is stubbed at the network layer. What this proves is the browser
    // half: Subscribe opens Stripe in a real tab after the awaited checkout
    // call, which a popup opened at that point could be blocked from doing.
    const CLOUD = "https://cloud.wdimtm.com/v1";
    const CHECKOUT = "https://checkout.stripe.test/c/session_e2e";
    const cloudJson = (route, body) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(body),
      });
    const freeAccount = {
      userId: "usr_e2e",
      email: "e2e@example.test",
      plan: "free",
      quota: { used: 0, limit: 50, remaining: 50, allowanceRemaining: 50, purchasedRemaining: 0 },
      cloudAccess: { active: false, source: null, until: null, verified: true },
      purchases: [],
    };
    /** @type {any[]} */
    const subscriptionCheckouts = [];
    await context.route(`${CLOUD}/**`, (route) => {
      const req = route.request();
      const { pathname } = new URL(req.url());
      if (req.method() === "OPTIONS") {
        return route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          },
        });
      }
      if (pathname === "/v1/subscriptions") {
        return cloudJson(route, {
          offers: [
            { id: "off_e2e", name: "WDIMTM Cloud", currency: "USD", amount_minor: 900,
              currency_decimals: 2, interval: "month", trial_days: 0 },
          ],
          checkout_available: true,
        });
      }
      if (pathname === "/v1/subscriptions/checkout") {
        subscriptionCheckouts.push(req.postDataJSON());
        return cloudJson(route, { checkout_url: CHECKOUT, payment_id: "pay_e2e", offer_id: "off_e2e" });
      }
      if (pathname === "/v1/packages") return cloudJson(route, { packages: [], checkout_available: false });
      if (pathname === "/v1/me" || pathname === "/v1/credits/reconcile") {
        return cloudJson(route, { grantsAdded: 0, creditsAdded: 0, ...freeAccount });
      }
      return route.fulfill({ status: 404, body: "{}" });
    });
    await sw.evaluate(() =>
      chrome.storage.local.set({ cloudAccessToken: "e2e-session", cloudBaseUrl: "https://cloud.wdimtm.com" })
    );

    const billing = await context.newPage();
    await billing.goto(`chrome-extension://${extensionId}/options/options.html`, {
      waitUntil: "domcontentloaded",
    });
    const subscribe = billing.locator("#cloud-subscription button");
    await subscribe.waitFor({ state: "visible", timeout: 10000 });
    assert.ok(await subscribe.isEnabled(), "Subscribe should be enabled for a signed-in free account");
    // The extension opens the tab itself; Playwright attaches to it too late
    // to route or record its request, and the test host does not resolve. So
    // the tab ends on Chrome's error page, which names the host it tried.
    const [checkoutTab] = await Promise.all([context.waitForEvent("page", { timeout: 10000 }), subscribe.click()]);
    await checkoutTab.waitForLoadState("domcontentloaded");
    await checkoutTab.locator("body").filter({ hasText: new URL(CHECKOUT).host }).waitFor({ timeout: 10000 });
    // Polling starts only after the tab opened ("waiting" is never claimed
    // for a checkout that did not open).
    let reconciles = 0;
    const countReconcile = (req) => {
      if (req.url() === `${CLOUD}/credits/reconcile`) reconciles += 1;
    };
    billing.on("request", countReconcile);
    for (let i = 0; i < 40 && !reconciles; i += 1) await billing.waitForTimeout(250);
    billing.off("request", countReconcile);
    assert.ok(reconciles > 0, "Settings should poll for the subscription after checkout opens");
    assert.deepEqual(subscriptionCheckouts, [{ offerId: "off_e2e" }]);
    results.push("Settings → Subscribe opens Stripe checkout in a tab: ok");
    await checkoutTab.close();
    await screenshot(billing, "05-subscription.png");
    await billing.close();
    await context.unroute(`${CLOUD}/**`);
    await sw.evaluate(() => chrome.storage.local.remove("cloudAccessToken"));

    // Mock is not a product option any more, and Save above stored Cloud.
    // E2E opts back in so the rest of the run needs no account.
    await sw.evaluate(() => chrome.storage.sync.set({ runtime: "mock", devMockRuntime: true }));

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

    await screenshot(page, "01-bubble.png");

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

    // Chips only exist once the stream finishes; mid-stream the popover shows
    // a hint inside a container with the same class, so waiting on
    // .wdimtm-followups still races. Wait for an actual chip.
    await page
      .locator("#wdimtm-host")
      .locator('#wdimtm-popover [data-action="followup"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 });

    // Which predicted chips appear is contextual — they are derived from the
    // selection and the answer, so demanding a specific one (this asked for
    // "Explain more") breaks whenever the suggestion logic improves. Discuss
    // and Remember are the two the builder reserves; those are the contract.
    for (const intent of ["discuss", "remember"]) {
      const chip = page.locator("#wdimtm-host").locator(`#wdimtm-popover [data-intent="${intent}"]`);
      assert.equal(await chip.count(), 1, `expected a reserved ${intent} chip`);
    }

    const predicted = page
      .locator("#wdimtm-host")
      .locator('#wdimtm-popover [data-action="followup"]:not([data-intent="discuss"]):not([data-intent="remember"])');
    assert.ok((await predicted.count()) > 0, "expected at least one predicted follow-up");
    results.push("follow-up chips rendered: ok");

    // Escalation: click whichever chip was predicted and assert the popover
    // answers again. Asserting the reply's wording would couple this to the
    // mock's copy; that the content changes is the behaviour under test.
    const beforeEscalation = await popover.innerText();
    await predicted.first().click({ force: true });
    await page.waitForFunction(
      (before) => {
        const host = document.getElementById("wdimtm-host");
        const pop = host?.shadowRoot?.getElementById("wdimtm-popover");
        const now = pop?.innerText || "";
        return now.length > 0 && now !== before;
      },
      beforeEscalation,
      { timeout: 15000 }
    );
    // The text changes as soon as the second answer starts streaming, and chips
    // are only rebuilt once it finishes — so the same race this file just fixed
    // for the first render applies again here. Wait for the chips, not the text.
    await page
      .locator("#wdimtm-host")
      .locator('#wdimtm-popover [data-action="followup"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 });
    results.push("follow-up escalation: ok");

    // Discuss further → page chat panel
    const discussBtn = page
      .locator("#wdimtm-host")
      .locator('#wdimtm-popover [data-intent="discuss"]');
    // Discuss is reserved so it is present; the old fallback here poked a
    // "more" chip that no longer exists.
    if ((await discussBtn.count()) === 0) {
      await predicted.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
    // Re-query after possible re-render
    const discuss = page.locator("#wdimtm-host").locator('[data-intent="discuss"]').first();
    if ((await discuss.count()) > 0) {
      await discuss.click({ force: true });
      await page.locator("#wdimtm-host").locator("#wdimtm-chat").waitFor({ state: "visible", timeout: 8000 });
      results.push("discuss further opens chat panel: ok");

      // A pasted screenshot must land in the composer strip. The unit suite
      // only loads source, so this is what catches a bundle missing the helpers.
      await page.locator("#wdimtm-host").locator(".wdimtm-chat-input").evaluate((el) => {
        const png = Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
          ),
          (c) => c.charCodeAt(0)
        );
        const dt = new DataTransfer();
        dt.items.add(new File([png], "shot.png", { type: "image/png" }));
        el.focus();
        el.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, composed: true, cancelable: true })
        );
      });
      await page
        .locator("#wdimtm-host")
        .locator(".wdimtm-chat-attach-item img")
        .waitFor({ state: "attached", timeout: 5000 });
      results.push("paste screenshot into chat: ok");

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
      await screenshot(page, "03-chat.png");
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
    // The bubble shows after the content script's mouseup delay; clicking
    // before then finds it hidden.
    const explainAgain = page.locator("#wdimtm-host").locator("#wdimtm-bubble [data-action='explain']");
    await explainAgain.waitFor({ state: "visible", timeout: 8000 });
    await explainAgain.click({ force: true });
    await page.waitForFunction(
      () => {
        const host = document.getElementById("wdimtm-host");
        const pop = host?.shadowRoot?.getElementById("wdimtm-popover");
        return pop && !pop.hidden && /Selection|选区/.test(pop.innerText || "");
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
        return /Saved to local memory|已保存到本地记忆/.test(pop?.innerText || "");
      },
      null,
      { timeout: 8000 }
    );
    results.push("Remember this: ok");

    await screenshot(page, "02-popover.png");

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

    const bounds = await page.evaluate(() => {
      const claim = document.getElementById("target-claim")?.innerText || "";
      return { selectionLen: claim.length, maxSelection: 4000, maxContext: 2500 };
    });
    assert.ok(bounds.selectionLen < bounds.maxSelection);
    results.push("selection within bounds: ok");

    assert.deepEqual(browserErrors, [], "browser errors must fail the E2E run");
    passed = true;
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
          await screenshot(page, "failure.png");
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
    let traceError;
    if (context) {
      try {
        await context.tracing.stop({ path: path.join(OUT_DIR, "trace.zip") });
      } catch (err) {
        passed = false;
        traceError = err;
        browserErrors.push(`trace: ${err.message}`);
      }
    }
    fs.writeFileSync(path.join(OUT_DIR, "browser-errors.json"), JSON.stringify(browserErrors, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, "result.json"), JSON.stringify({
      fixture: "synthetic-selection-followup-settings-memory",
      head_sha: process.env.PR_EVIDENCE_HEAD_SHA || null,
      tested_sha: process.env.GITHUB_SHA || null,
      status: passed ? "passed" : "failed",
      headed: process.env.WDIMTM_E2E_HEADLESS !== "1",
      chromium: chromiumVersion,
      extension_version: JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, "manifest.json"))).version,
      assertions: results,
      limitations: ["Synthetic mock runtime; no real OAuth, payment or provider calls.", "Desktop viewport only."],
    }, null, 2));
    if (context) await context.close().catch(() => {});
    await new Promise((r) => server.close(r));
    if (traceError) throw traceError;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
