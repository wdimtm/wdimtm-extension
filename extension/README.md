# WDIMTM Extension

Chrome/Chromium Manifest V3 extension for:

**select text → Lens → explain → follow-ups / remember**

## Load unpacked

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this `extension/` directory
4. Open any `http(s)` page (or `npm run demo` from repo root)

Default runtime is **mock**. Open options to configure OpenAI-compatible or Agentaab (Beta), lenses, profile, and memory.

## Layout

```text
extension/
  manifest.json
  background/service-worker.js
  content/content.js + styles.css   # styles.inline.js is generated — see below
  content/images.global.js          # DOM-side image helpers; limits mirror lib/images.js
  runtime/
    adapter.js
    anthropic.js
    mock.js
    openai-compatible.js
    promptaas.js
  lib/
    settings.js, lenses.js, memory.js, messages.js, context-bounds.js, images.js, types.js
  options/                 # runtime, lenses, profile, memory, privacy
  icons/
```

## Styling

The in-page UI lives in a shadow root and is styled from `content/styles.css`. The content
script cannot fetch that file per page, so it ships as a JS string in
`content/styles.inline.js`. That file is generated — after editing `styles.css`, run:

```bash
npm run sync:css
```

The look is the "Classical" system: paper ground, ink text, gold used as stroke rather than
fill, hairline rules, 2/4/7px radii. Light and dark tokens both live at the top of
`styles.css`; `content.js` sets `data-theme` from the user's theme preference.

## Manual check

1. `npm run demo` → open demo page  
2. Select the highlighted claim  
3. Switch Lens on the bubble if desired  
4. Click **WDIMTM**  
5. Try **Explain more**, **Why it matters**, **Verify**, **Remember this**  

## Automated tests (repo root)

```bash
npm run test:unit
npm run test:e2e
```

## Privacy

See options page and [`docs/memory-rfc.md`](../docs/memory-rfc.md). Selections are not retained; only explicit memories + settings are stored.

## Coexistence with other selection extensions

Tools like **Trancy**, Immersive Translate, and similar “select to translate” extensions also inject UI on text selection. They can:

- paint their icon at the end of the selection (same surface as our bubble)
- briefly disturb selection / capture pointer events

WDIMTM mitigates this by:

- re-showing the bubble on a short retry schedule after selection
- anchoring the bubble to the **start / above** of the selection (translate icons often sit at the end)
- Shadow DOM + high z-index
- keyboard fallback: select text, then **⌥⇧W** (Alt+Shift+W) to explain without clicking the bubble

If a specific extension still fully blocks selection, temporarily disable its “selection translation” feature (not necessarily the whole extension).
