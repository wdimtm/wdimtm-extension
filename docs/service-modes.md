# One client, multiple service modes

> **One open-source client, multiple service modes, optional paid intelligence cloud.**

WDIMTM ships **one** browser client. Free and paid differ by **service mode**, never by
client edition. What a subscriber buys is personal intelligence, convenience, and cloud
execution — not a separate extension.

The price of that subscription is not in this document. It is an unvalidated hypothesis
and stays in the private working repo.

## One client, multiple service modes

```text
                  WDIMTM Extension
                  (the only client)
                         │
          ┌──────────────┼──────────────┐
          │              │              │
        Local           BYOK        WDIMTM Cloud
          │              │              │
     Local memory   user's own model  hosted service
          │              │              │
        Free           Free        Subscription
```

Rules:

- One official Chrome Web Store entry, built from this open tree.
- All users share the same UX and codebase.
- Local / BYOK stay first-class paths, permanently.
- Upgrading to Cloud never replaces the extension and never drops local memory.
- Advanced users may point the same client at a self-hosted backend that implements
  [`cloud-api-contract.md`](cloud-api-contract.md).
- No feature is made cloud-only just to force monetization.

Today's runtime ids map onto these modes — see
[`ai-access-modes.md`](ai-access-modes.md) for the shipped BYOK / Cloud split.

## Capability, not client edition

Availability follows what the **current service mode can actually provide**.

| Capability | Local / BYOK | WDIMTM Cloud |
|---|---:|---:|
| Explain / Why it matters | ✅ | ✅ |
| Local memory | ✅ | ✅ |
| Chat history import | ✅ | ✅ |
| Custom lens | ✅ | ✅ |
| User's own model | ✅ | optional |
| No API key required | ❌ | ✅ |
| Cloud memory sync | ❌ | ✅ |
| Cross-device context | ❌ | ✅ |
| Managed routing | ❌ | ✅ |
| Hosted deep research | provider-dependent | ✅ |
| Watch / monitor | usually ❌ | ✅ |
| Durable background agent | usually ❌ | ✅ |

> When a capability genuinely needs the cloud, explain **why** it needs the cloud.
> Never render a bare "Upgrade to Pro".

## Browser runtime vs cloud agent runtime

```text
                 WDIMTM Extension
                       │
          ┌────────────┴────────────┐
          │                         │
   Interaction runtime         Agent runtime
       (browser)                  (cloud)
          │                         │
 Explain / Why it matters     Deep research
 Follow-up                    Opportunity research
 Lightweight verify           Watch / monitor
 Short tool chains            Scheduled / background agents
          │                         │
  current interaction         independent, durable
  lifecycle                   task lifecycle
```

> **Ephemeral agent → browser. Durable agent → cloud.**

An in-browser agent may run a few searches or tool calls as long as the task is bound to
the current interaction, finishes in seconds, and is cheap to retry. Once the task must
become an **object with its own lifecycle**, it belongs in the cloud:

```ts
AgentJob {
  id
  goal
  state
  steps
  tools
  budget
  createdAt
  nextRunAt?
  result?
}
```

The shape the extension actually speaks is [`research-agent-contract.md`](research-agent-contract.md).
The server-side agent runtime owns persistence, parallel tool calls, retry/timeout,
budget, model routing, credential management, progress, cancel, and execution after the
browser is closed. That runtime is the closed service (`cloud/` in the private working
repo). The extension never learns its internals. Agentaab, when it is used, is a
server-side implementation of this contract, not a client mode.

## Four triggers for a backend

> **Local-first until persistence, orchestration, synchronization, or trust requires the cloud.**

1. **Persistence** — work must continue after the browser closes (watch / monitor).
2. **Orchestration** — multi-step, long-running, tool-calling, retry/budget/cancel.
3. **Synchronization** — memory / settings / personal context across devices.
4. **Trust / commerce** — server secrets, OAuth, accounts, quota, billing, abuse control.

If none of the four applies, do not introduce a backend. `CLOUD_TRIGGERS` in
[`core/service-mode.js`](../core/service-mode.js) is the same list, enforced in the UI.

## Memory stays the user's

```text
Local / BYOK
└── Local memory

WDIMTM Cloud
└── Personal context cloud
    ├── cross-device sync
    ├── ChatGPT / Claude imports
    ├── WDIMTM behavioral signals
    ├── semantic retrieval
    └── continuously improving context
```

Non-negotiable: memory stays inspectable, editable, deletable, exportable. Local memory
works forever. No artificial data lock-in. See [`memory-rfc.md`](memory-rfc.md) and
[`auth-and-sync.md`](auth-and-sync.md).

## Agentic product ladder

```text
What's this?
     ↓
What does it mean to me?
     ↓
What should I do about it?
     ↓
Research it for me
     ↓
Watch it for me
     ↓
Act when something changes
```

The first two rungs are browser-native. Research starts to favor the cloud. Watch and
background agents are backend-native.

> **Turn something worth caring about, found while browsing, into an agent that can keep
> researching, monitoring, and eventually acting.**

Typical chain: `Explain → Opportunity → Research → Watch → Act`.

## Upgrade path

```text
Install the one WDIMTM
↓
Local / BYOK dogfood
↓
Import ChatGPT / Claude history → local memory
↓
Frequent use
↓
Optional WDIMTM Cloud sign-in
↓
Managed AI + cloud memory
↓
Research
↓
Watch / background agent
```

The client never changes across this lifecycle. Moving Local → Cloud offers, but never
forces, migration of existing memories.

## Success criterion

> **A user should only ever need one WDIMTM.**

People willing to configure things can run this repository on Local or BYOK, free, for
as long as the project exists. People who want it to just work, or who need durable
execution, subscribe to WDIMTM Cloud inside the same client. The Chrome Web Store
package is a build of this tree.
