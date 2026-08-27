/**
 * Render Chrome Web Store listing assets at exactly the sizes Google requires.
 *
 * Regenerate after any UI change: `npm run store:assets`.
 *
 * The in-page shots compose the extension's real stylesheet and real DOM
 * structure over a mock article, rather than driving a live session — a live
 * session on the mock runtime would show the "sample answer" banner, and a real
 * runtime needs a key this script does not have. Everything visual comes from
 * the shipped CSS, so the shots stay honest and go stale when the UI does.
 *
 * Sizes (developer.chrome.com/docs/webstore/images):
 *   screenshots   1280x800  (1 required, 5 max)
 *   small promo    440x280  (required)
 *   marquee       1400x560  (optional)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const outDir = new URL("store-assets/", root);

const css = await readFile(new URL("extension/content/styles.css", root), "utf8");
const landingCss = await readFile(new URL("landing/styles.css", root), "utf8");
// The import shot is an extension *page*, not an in-page surface, so it wears
// the options stylesheets instead of the content one.
const optionsCss = await readFile(new URL("extension/options/options.css", root), "utf8");
const importCss = await readFile(new URL("extension/options/import.css", root), "utf8");

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400' +
  "&family=Lora:ital,wght@0,400;0,600;1,400&display=swap\" rel=\"stylesheet\">";

/** A plausible article for the extension UI to sit on top of. */
const ARTICLE = `
  <article class="page">
    <p class="kicker">Markets · 4 min read</p>
    <h1>Governance turns on the fee switch</h1>
    <p>After eighteen months of debate, token holders approved a proposal that redirects a
    portion of protocol revenue to stakers. Supporters framed the vote as long-overdue
    alignment between usage and ownership.</p>
    <p><span class="sel">Turning on the fee switch makes the token a cash-flow asset, so the
    valuation debate shifts from narrative to multiples — and the treasury loses the buffer it
    has been spending from.</span></p>
    <p>Opponents argue the change arrives too early: fee revenue remains concentrated in two
    integrations, and diverting it may slow the incentive programmes that produced the volume
    in the first place.</p>
    <p>The switch activates at the next epoch boundary. Delegates have until then to signal
    whether they intend to re-stake or exit, and the foundation has said it will publish a
    revenue breakdown alongside the first distribution.</p>
    <p>Whether that breakdown arrives in a form anyone can audit is a separate question. Two
    previous reports were released as static summaries, without the per-integration detail
    that would let a holder check the concentration claim independently.</p>
    <p>For now the market is pricing the announcement rather than the cash flow. That gap
    closes either when the first distribution lands or when someone demonstrates it cannot.</p>
  </article>`;

const PAGE_CSS = `
  body { margin:0; background:#fbfbfa; font:16px/1.7 Lora, Georgia, serif; color:#201f1d; }
  .page { max-width:600px; margin:0; padding:56px 64px 0; }
  .kicker { margin:0 0 10px; font-size:11px; letter-spacing:.14em; text-transform:uppercase;
    color:#8a8683; }
  h1 { font:400 38px/1.1 "Cormorant Garamond", Palatino, serif; letter-spacing:-.02em;
    margin:0 0 20px; }
  p { margin:0 0 16px; text-align:justify; hyphens:auto; }
  .sel { background:rgba(182,130,53,.26); box-shadow:0 0 0 1px rgba(182,130,53,.45); }
  .stage { position:relative; min-height:100vh; }
  .float { position:absolute; }`;

const mark = '<span class="wdimtm-mark">?</span>';
/** The shipped rules are all !important, so composition overrides must be too. */
const COMPOSE_CSS = `
  #wdimtm-root { position:static !important; inset:auto !important;
    pointer-events:auto !important; }
  .float { position:absolute !important; }
  .wdimtm-popover { max-height:none !important; }
  .wdimtm-chat { position:absolute !important; height:auto !important;
    max-height:none !important; }`;

const head = (extra = "") =>
  `<meta charset="utf-8">${FONTS}<style>${css}${PAGE_CSS}${COMPOSE_CSS}${extra}</style>`;

const optionsHead = (extra = "") =>
  `<meta charset="utf-8">${FONTS}<style>${optionsCss}${importCss}${extra}</style>`;

const popoverHeader = `
  <div class="wdimtm-popover-header wdimtm-surface-header">
    <div class="wdimtm-popover-title wdimtm-surface-title">${mark}<span>What does it mean to me?</span></div>
    <button class="wdimtm-icon-btn">×</button>
  </div>`;


/**
 * One row of the review step, written the way import.js builds it: a checkbox,
 * an editable line, and the provenance that makes accepting it an informed act.
 * @param {{text: string, type: string, support: number, from?: string, checked?: boolean,
 *   existing?: boolean}} c
 */
