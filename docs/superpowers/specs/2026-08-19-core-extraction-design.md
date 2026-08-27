# Design: extract `wdimtm-core`

Status: **Complete** (2026-08-19)
Supersedes the "move `cloud/` to its own repo" plan, which the code disproved.

## Why this exists

Publishing a public mirror needs a boundary between what is open and what is
not. The first attempt — lift `cloud/` into a private repo — failed on contact:
extracting it produced a repo whose tests could not run, because
`cloud/src/` imports the extension's core.

```
cloud/src/worker.js   → extension/lib/agent-job.js, context-bounds.js, modes.js
                      → extension/runtime/openai-compatible.js
                      → extension/runtime/research/index.js
cloud/src/credits.js  → extension/lib/modes.js
```

Nine files, 2,403 lines, transitively. **WDIMTM Cloud is not a separate
product; it is a server-side host for the same core.** That is a reasonable
design — it is why an explain means the same thing in both places — but it was
implicit, and an implicit shared core cannot be published selectively.

## The boundary, measured

Not "does it use `chrome`?" — core has to run in a Cloudflare Worker too, where
`document` and `window` are equally absent. The criterion is **any host
global**: `chrome`, `browser`, `document`, `window`, `localStorage`,
`navigator`. Comments and string bodies are stripped first, because several
files mention `chrome.storage.local` inside translated UI copy.

The set is closed under imports: a pure module importing a host-coupled one is
itself host-coupled.

`scripts/check-boundary.mjs` computes this. Today:

| | Files | Lines |
|---|---|---|
| **core** — host-agnostic | 42 | 8,524 |
| **host shell** | 11 | 3,243 |

After steps 2–4 the same script reports **48 core files (9,830 lines)** against a
**9-file host shell (2,021 lines)**, and — the part that matters — the host
shell no longer contains a single *propagated* entry. Every file left in it
touches a host API directly.

The eleven, and why:

```
* lib/auth/google.js      chrome.identity
* lib/auth/index.js       chrome.storage
* lib/chat.js             chrome.storage (thread persistence)
* lib/context.js          document
* lib/i18n.js             navigator
* lib/memory.js           chrome.storage
* lib/options-i18n.js     document (the applier; the table itself is pure)
* lib/page-theme.js       window.matchMedia, document
* lib/settings.js         chrome.storage
  runtime/adapter.js      — propagated only
  runtime/chat.js         — propagated only
```

## The one design change this needs

The last two are not genuinely host-coupled. They are dragged across by a
**fetching** dependency: `adapter.js` calls `getSettings()` twice, and
`runtime/chat.js` imports a prompt builder out of the storage-backed
`lib/chat.js`.

Invert it — the runtime should **receive** its configuration, not go and get
it — and both move into core. This is the same correction already made once
during conversation import, where `runtime/completion.js` was given a narrow
`(prompt, config)` signature rather than being threaded through the
settings-aware explain path.

That inversion is what makes Cloud's reuse legitimate rather than accidental:
the extension supplies config from `chrome.storage`, Cloud supplies it from D1,
and neither is special-cased inside the runtime.

**This is the only behavioural change in the extraction. Everything else is a
move.**

## Target structure

```
core/          host-agnostic: lenses, modes, memory-sources, memory-import,
               explain-context, followups, runtimes, agent-job          (public)
extension/     chrome glue + content scripts + options UI               (public)
cloud/         Worker, credits, packages, D1 — depends on core          (private)
docs/public/   architecture and design docs                             (public)
docs/internal/ roadmap, business model, store listing ops               (private)
```

One repository still. Splitting into three repositories is deliberately *not*
part of this: it buys nothing until a second consumer of core exists, and costs
three-way version alignment immediately. The directory boundary delivers the
enforcement; the repository boundary can follow if it ever earns itself.

## Bundling

The extension currently ships raw ES modules and has **zero runtime
dependencies**. It already contains a hand-rolled partial bundler:
`scripts/build-globals.mjs` regenerates four `*.global.js` IIFE copies because
content scripts cannot use `import`.

Adopting **esbuild** replaces that hack rather than adding to it:

| Entry | Format | Why |
|---|---|---|
| `background/service-worker.js` | esm | MV3 module worker |
| `options/options.js`, `options/import.js`, `options/popup.js` | esm | module pages |
| `content/content.js` | iife | content scripts cannot use modules |
| `cloud/src/index.js` | esm | Worker |

Consequences worth stating plainly:

- `build-globals.mjs` and the four generated `.global.js` files are deleted.
  The drift they were invented to prevent stops being possible.
- The repo gains its first build step. `npm test` must run it, and the loaded
  extension becomes `dist/` rather than `extension/`.
- One devDependency (esbuild). Runtime dependencies stay at zero — bundling is
  not a dependency of the shipped artifact.

## Enforcing the boundary

A move that is not enforced decays. `scripts/check-boundary.mjs --check` fails
when any file under `core/` touches a host global, directly or through an
import, and runs as a unit test so it fails on the branch rather than in
review.

This is the piece that makes the extraction worth doing at all: without it,
the first `import { getSettings }` inside core silently recreates the coupling
that caused this document.

## Migration

Each step ends with the suite green; no step is a flag day.

1. ✅ **Land the boundary check** as a test against the *current* layout, encoding
   today's 42/11 split as the baseline.
2. ✅ **Invert config in `adapter.js` and `runtime/chat.js`.** Behaviour-preserving;
   the callers in `service-worker.js` pass what they already read.
3. ✅ **Create `core/`, move the 44 files** (42 plus the two freed in step 2),
   rewriting imports. Mechanical, large, test-covered.
4. ✅ **Point `cloud/src/` at `core/`** — the `../../extension/...` imports become
   `../../core/...`, and the accidental dependency becomes a declared one.
5. ✅ **Introduce esbuild**, delete `build-globals.mjs` and the generated globals,
   load `dist/` in the e2e run.
6. ✅ **Split `docs/` into public and internal**, which removes 25 of the 29 links
   pointing at private issues as a side effect.
7. ✅ **Update the mirror workflow** to publish `core/`, `extension/`, and
   `docs/public/`.

## What this does not decide

- Whether `core` ever becomes its own repository or an npm package. Revisit
  when a second consumer exists.
- ~~Whether the mirror publishes full history or per-release snapshots.~~
  Settled in step 7, and settled by the earlier steps rather than by preference:
  once `main` held `cloud/` and `docs/internal/`, publishing refs stopped being
  available, and filtering a real history would rewrite hashes on every sync.
- The 29 stale issue links that survive step 6 (4 of them). Cosmetic.

## Risks

**The move is large.** ~44 files and every import that references them. The
mitigation is that 406 unit tests already cover this code and none of them
touch a browser — a broken move fails loudly and immediately.

**esbuild changes what "the extension" is.** Anyone loading `extension/`
unpacked must switch to `dist/`. The README, the e2e harness, and the Chrome
Web Store packaging step all name that path today and all have to move together.
