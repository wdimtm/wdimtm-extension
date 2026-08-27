# core

The half of WDIMTM that does not know what is hosting it.

Nothing here may touch `chrome`, `document`, `window`, `localStorage` or
`navigator`. That is not a style rule — this code runs in a Cloudflare Worker
as well as in a browser extension, and a host global is exactly what stops it.

`scripts/check-boundary.mjs --check` enforces it, and a unit test runs the
check, so the boundary fails on the branch rather than in review.

## Why it exists

Extracting WDIMTM Cloud into its own repository failed on contact: `cloud/src`
imported nine extension files transitively. Cloud is not a separate product —
it is a server-side host for this code. Making that explicit is what lets the
extension be published while the paid service stays private.

## What that means in practice

Configuration is **received, never fetched**. `runtime/adapter.js` takes
`{ settings, memoryProvider, hostLocale }`; the extension fills those from
`chrome.storage`, Cloud from D1, and neither is special-cased here.

If you need a host API, the dependency points the other way: put the host part
in `extension/` and pass the result in. `host-locale.js` is the worked example —
reading the browser's UI language lives outside, while resolving a locale from
it lives here.

## Layout

```
core/
  memory-sources/   parsing ChatGPT / Claude exports into Conversation[]
  memory-import/    batching, distillation, merge, the driver loop
  runtime/          adapter + the per-provider runtimes + research
  auth/             the host-free half of account handling
  *.js              lenses, modes, explain context, follow-ups, web search…
```
