# WDIMTM ↔ Cloud API contract

Status: **Implemented** — the worker lives in the private working repo (`cloud/`).
Issues #51 and #50 are tracked there too.

WDIMTM Cloud is a **service mode of the same extension**, not a second client. This
document is the whole surface the extension is allowed to know. Anything the cloud does
behind these endpoints — managed inference, PromptaaS, a self-hosted server — is invisible
to the client, and that is what keeps one client compatible with several backends.

```text
        WDIMTM Extension (one client)
                   │
   runtime = wdimtm-cloud │ accountMode = cloud
                   ▼
        ┌──────────────────────────┐
        │  This contract (/v1/…)   │
        └────────────┬─────────────┘
                     ▼
   managed inference · entitlement · quota · sync
   (implementation detail — never leaks to the client)
```

## Service modes

| Mode | Runtime id | Who holds the model credential | Sync |
|------|-----------|-------------------------------|------|
| Local | `mock` | nobody (offline demo) | device only |
| BYOK | `openai-compatible`, `anthropic` | the user | device only |
| **Cloud** | `wdimtm-cloud` | the server | optional cloud sync |

`resolveServiceMode()` in `core/service-mode.js` is the single source of truth for this
mapping. The retired `promptaas` runtime id (#116) resolves to **Cloud**: Agentaab is how
Cloud is implemented on the server, never a client-side access mode.

## Configuration

| Setting | Meaning |
|---------|---------|
| `cloudBaseUrl` | Origin of a backend implementing this contract. **Default:** `https://cloud.wdimtm.com`. Normal users never type this; self-hosters override under Advanced. |
| `cloudAccessToken` | Session token from Google sign-in. Device-local; **never** synced, exported or included in a snapshot. Not pasted by hand for the product path. |
| `cloudSignUpUrl` | Optional manage / top-up URL. Package checkout is preferred. |

### Product UX

Cloud is **not** "fill base URL + paste token + test connection". It is:

1. Sign in with Google  
2. List packages (`GET /v1/packages`)  
3. Pay (`POST /v1/packages/checkout` → open `checkout_url`)  
4. Claim (`POST /v1/credits/reconcile`)

Package catalog and checkout are **implemented by Agentaab** for the WDIMTM app (credit packages + Stripe / rails). The worker proxies that catalog into this contract so the extension only ever speaks `/v1/…`.

Step 4 exists because step 3 finishes on someone else's page. Nothing in the browser knows
the money landed, so the client asks and the server decides.

Local backends: `npm run cloud:mock` (fixture, `http://127.0.0.1:8788`) or
`npm run cloud:dev` (the real worker on Miniflare + local D1).

## `POST /v1/auth/google` · `POST /v1/auth/signout`

Sign-in is Google via `chrome.identity`. The extension obtains a Google access token, sends
it **once**, and receives a WDIMTM session token:

```jsonc
// → { "googleAccessToken": "ya29.…" }
{
  "accessToken": "…",          // opaque WDIMTM session token
  "expiresAt": "2026-09-12T…",
  "user": { "id": "usr_…", "email": "user@example.com" },
  "plan": "free",
  "quota": { "used": 0, "limit": 50, "unit": "credits" }
}
```

Two rules the server enforces:

- The Google token's audience **must** match the server's `GOOGLE_CLIENT_ID`, otherwise any
  application's Google token would sign its holder into a WDIMTM account.
- Only the SHA-256 hash of the session token is stored, so a database leak does not hand
  out live sessions.

`POST /v1/auth/signout` invalidates the session; the extension clears its copy either way,
so a failed network call cannot strand someone signed in.

First sign-in runs `migrateLocalToCloud()`: existing local memories move up, and a newer
cloud copy is never overwritten.

## Common rules

- Base path is always `{cloudBaseUrl}/v1/…`.
- Auth: `Authorization: Bearer <cloudAccessToken>`; `X-WDIMTM-Client: extension`.
- Errors are HTTP status codes; the client classifies them with
  `classifyRuntimeError(err, "cloud")` (401 → re-auth, 403 → plan, 429 → quota, 404 →
  wrong base URL, network → offline).
- Privacy bounds are unchanged from BYOK: selection plus **bounded** page context only,
  never the full DOM.

## `GET /v1/packages` (public)

Credit packages for purchase. No auth required (so the Settings page can show prices before sign-in).

```jsonc
{
  "source": "agentaab",           // or "fallback" for dogfood without Agentaab
  "enabled": true,
  "currency": "USD",
  "checkout_available": true,
  "packages": [
    {
      "id": "plus",
      "name": "Plus",
      "credits": 1200,
      "currency": "USD",
      "price_cents": 2000,
      "description": "…"
    }
  ]
}
```

When the worker has `PROMPTAAS_BASE_URL` + `PROMPTAAS_APP_SLUG`, packages are loaded from
Agentaab `GET /api/app/{slug}/credits/packages/`. Otherwise a small fallback catalog is
returned with `checkout_available: false`.

## `POST /v1/packages/checkout` (authed)

```jsonc
// → { "packageId": "plus" }
{
  "checkout_url": "https://checkout.stripe.com/…",
  "payment_id": "…",
  "package": { "id": "plus", "credits": 1200, "currency": "USD", "price_cents": 2000 }
}
```

Proxied to Agentaab `POST /api/app/{slug}/credits/checkout/`. Returns **503** when Agentaab
is not configured on the worker. The worker passes `success_url`
`https://wdimtm.com/checkout/complete` (and the same with `?cancelled=1` as `cancel_url`),
so the buyer lands on a WDIMTM page that says to return to the extension. `CHECKOUT_RETURN_URL`
on the worker overrides it.

## `POST /v1/credits/reconcile` (authed)

Turns any completed payment into spendable credits (#88). Idempotent — a payment is
credited once, however often this is called.

```jsonc
// → {}
{
  "grantsAdded": 1,
  "creditsAdded": 200,
  "creditsRemoved": 0,
  "plan": "free",
  "quota": { "remaining": 249, "allowanceRemaining": 49, "purchasedRemaining": 200 }
}
```

**503** `checkout_not_configured` when no payment rail is configured; **502**
`reconcile_failed` when the ledger cannot be read — never a silent balance of zero.

The client calls it on a short poll after opening checkout, and behind an explicit
"I have paid — check now" button. The worker also calls it once on its own behalf before
answering **402**, so a user who paid a minute ago is not told to pay again, and before
any charge that would draw on bought credits.

Refunds, chargebacks and negative adjustments on Agentaab's ledger are mirrored as
negative grants (#139), counted in `creditsRemoved`. Purchased credits never go below
zero: credits already spent before a refund stay spent.

## `POST /v1/redeem` (authed)

Redeems a promotional code for Cloud access (#135). Codes and the entitlements they grant
live in Agentaab (agentaab#1130); the worker redeems on the signed-in user's behalf and
keeps no ledger of its own. A code grants a fixed benefit — `cloud_access` for N days —
not a payment-provider discount.

```jsonc
// → { "code": "LAUNCH-2026" }      surrounding spaces and case are ignored
{
  "redeemed": true,
  "benefit": { "type": "cloud_access", "durationDays": 30 },
  "entitlement": { "type": "cloud_access", "endsAt": "2026-11-05T10:00:00.000Z" },
  "plan": "cloud",
  "cloudAccess": { "active": true, "source": "entitlement", "until": "2026-11-05T10:00:00.000Z", "verified": true },
  "quota": { "limit": 1200, "remaining": 1191 }
}
```

`endsAt` is where access now ends. A code redeemed while access is still running extends
it from the current end; one redeemed after it lapsed starts now. Only the user named by
the session is ever redeemed for: anything else in the body is ignored.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `code_required` | Empty input. Answered locally; not an attempt. |
| 400 | `invalid_code` | Unknown **or disabled**. The two answer identically. |
| 409 | `already_redeemed` | This account already redeemed this code. Carries the current `plan`, `quota` and `cloudAccess`, so a retry after a lost response shows the access it granted. |
| 410 | `code_expired` | Past the code's expiry. |
| 410 | `code_exhausted` | The redemption limit is reached. |
| 429 | `rate_limited` | Agentaab's limit: 10 attempts per 15 minutes per account. `Retry-After` header and `retryAfterSeconds`. |
| 503 | `redeem_unconfirmed` | Agentaab timed out or failed mid-request; the code may or may not have been applied. Retry: a code is never applied twice, so a retry answers 200 or `already_redeemed`. |
| 503 | `redeem_unavailable` | Agentaab refused before claiming anything (storage down, configuration). |
| 503 | `redeem_not_configured` | The worker has no Agentaab server key. |

Every 503 carries `Retry-After` and `retryAfterSeconds`.

## `GET /v1/me`

Account, entitlement and quota. Also the connectivity probe used by **Test connection**, so
checking a configuration never costs an inference call.

```jsonc
{
  "userId": "u_123",
  "plan": "cloud",
  "entitlements": ["explain", "no_api_key", "memory_sync", "cross_device_context"],
  "cloudAccess": { "active": true, "source": "plan", "until": null, "verified": true },
  "quota": {
    "used": 9,
    "limit": 500,
    "remaining": 691,
    "allowanceRemaining": 491,
    "purchasedRemaining": 200,
    "resetAt": "2026-09-01T00:00:00Z",
    "unit": "credits"
  }
}
```

`remaining` is what the client should spend against. It is the sum of two buckets:
`allowanceRemaining`, which resets at `resetAt`, and `purchasedRemaining`, which does not.
They are reported separately because "0 free credits left and 200 you paid for" is a
different sentence from "200 left", and the UI has to be able to say either. Charges come
out of the allowance first.

`cloudAccess` says whether the account has Cloud access and why (#135):
`hasCloudAccess = users.plan is "cloud" OR Agentaab reports an active cloud_access
entitlement`. `source` is `"plan"` (paid), `"entitlement"` (a redeemed code, with `until`),
or `null`. While an entitlement is active, `plan` and `quota.limit` are the Cloud plan's, on
the same calendar-month period and usage. The account's own plan and its purchased credits
are never changed by it, so when it ends the account is back on its own plan with every
bought credit intact.

`verified: false` means Agentaab could not be asked. Access is then not assumed: the
account is reported on its own plan, and a charge beyond that plan's allowance answers
**503** `entitlement_unavailable` (with `Retry-After`) instead of 402, so nobody is told to
pay, or has bought credits spent, because a check failed. A paid plan is verified locally
and is always `verified: true`.

`entitlements` are capability ids from `core/service-mode.js`. The client uses them
to explain *why* something needs the cloud — never to render a bare upgrade prompt.

Quota is denominated in **credits**, charged per capability rather than per token
(official service: everyday explain 1, verify 3, research/opportunity 8). Credits are
checked **before** any upstream spend and recorded **after** it together with prompt and
completion tokens, so cost data is real rather than estimated.

When credits run out the server answers **402** with `code: "insufficient_credits"` and
does not call the model — after checking once whether a payment has arrived that it has not
yet mirrored. The client classifies 402 as a quota problem and tells the user they can wait
for the reset, buy a package, or switch to their own API key.

## `POST /v1/explain`

Body is the **unchanged `ExplainRequest`** from
[`runtime-contract.md`](runtime-contract.md) plus `stream: boolean`. Response is an
`ExplainResponse`; `snake_case` aliases (`why_it_matters`, `follow_ups`,
`memory_suggestion`) are accepted.

Web search is the server's (#141). When the mode wants it (`verify`, `research`, or the
fact-check lens) the server searches with its own provider key and injects the evidence;
`webEvidence` / `webSearchMeta` in the body are ignored, so a client cannot pad the prompt
with text labelled as evidence. The client does not search in Cloud mode. The search the
server ran is reported as `meta.webSearch`
(`{ used, provider, resultCount, error? }`; `{ used: false }` when the mode does not
search). `error` is a short code — `search_unavailable` (no server key), `search_timeout`,
`search_canceled`, `provider_http_<status>`, `provider_error` — never provider text. A
failed search still answers, and the model is told search failed rather than shown it as
evidence.

If the client disconnects before inference starts, the server stops and spends nothing
more (status 499, no charge); a search already sent is recorded either way.

```jsonc
{
  "explanation": "…",
  "summary": "…",
  "whyItMatters": "…",
  "followUps": ["…"],
  "memorySuggestion": { "type": "interest", "content": "…" },
  "meta": {
    "capability": "single_shot",
    "webSearch": { "used": true, "provider": "tavily", "resultCount": 5 },
    "entitlement": { "plan": "cloud", "quotaRemaining": 491 }
  }
}
```

When `stream: true`, respond with `text/event-stream`:

```text
data: {"delta":"Hel"}
data: {"delta":"lo"}
data: {"done":true,"followUps":["…"],"meta":{…}}
```

This is the same SSE shape as the BYOK adapters, so the popover renders identically in
every service mode.

Deltas are raw model output (trailers included, exactly as BYOK sees them); the closing
`done` frame carries the parsed `explanation`, which the client uses as the final text.

Credits are checked **before** the stream opens, so exhaustion is still a real `402` with a
JSON body. After that the status line is committed, so an upstream failure can only be
reported in-band:

```text
data: {"error":"upstream chat failed (503)"}
```

A client that sees an error frame must raise it as an error rather than render a partial
answer, and the server must not charge for the run.

## `POST /v1/chat`

Page chat. Body: `{ system, messages: [{ role, content }], stream, search? }`. Response:
`{ reply, meta }`, or the same SSE stream. The system prompt is built **in the browser** — the
cloud does not rebuild page context.

`search` hands this turn's web search to the server (#141):

```jsonc
"search": {
  "enabled": true,            // the user's web-search switch; false → no search this turn
  "selection": "…",           // ≤ 4000 chars, for the query
  "pageTitle": "…",           // ≤ 300 chars, for the query
  "answerLanguage": "zh_CN"   // optional: language of the error text in the prompt
}
```

With `search` present, `system` arrives **without** a `## WEB SEARCH STATUS` section. The
server builds the query from the last user turn plus `selection` and `pageTitle`, searches
when `enabled` is true, appends the same section the extension writes for BYOK (status,
evidence or error), and reports the verdict as `meta.webSearch`
(`{ used, status: "ok" | "empty" | "failed" | "off", provider?, resultCount?, query?,
error?, humanError? }`) in the JSON body and in the closing SSE frame. Without `search`
(older clients) `system` is used as sent and nothing is searched.

Malformed chat requests answer **400** before any credit check or search: every message
needs a `role` of `user`, `assistant` or `system` and string `content`, and `search`, when
present, must be an object whose `enabled` is a boolean.

## `POST /v1/research` · `GET /v1/jobs` · `GET /v1/jobs/:id` · `POST /v1/jobs/:id/cancel`

Durable research jobs (#52). `POST /v1/research` answers **202** with a queued job and keeps
working after the response; the extension polls `GET /v1/jobs/:id`. Full shape and runtime
boundary: [`research-agent-contract.md`](research-agent-contract.md).

Before the runtime starts, the server runs one web search (question or selection + page
title) and passes the results as `WEB EVIDENCE` in the research brief (#141). The job keeps
what it was built on as `job.webSearch` (`{ used, provider, resultCount, error?, sources:
[{ title, url }] }`). Canceling a job stops a search or managed inference in flight on the
same isolate, and a job canceled before its search starts never searches.

Jobs are scoped to their owner — another account gets **404**, not 403, because the
existence of someone else's job is not theirs to learn.

## `GET /v1/memory` · `POST /v1/memory`

Personal-context sync, using the `UserDataSnapshot` shape already defined in
[`auth-and-sync.md`](auth-and-sync.md).

- `GET` → `{ "snapshot": UserDataSnapshot }`, or **404** when the account has no snapshot
  yet. The client treats 404 as "nothing in the cloud", not as an error.
- `POST` → `{ "snapshot": UserDataSnapshot }` → `{ ok, updatedAt }`.

Conflict policy is last-write-wins by `updatedAt` (`mergeLastWriteWins`).

### Secrets

`core/cloud.js` strips anything matching `api key / access token / secret /
password / bearer` from the payload before it is sent. The stripping lives at the network
boundary on purpose — a caller cannot forget it. A conforming backend should reject a
snapshot that still contains a credential (the mock server does).

### Migration

`createCloudSyncProvider().migrateLocalToCloud(local)` uploads local memories on first
sign-in, and returns `kept_cloud` without writing when the cloud copy is newer. Migration
never deletes either side, so Local ↔ Cloud stays reversible and local memory is never
held hostage.

## `GET /v1/account/export` · `POST /v1/account/delete` (authed)

Export returns everything stored for the account (#139):

```jsonc
{
  "exportedAt": "2026-10-11T…",
  "user": { "id": "usr_…", "email": "…", "plan": "free", "createdAt": "…" },
  "snapshot": { /* the synced snapshot, or null */ },
  "usage": [{ "mode": "explain", "credits": 1, "purchasedCredits": 0, "promptTokens": 120, "completionTokens": 40, "model": "…", "createdAt": "…" }],
  "purchases": [{ "credits": 200, "source": "agentaab", "createdAt": "…" }],
  "jobs": [/* research jobs */],
  "searches": [{ "operation": "chat", "provider": "tavily", "outcome": "ok", "resultCount": 5, "createdAt": "…" }]
}
```

Delete takes `{ "confirm": "delete" }` (anything else is **400** `confirm_required`) and
erases the user, every session, the usage ledger, purchases, web-search records, the
snapshot and research jobs in one D1 transaction. Unspent purchased credits are lost. Agentaab keeps its own
payment records. Signing in again afterwards creates a new account.

## `POST /v1/hooks/agentaab` (signed, no session)

Agentaab's credit webhook (#139). The worker checks `x-agentaab-signature`
(`t=<unix>,v1=<hex>`, HMAC-SHA256 over `{t}.{body}` with `AGENTAAB_WEBHOOK_SECRET`) and
refuses a missing, wrong or more than ten-minute-old signature with **401**. A
`credit.purchased` or `credit.granted` event for this app's `auth:wdimtm:<userId>`
reconciles that user against the ledger and answers `{ "grantsAdded": n }`; any other
event answers `{ "ignored": true }`. The event's amount is never credited directly. A
worker without the secret answers **404**.

## Rate limits

Explain, chat and research are limited per user and per IP; Google sign-in per IP
(#139). A refused request is **429** with `code: "rate_limited"`, `retryAfterSeconds`
and a `Retry-After` header, and is never charged. The limits are Workers rate-limit
bindings in `cloud/wrangler.jsonc`.

## Expired sessions

A session lasts 30 days. Any **401** on a request that carried a token tells the
extension the session is dead: it clears the stored token and shows "Sign in" again,
instead of keeping a stale "Signed in as …".

## Self-hosting

Any server implementing the endpoints above works — set `cloudBaseUrl` and go. That is the
compatibility boundary: WDIMTM may add endpoints, but the ones here keep their shape, and
the client never depends on a backend-generated identifier beyond the tokens it is handed.

## Not in this contract

- Research jobs — `POST /research`, `GET /jobs/:id`, `POST /jobs/:id/cancel` have their own
  surface: [`research-agent-contract.md`](research-agent-contract.md) (#52). They share the
  auth and error rules above.
- Scheduled watch jobs (#53).
- Package payment rails beyond Agentaab proxy (native Cloud billing UI polish, receipt sync into D1 plans).
- Anything that would make Local or BYOK a second-class path.
