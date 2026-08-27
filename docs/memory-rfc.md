# RFC: Personal memory model and interaction

Status: **Accepted for V1 local implementation** (Issue #3 / #5)  
Product principle: *Memory providers own what is known; WDIMTM owns what is relevant now.*

## User-visible definition

A **memory** is a short, human-readable statement WDIMTM may use to personalize explanations:

- **Profile** — expertise, preferred depth/language  
- **Interest** — ongoing topics (e.g. arbitrage, AI products)  
- **Goal** — temporary research aims  
- **Knowledge** — concepts the user already knows  
- **Preference** — how they like answers framed  
- **Note** — explicit “Remember this” captures  

## What is stored automatically?

**Nothing from page reading.** V1 is explicit-only:

1. Profile text in settings  
2. Memories added in settings  
3. **Remember this** from the popover  

Suggested / inferred memories are deferred (would require confirmation UI).

## When to ask for confirmation?

| Path | Confirmation |
|------|----------------|
| User clicks Remember this | Implicit consent |
| User edits settings | Implicit consent |
| Future: “You often ask about X” | Always ask before saving |

## Inspection / edit / delete

Settings → Memory list: type, text, source, forget. Clear all supported.

## Temporary goals vs stable interests

Distinguished by `type` field (`goal` vs `interest`). Retrieval prefers goals and profile slightly, but V1 does not auto-expire goals yet (future: TTL / “done”).

## Relevance selection (V1)

No embeddings. For each explain:

1. Attach full `profileText` if present  
2. Keyword-overlap score of memories against selection + title + lens id  
3. Cap at ~6 memories  

When memory count grows large, evaluate semantic retrieval (V3 in issue #5).

## What stays on-device?

| Data | Storage |
|------|---------|
| Profile, lenses, runtime prefs | `chrome.storage.sync` |
| Memory cards | `chrome.storage.local` |
| Page selections | Not retained after the request |

Cloud runtimes (OpenAI / PromptaaS) receive only the *selected relevant* memories for that request.

## Lenses vs Memory

| | Lens | Memory |
|--|------|--------|
| Nature | Explicit intent for *this* explanation | Durable facts about the user |
| Changes | Often per selection | Rarely |
| Example | Opportunities | “I care about DeFi incentives” |

Lenses without memory remain fully useful. Memory without a lens still applies under General.

## Provider interface

```ts
interface MemoryProvider {
  list(): Promise<Memory[]>;
  search(query: string, limit?: number): Promise<Memory[]>;
  add(input): Promise<Memory>;
  update(id, patch): Promise<Memory | null>;
  remove(id): Promise<boolean>;
  clear(): Promise<void>;
}
```

Implementations:

- `local` — default  
- `none` — disabled  
- Future: Nowledge Mem, MCP  

## Rollout

1. ~~Lenses only~~  
2. ~~Explicit profile + Remember this + editor~~  
3. Suggested memories (future)  
4. Opt-in automatic learning (future)  
5. Semantic retrieval when scale requires it  

## Success criterion

Users can answer: **“Why did WDIMTM think this mattered to me?”**  
by inspecting active Lens + profile/memories that were eligible for the request.
