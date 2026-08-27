# AI access modes (how users get model power)

Status: **Accepted product direction** (updated 2026-08-15)

WDIMTM does **not** sell raw GPU time itself. Users pick how inference is paid for.

## Three product paths

```text
                    ┌─────────────────────────────┐
                    │  WDIMTM (browser product)   │
                    │  context · lens · memory    │
                    └─────────────┬───────────────┘
                                  │ ExplainRequest
           ┌──────────────────────┼──────────────────────┐
           ▼                      ▼                      ▼
     1. BYOK                 2. WDIMTM Cloud          3. Mock
  pick a provider            hosted, no vendor         offline demo
  (OpenAI / OpenRouter /     key in the browser
   Anthropic / Ollama /
   custom)
           │                      │
           ▼                      ▼
    User → provider          WDIMTM Cloud API
                             (server may call Agentaab
                              or other upstreams —
                              that is an implementation
                              detail, not a user option)
```

| Mode | Who pays | What user configures | Runtime id |
|------|----------|----------------------|------------|
| **BYOK** | User → chosen provider | Provider + base URL + key + model | `openai-compatible` or `anthropic` |
| **WDIMTM Cloud** | User → package payment | Google sign-in → pick package → pay | `wdimtm-cloud` |
| **Mock** | — | Nothing | `mock` |

### Cloud product path (no form filling)

Normal Cloud users do **not** paste a base URL or access token. The flow is:

```text
Select WDIMTM Cloud
  → Sign in with Google
  → Browse credit packages (catalog from Agentaab for the WDIMTM app)
  → Buy → checkout URL (Agentaab / Stripe etc.)
  → Credits appear on /v1/me
```

- **Package list source of truth:** Agentaab (`../promptaas`) app credit packages for the WDIMTM product app.
- **Client contract:** `GET /v1/packages`, `POST /v1/packages/checkout` on WDIMTM Cloud only — the extension never talks to Agentaab URLs directly.
- **Self-host / advanced:** base URL + token fields remain under a collapsed Advanced section for backends that implement the Cloud contract without Agentaab checkout.

**Dogfood recommendation:** use **BYOK** first for real answers. Cloud is the hosted path for “no vendor key in the browser” and cross-device context.

## What is *not* a product option

- **Agentaab / PromptaaS** is how **WDIMTM Cloud** may be implemented on the server (routing, agents, billing). The extension does **not** offer “subscribe via Agentaab” as a third access card. Users only see **WDIMTM Cloud**.
- **Anthropic** is a **BYOK provider**, not a separate access mode. Choosing Claude under BYOK switches the wire protocol to the Messages API.

## Why this split

1. **BYOK** — power users, enterprises, local models; zero WDIMTM billing surface; recommended dogfood path.  
2. **WDIMTM Cloud** — hosted path with one product surface; upstream choices stay server-side.  
3. **Mock** — offline demos and screenshots only.

WDIMTM stays thin: owns browser context + personalization, not infrastructure.

## Extension UX (target)

**Settings → AI access**

```text
○ Use my own API key
    Provider: [ OpenAI ▾ ]   // OpenAI | OpenRouter | Anthropic | Ollama | Custom
    …fields for that provider…
    [ Test connection ]

○ WDIMTM Cloud
    Base URL / token (or sign in)
    [ Test connection ]

○ Mock (offline demo)
```

## Related

- Cloud API: `cloud-api-contract.md` (private working repo)  
- Business model / service modes: `business-model.md` (private working repo)  
- Runtime contract: [`runtime-contract.md`](runtime-contract.md)