const candidateRow = (c) => `
  <div class="candidate${c.existing ? " existing" : ""}">
    <input type="checkbox"${c.checked === false ? "" : " checked"}>
    <div>
      <textarea class="candidate-text" rows="1">${c.text}</textarea>
      <div class="candidate-meta">
        <select><option>${c.type}</option></select>
        <span>Support ${c.support}</span>
        ${c.existing ? '<span class="badge-existing">Already stored</span>' : ""}
      </div>
      ${c.from ? `<div class="candidate-meta candidate-evidence">From: ${c.from}</div>` : ""}
    </div>
  </div>`;

/** @type {{name: string, width: number, height: number, html: string,
 *   head?: (extra?: string) => string}[]} */
const shots = [
  {
    name: "screenshot-1-explain",
    width: 1280,
    height: 800,
    html: `<div class="stage" id="wdimtm-root" data-theme="light">
      ${ARTICLE}
      <div class="wdimtm-bubble-wrap float" style="left:64px; top:352px">
        <button class="wdimtm-bubble">${'<span class="wdimtm-bubble-mark">?</span>'}
          <span class="wdimtm-bubble-label">WDIMTM</span></button>
        <button class="wdimtm-bubble-chat">💬</button>
        <label class="wdimtm-lens-field"><span class="wdimtm-lens-caret">▾</span>
          <select class="wdimtm-lens-select"><option>Investing</option></select></label>
      </div>
      <div class="wdimtm-popover wdimtm-surface float" style="right:48px; top:76px; width:412px">
        ${popoverHeader}
        <div class="wdimtm-surface-selection">
          <div class="wdimtm-surface-selection-label">Selection</div>
          <div class="wdimtm-surface-selection-body">Turning on the fee switch makes the token a
            cash-flow asset, so the valuation debate shifts from narrative to multiples.</div>
        </div>
        <div class="wdimtm-popover-body">
          <div class="wdimtm-answer">
            <p><strong>Grounding.</strong> Revenue that previously funded the treasury now flows to
            stakers. Two facts from the page: fee income is concentrated in two integrations, and
            the treasury has been spending from that buffer.</p>
            <blockquote class="wdimtm-quote"><p>You hold this in a long-term book and track revenue
            quality: the switch gives you a multiple to model, but concentration risk is the thing
            to size first.</p></blockquote>
          </div>
          <div class="wdimtm-memory-suggest">
            <div class="wdimtm-memory-suggest-title">Hypothesis — not a fact</div>
            <div class="wdimtm-memory-suggest-body">If incentives are cut alongside the switch,
              volume may fall faster than fee capture rises.</div>
          </div>
          <div class="wdimtm-followups">
            <button class="wdimtm-chip">Why it matters</button>
            <button class="wdimtm-chip">Explain more</button>
            <button class="wdimtm-chip">Verify the claims</button>
            <button class="wdimtm-chip">Discuss further</button>
          </div>
          <div class="wdimtm-meta">via openai-compatible · 2 memories used</div>
        </div>
      </div>
    </div>`,
  },
  {
    name: "screenshot-2-lenses",
    width: 1280,
    height: 800,
    html: `<div class="stage" id="wdimtm-root" data-theme="light">
      ${ARTICLE}
      <div class="float" style="left:64px; top:352px">
        <div class="wdimtm-bubble-wrap" style="position:relative">
          <button class="wdimtm-bubble">${'<span class="wdimtm-bubble-mark">?</span>'}
            <span class="wdimtm-bubble-label">WDIMTM</span></button>
          <button class="wdimtm-bubble-chat">💬</button>
          <label class="wdimtm-lens-field"><span class="wdimtm-lens-caret">▾</span>
            <select class="wdimtm-lens-select"><option>Investing</option></select></label>
        </div>
        <div class="wdimtm-surface" style="margin-top:10px; width:300px">
          <div style="padding:10px 14px 8px; font-size:9.5px; letter-spacing:.14em;
            text-transform:uppercase; color:#b68235; border-bottom:1px solid rgba(32,31,29,.12)">
            Read this through…</div>
          <div style="padding:6px 0">
            ${[
              ["Explain", "通俗解释", 0],
              ["Sanity check", "有没有道理", 0],
              ["Fact check", "核实主张", 0],
              ["Opportunities", "找机会", 0],
              ["Engineering", "工程视角", 0],
              ["Investing", "投资视角", 1],
            ]
              .map(
                ([en, zh, on]) =>
                  `<div style="display:flex;align-items:baseline;gap:10px;padding:7px 14px;
                    font-family:'Cormorant Garamond',Palatino,serif;font-size:15px;font-weight:600;
                    ${on ? "box-shadow:inset 2px 0 0 #b68235;color:#7d5411;" : ""}">
                    <span style="min-width:110px">${en}</span>
                    <span style="font-family:Lora,serif;font-size:11.5px;font-weight:400;
                      color:${on ? "#7d5411" : "rgba(32,31,29,.5)"}">${zh}</span></div>`
              )
              .join("")}
          </div>
        </div>
      </div>
      <div class="wdimtm-popover wdimtm-surface float" style="right:48px; top:96px; width:412px">
        ${popoverHeader}
        <div class="wdimtm-popover-body">
          <div class="wdimtm-answer">
            <p><strong>Grounding.</strong> A fee switch routes protocol revenue to token holders.
            The same headline reads differently depending on what you are trying to decide.</p>
            <blockquote class="wdimtm-quote"><p>An engineer asks what breaks at the epoch boundary.
            An investor asks what multiple the cash flow deserves. The lens decides which question
            gets answered — you never rewrite the prompt.</p></blockquote>
          </div>
          <div class="wdimtm-meta">via openai-compatible · investing</div>
        </div>
      </div>
    </div>`,
  },
  {
    name: "screenshot-3-chat",
    width: 1280,
    height: 800,
    html: `<div class="stage" id="wdimtm-root" data-theme="light">
      ${ARTICLE}
      <div class="wdimtm-chat wdimtm-surface float"
        style="position:absolute; right:24px; top:24px; bottom:24px; width:400px; height:auto">
        <div class="wdimtm-chat-expanded">
          <div class="wdimtm-chat-header">
            <div class="wdimtm-chat-title">${mark}<span>Page chat</span></div>
            <div class="wdimtm-chat-header-actions">
              <button class="wdimtm-btn wdimtm-btn-ghost wdimtm-btn-tiny">Clear thread</button>
              <button class="wdimtm-icon-btn wdimtm-chat-min-btn">─</button>
              <button class="wdimtm-icon-btn">×</button>
            </div>
          </div>
          <div class="wdimtm-chat-selection">
            <div class="wdimtm-chat-selection-label">Selection</div>
            <div class="wdimtm-chat-selection-body">Turning on the fee switch makes the token a
              cash-flow asset.</div>
          </div>
          <div class="wdimtm-chat-messages">
            <div class="wdimtm-chat-msg user">How would you size the concentration risk?</div>
            <div class="wdimtm-chat-msg assistant"><div class="wdimtm-answer"><p>Start from the
            share of fee revenue the top two integrations produce, then ask what happens to the
            multiple if either one leaves. The page says the treasury has been spending from the
            buffer, so the downside case is not just slower growth — it is a funding gap.</p></div></div>
            <div class="wdimtm-chat-msg user">What would change your mind?</div>
            <div class="wdimtm-chat-msg assistant"><div class="wdimtm-answer"><p>Evidence that fee
            income is broadening: a third integration at double-digit share, or organic volume
            holding after the incentive programme tapers.</p></div></div>
          </div>
          <form class="wdimtm-chat-composer">
            <textarea class="wdimtm-chat-input" rows="2" placeholder="Ask a follow-up…"></textarea>
            <button class="wdimtm-btn">Send</button>
          </form>
        </div>
      </div>
    </div>`,
  },
  {
    name: "screenshot-4-memory",
    width: 1280,
    height: 800,
    head: optionsHead,
    html: `<main class="page">
      <header class="header">
        <div class="brand">
          <span class="mark">?</span>
          <div>
            <h1>Import from AI chat history</h1>
            <p class="tagline">What Does It Mean To Me?</p>
          </div>
        </div>
        <p class="lede">Turn a ChatGPT or Claude export into memories WDIMTM can use.</p>
      </header>
      <section class="card step">
        <h2>Review before saving</h2>
        <p class="hint">2 Interest · 1 Goal</p>
        <p class="hint privacy-note">Read in this page only — never written to disk, never
          sent to a WDIMTM server.</p>
        <div class="actions review-actions">
          <button type="button" class="btn ghost">Select all</button>
          <button type="button" class="btn ghost">Select none</button>
        </div>
        <div>
          <section class="review-group">
            <h3>Interest<span class="group-count"> 2</span></h3>
            ${candidateRow({
              text: "Follows protocol revenue and fee-switch governance debates closely.",
              type: "Interest",
              support: 7,
              from: "Fee switch valuation · Staking yields · Treasury runway",
            })}
            ${candidateRow({
              text: "Reads about retrieval quality in RAG systems, not model benchmarks.",
              type: "Interest",
              support: 4,
              from: "Chunking strategies · Reranker tradeoffs",
              existing: true,
            })}
          </section>
          <section class="review-group">
            <h3>Goal<span class="group-count"> 1</span></h3>
            ${candidateRow({
              text: "Wants to judge an opportunity in under ten minutes without opening a chatbot.",
              type: "Goal",
              support: 5,
            })}
          </section>
        </div>
        <div class="actions sticky-accept">
          <button type="button" class="btn primary">Save selected (3)</button>
        </div>
      </section>
    </main>`,
  },
];

/** The 440x280 tile is a brand card, not a UI capture. */
const promo = (w, h) => `
  <div class="tile">
    <div class="tile-mark">?</div>
    <div class="tile-title">What does it<br><em>mean to me?</em></div>
    <div class="tile-sub">Select anything. Understand it in place.</div>
    <div class="tile-rule"></div>
    <div class="tile-foot">WDIMTM · Chrome extension</div>
  </div>
  <style>
    html,body{margin:0;height:100%}
    body{width:${w}px;height:${h}px;background:#f3f2f2;color:#201f1d;
      font-family:Lora,Georgia,serif;overflow:hidden}
    .tile{position:relative;height:100%;box-sizing:border-box;
      padding:${h > 300 ? "56px 64px" : "30px 34px"};display:flex;flex-direction:column;
      justify-content:center;border:1px solid rgba(32,31,29,.16)}
    .tile::after{content:"?";position:absolute;right:${h > 300 ? "6%" : "-2%"};top:-.18em;
      font-family:"Cormorant Garamond",Palatino,serif;font-size:${h > 300 ? 420 : 250}px;
      line-height:1;color:rgba(182,130,53,.16)}
    .tile-mark{width:${h > 300 ? 34 : 24}px;height:${h > 300 ? 34 : 24}px;border:1px solid #b68235;
      border-radius:50%;color:#b68235;display:flex;align-items:center;justify-content:center;
      font-family:"Cormorant Garamond",Palatino,serif;font-size:${h > 300 ? 17 : 13}px;
      margin-bottom:${h > 300 ? 22 : 14}px}
    .tile-title{position:relative;font-family:"Cormorant Garamond",Palatino,serif;font-weight:400;
      font-size:${h > 300 ? 76 : 40}px;line-height:.98;letter-spacing:-.025em}
    .tile-title em{font-style:normal;color:#7d5411}
    .tile-sub{position:relative;margin-top:${h > 300 ? 20 : 12}px;
      font-size:${h > 300 ? 19 : 12.5}px;color:rgba(32,31,29,.7)}
    .tile-rule{margin:${h > 300 ? "26px 0 14px" : "14px 0 9px"};height:1px;
      background:rgba(32,31,29,.16);width:${h > 300 ? 180 : 110}px}
    .tile-foot{font-size:${h > 300 ? 13 : 10}px;letter-spacing:.14em;text-transform:uppercase;
      color:#b68235}
  </style>`;

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const written = [];

for (const shot of shots) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 1,
  });
  const shotHead = shot.head || head;
  const body = shot.head ? `<body class="import-page">` : "<body>";
  await page.setContent(
    `<!doctype html><html><head>${shotHead()}</head>${body}${shot.html}</body></html>`
  );
  await page.waitForLoadState("networkidle");
  const file = new URL(`${shot.name}.png`, outDir);
  await page.screenshot({ path: fileURLToPath(file) });
  written.push([`${shot.name}.png`, `${shot.width}x${shot.height}`]);
  await page.close();
}

for (const [name, w, h] of [
  ["promo-small-440x280", 440, 280],
  ["promo-marquee-1400x560", 1400, 560],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8">${FONTS}</head><body>${promo(w, h)}</body></html>`
  );
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, outDir)) });
  written.push([`${name}.png`, `${w}x${h}`]);
  await page.close();
}

await browser.close();

await writeFile(
  fileURLToPath(new URL("README.md", outDir)),
  `# Chrome Web Store listing assets\n\nGenerated by \`npm run store:assets\` — do not hand-edit.\nRegenerate after any UI change so the listing does not drift from the product.\n\n| File | Size | Required by the store |\n|---|---|---|\n${written
    .map(([f, s]) => {
      const req = f.startsWith("screenshot-1") || f.startsWith("promo-small");
      const note = f.startsWith("screenshot")
        ? req
          ? "Yes — at least one screenshot"
          : "No — up to 5 allowed"
        : req
          ? "Yes"
          : "No — for store featuring";
      return `| \`${f}\` | ${s} | ${note} |`;
    })
    .join("\n")}\n\nThe in-page shots compose the extension's shipped stylesheet and DOM structure over\na mock article; the memory shot does the same with the options stylesheets. They are\nnot captures of a live session: on the mock runtime a live capture would show the\n"sample answer" banner, and a real runtime needs an API key. Everything visual comes\nfrom \`extension/content/styles.css\` and \`extension/options/\`, so these go stale when\nthe UI does — regenerate rather than retouch.\n`,
  "utf8"
);

console.log(written.map(([f, s]) => `  ${f}  ${s}`).join("\n"));
