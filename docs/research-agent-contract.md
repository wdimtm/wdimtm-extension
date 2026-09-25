# Research AgentJob contract

Status: **Implemented** — server routes live in the private working repo (`cloud/`);
the UI is in the popover and the options page. Issues #52, #51 and #50 are tracked
there too.

Explain lives inside one interaction. Research does not: it takes minutes, calls tools,
retries, costs money, and has to survive the tab being closed. That is the whole reason it
moves to the server.

> **Ephemeral agent → browser. Durable agent → cloud.**

Ordinary Explain / Why it matters / lightweight Verify **stay browser-native**. Nothing in
this document applies to them.

## Two boundaries, not one

```text
WDIMTM  — product semantics
├── selection / page context
├── personal context
├── research intent
├── AgentJob lifecycle
├── research UX
└── result presentation
              │
              ▼
Runtime — execution and commercial infrastructure
├── agent / workflow execution
├── model + provider routing
├── tool execution
├── quota / credits
└── telemetry
```

PromptaaS is the **default runtime adapter**, chosen because it already owns all of the
lower half. WDIMTM does not rebuild planners, provider gateways, quota or analytics. But
PromptaaS is an *implementation*, never the product contract:

> **A runtime execution id is never WDIMTM's primary key.**

## AgentJob (`core/agent-job.js`)

```ts
AgentJob {
  id            // job_… — WDIMTM's own id
  userId?
  goal
  mode          // deep_research | opportunity_research
  sourceContext // selection + page + lens
  personalContext? // profile + memories
  state         // queued | running | succeeded | failed | canceled
  steps[]
  tools?
  budget?       // maxSteps / maxSeconds / maxCostUsd
  createdAt
  updatedAt
  runtime?  { provider, executionId, capabilityId? }   // external reference only
  result?   { summary, detail, sources[] }
  error?    { code, message, retryable }
}
```

### State machine

```text
queued ──▶ running ──▶ succeeded
   │          ├──────▶ failed
   └──────────┴──────▶ canceled
```

Terminal states are terminal: `transitionJob()` throws on anything else, so a late runtime
callback cannot resurrect a canceled job. Transitions are immutable — every change returns
a new job.

## Extension ↔ Cloud API

The extension knows four endpoints and nothing else:

```http
POST /v1/research          { input }        → 202 { job }   (queued, not finished)
GET  /v1/jobs/:id                           → { job }
POST /v1/jobs/:id/cancel                    → { job } | 409 when already terminal
GET  /v1/jobs                               → { jobs[] }    (summaries)
```

`POST /v1/research` answers **202 immediately** with a queued job and runs the work in
`ctx.waitUntil`. Holding the request open for the length of a research run would put the
durability back in the browser, which is the thing this issue moves out of it.

`input` comes from `buildResearchInput()`, which enforces the same privacy bounds as
Explain (selection ≤ 4000 chars, bounded page context ≤ 2500, never the full DOM), folds
`type=profile` memory rows into `profile`, and derives a goal from the selection when the
user did not type one.

No capability id, provider name or execution id is ever sent by the extension. See
[`cloud-api-contract.md`](cloud-api-contract.md) for auth and error handling, which are
shared with the rest of the cloud surface.

## ResearchRuntime (`core/runtime/research/index.js`)

```ts
interface ResearchRuntime {
  execution: 'blocking' | 'polling'
  canCancel: boolean
  start(input: ResearchInput): Promise<RuntimeExecutionRef & { state? }>
  get(executionId: string): Promise<RuntimeExecutionState>
  cancel(executionId: string): Promise<void>
}
```

```text
ResearchRuntime
├── PromptAASResearchRuntime          ← default
├── ManagedInferenceResearchRuntime   ← fallback, single-shot
└── MockResearchRuntime               ← offline / CI
```

### What PromptaaS actually offers

Checked against the PromptaaS API reference rather than assumed:

| Capability | Reality |
|---|---|
| Execute | `POST /api/app/{slug}/completion-messages` (Single Agent) or `/workflows/run` |
| Response mode | `blocking` only — no streaming, no async run handle |
| Run status | **No endpoint.** The answer comes back from the execute call |
| Cancel | **No endpoint** |
| Auth | `Authorization: Bearer pk_app_…` public runtime token |
| Attribution | `user` field — WDIMTM sends `auth:wdimtm:{userId}` so quota and credits are per user |
| Denial | `402` with `reason: free_quota_exhausted` (end user) or `budget_cap_exhausted` (creator) |

So the adapter declares `execution: "blocking"` and returns the terminal state from
`start()`. This is why durability lives in WDIMTM Cloud: the AgentJob sits in D1 and the
blocking call runs in the background. Inventing a polling API the runtime does not have
would have moved the waiting somewhere less honest, not made the job durable.

`canCancel: false` is equally deliberate. Cancel marks the **WDIMTM job** canceled and stops
waiting; the upstream run may still finish and may still cost the operator. The UI says
"canceled" because the job is canceled — it never claims the work was stopped.

### The capability input contract

A research capability receives flat, promptable inputs, not a nested WDIMTM object:

```text
goal · mode · selection · page_url · page_title · page_context
lens · lens_instructions · profile · memories · question
```

The answer may be JSON (`{ summary, detail, sources[] }`) or prose. Prose keeps its
citations: markdown links are lifted into `sources`, deduped by URL.

### Fallback runtime

Without `PROMPTAAS_BASE_URL` + `PROMPTAAS_APP_SLUG`, research runs as one strong single-shot
call on the managed model. No tools, no multi-step plan — but the same durable AgentJob and
the same credit price, because the user is buying the answer rather than the plumbing. It
exists so research is dogfoodable before the PromptaaS capability is built.

Adding `SelfHostedResearchRuntime` later changes nothing above this interface.

### State mapping

| Runtime status | AgentJob state |
|---|---|
| `pending` / `queued` / `created` / `scheduled` | `queued` |
| `completed` / `succeeded` / `success` / `done` | `succeeded` |
| `error` / `failed` / `failure` | `failed` |
| `cancelled` / `canceled` / `aborted` | `canceled` |
| anything else | `running` |

An unrecognized status resolves to `running` on purpose: not understanding a state is never
a reason to tell the user a job finished.

### Error and source normalization

`normalizeRuntimeError()` maps failures onto product-stable codes — `quota`,
`budget_exhausted`, `timeout`, `unauthorized`, `canceled`, `offline`, `runtime_error` —
each with a retryable flag and user-facing copy that contains no execution ids, worker
names or provider internals. `normalizeSources()` accepts the shapes different runtimes
emit (`url` / `link` / `href`, `title` / `name`, `published_at` / `date`) and dedupes by
URL, so citations render identically whichever runtime produced them.

## Execution flow

```text
Selection → Explain → "Research this"
        ↓
createResearchJobFromExplain()  — same lens, profile, memories
        ↓
POST /v1/research → 202, WDIMTM AgentJob (queued)
        ↓
cloud maps intent + context → runtime capability
        ↓  (background, ctx.waitUntil)
ResearchRuntime.start() → result
        ↓
AgentJob succeeded in D1, credits charged
        ↓
GET /v1/jobs/:id → result + sources     (popover polls while open)
GET /v1/jobs     → the job is still there tomorrow (options page)
```

The "Research this" button appears only when a signed-in cloud can actually run the job
(`publicSettings().researchReady`); offering it otherwise would be a promise the client
cannot keep. Closing the popover stops watching, not working.

`runResearchToCompletion()` drives the same lifecycle for tests and for any polling runtime;
it short-circuits for blocking runtimes instead of re-reading a value it already holds.

## Credits

Research costs **8 credits** on the official service, checked before the job is created and
charged only when it succeeds. Canceled and failed runs bill nothing. Token counts from the
runtime are recorded alongside the charge, so the price can be re-derived from real data.

## Responsibility split

| Concern | WDIMTM | Runtime |
|---|:---:|:---:|
| Product intent | ✅ | |
| Personal context selection | ✅ | |
| AgentJob lifecycle | ✅ | |
| Research UX | ✅ | |
| Capability execution | | ✅ |
| Model / provider routing | | ✅ |
| Workflow execution | | ✅ |
| Tool execution | | ✅ |
| Provider secrets | | ✅ |
| Telemetry | consume | ✅ |
| Quota / credits | product policy | enforcement |
| Result / source normalization | ✅ | passthrough |

## Implementation order

1. Minimal research prototype on a PromptaaS **Single Agent** — *pending: needs the app
   created in PromptaaS; the fallback runtime covers dogfood until then.*
2. `ResearchRuntime` + `PromptAASResearchRuntime` — **done**.
3. WDIMTM `AgentJob` API / state mapping — **done**.
4. Extension `Explain → Research → result` end-to-end — **done**.
5. Sources, cancel — **done**. Progress and budget still come back as zero until a runtime
   reports steps; the fields exist, nothing fabricates them.
6. Workflow DAG **only** when a single agent is demonstrably not enough.
7. Let real dogfood decide whether opportunity research needs its own capability.

Prove the product value before adding orchestration complexity.

## Still open

- A PromptaaS research capability (Single Agent) has to be created before
  `PROMPTAAS_*` can be set; until then the fallback runtime answers.
- Progress and steps are plumbed but empty: the blocking runtime reports neither.
- Budget (`maxSteps` / `maxSeconds` / `maxCostUsd`) is carried on the job and not yet
  enforced anywhere.

## Non-goals

- Scheduled watch / monitor (#53)
- Autonomous external actions
- A marketplace
- Reimplementing a general agent/workflow engine in this repo
- Routing ordinary Explain through an AgentJob
- Coupling the extension to any runtime's internal API or persisted ids
