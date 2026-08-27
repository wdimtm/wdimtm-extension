# Design: Memory cold start — conversation import

Issue: #49 (tracked in the private working repo)
Status: **Approved for implementation** (2026-08-15)

## Goal

A new user with an existing ChatGPT/Claude history can install WDIMTM, import and
review a distilled profile, and immediately get more personalized explanations —
without a WDIMTM account or backend.

## Scope

**In:** the full Phase 1 loop — import file → local parse → model distillation →
merge/dedupe → review → save into `LocalMemoryProvider`.

**Out:** first-run onboarding profile questionnaire (independent work, shares no
code with this pipeline); cloud sync; embedding-based retrieval.

## Product principle

ChatGPT/Claude histories are **memory sources**, not the canonical memory store.
Raw conversations are distilled into durable, reviewable memories — never copied
wholesale into retrieval.

## Architecture

`MemorySource` (ingestion) is a new layer, separate from the existing
`MemoryProvider` (storage/retrieval). They communicate only through a normalized
candidate structure.

```
export file (.json)
   │
   ├─ parse ─────────────► Conversation[]        format-specific, only here
   ├─ prefilter ─────────► Conversation[]        local, drops empty conversations
   ├─ batch ─────────────► Batch[]               pure, deterministic
   │
   ├─ distill (map) ─────► MemoryCandidate[]     model, N batches in flight
   ├─ dedupe (lexical) ──► MemoryCandidate[]     local, cheap pre-pass
   ├─ merge (reduce) ────► MergedMemory[]        model, one call, includes existing memories
   │
   └─ review ────────────► LocalMemoryProvider.add()
```

### Files

| File | Responsibility | Depends on |
|---|---|---|
| `lib/memory-sources/types.js` | `Conversation` / `MemoryCandidate` / `MemorySource` contracts | — |
| `lib/memory-sources/chatgpt.js` | ChatGPT export parser | types |
| `lib/memory-sources/claude.js` | Claude export parser | types |
| `lib/memory-sources/index.js` | format sniffing + registry | parsers |
| `lib/memory-import/prefilter.js` | drop empty / user-less conversations | types |
| `lib/memory-import/distill.js` | batching, prompt building, response parsing | types |
| `lib/memory-import/merge.js` | lexical dedupe, reduce prompt, response parsing | types |
| `lib/memory-sources/claude-memory.js` | Claude memory-store parser (profile blocks, not conversations) | types |
| `lib/memory-import/profile.js` | memory-store batching, prompt, response parsing | types, distill |
| `lib/memory-import/zip.js` | ZIP central directory reader; inflates only what is asked for | — |
| `lib/memory-import/collect.js` | the seam: zip / folder / files / drop → JSON entries | zip |
| `lib/memory-import/runner.js` | the driver loop: retry, backoff, cancel, resume | distill |
| `runtime/completion.js` | plain system+user completion, and the import readiness gate | runtime-errors |
| `options/import.html` + `import.css` + `import.js` | wizard UI and job driver | all |
| *edit* `background/service-worker.js` | two stateless message handlers | distill / merge |
| *edit* `lib/memory.js` | `add()` accepts `confidence`; `search()` scores on it; cap 200 → 500 | — |
| *edit* `lib/options-i18n.js` | ~40 new keys, en + zh_CN | — |
| *edit* `options/options.html` + `options.js` | entry button on the Memory card | — |

### Boundaries that matter

**`Conversation` is the only seam.** Parsers are the sole place that knows a
format's quirks. Everything downstream sees only
`{ id, title, createdAt, turns: [{ role, text }] }`. Adding a third source means
one new parser plus a registry entry — no other module changes.

**Pure computation is split from IO.** `buildDistillBatches()` is pure and
deterministic; only the service worker touches the network. `buildMergePrompt()`
and `parseMergeResponse()` are pure; only the call between them touches the
network. `runner.js` takes both its transport and its clock as arguments, so
retry, backoff, cancel and resume are testable without a browser or a real wait
— the part most likely to be subtly wrong and least likely to be exercised by
hand. This keeps ~90% of the logic testable under `node --test` with no
`chrome.*` mocks, matching the existing test style in `tests/unit/`.

**Distillation gets its own completion entry point.** The explain runtime builds
page/lens/memory context and parses follow-up trailers out of the reply;
distillation wants neither. Threading special cases through the explain path
would deepen a module that is already doing enough, so `runtime/completion.js`
exposes a narrow system+user→text call instead.

**The import UI is its own page.** `options.js` collects the entire settings form
on save; a multi-step wizard with its own state machine would tangle with that.
`options/import.html` reuses the same Classical CSS.

## Execution model

The **options page drives the job**; the service worker is a **stateless
per-batch executor**.

```
import.html (a real tab — options_ui sets open_in_tab: true)
   holds: parsed conversations in page memory, never on disk
   loop:  for each batch
            ├──► sendMessage(DISTILL_BATCH) ──► service worker
            │                                    wakes → one API call → replies → sleeps
            ├──◄ candidates
            └──► persist candidates + cursor to chrome.storage.local (small)
```

The worker never holds job state, so MV3's worker lifetime stops being a problem
instead of being fought with `chrome.alarms` keepalive hacks.

Three consequences, none accidental:

1. **No storage quota problem.** `chrome.storage.local` is capped around 10MB
   without `unlimitedStorage`; a heavy export parses to 20MB+. Raw conversations
   never leave page memory, so no new permission is needed — which matters for
   the Chrome Web Store listing (issue #21), where a short permission list is
   easier to review and to trust.
2. **Raw conversations never touch disk.** Only distilled candidates (tens of KB)
   are persisted. This is stricter than the issue's privacy requirement, which
   only forbids uploading raw exports to a WDIMTM server.
3. **Cancel is clean.** A page-driven loop cancels by breaking out — no orphan
   state, nothing to reap.

### Resumability

Closing the page pauses the job. On reopen, candidates and cursor are read back
from `chrome.storage.local` and the user is asked to re-select the same file.
This relies on batching being pure and deterministic: the same file yields the
same batches, so the cursor stays meaningful across sessions.

A cheap fingerprint (conversation count plus a hash of the conversation id
sequence) guards against resuming against a different file. On a mismatch the
wizard warns and starts fresh, but **keeps the saved job**: a misclick on the
wrong file should not destroy resumable progress, and a real import overwrites
the checkpoint on its first batch anyway.

The saved job also survives a user-initiated stop and a fatal failure, since
both are states someone may want to continue from. Only committing the reviewed
memories, or explicitly discarding, clears it.

The cost is re-picking a file. What it buys is that **already-spent tokens are
never wasted**.

### Concurrency and rate limits

The page keeps 3–4 batches in flight. On `quota` or `timeout` it backs off
exponentially and drops concurrency to 1, then climbs back slowly. Progress shows
completed/total batches and an estimate. The page warns the user to keep it open.

Model calls reuse the configured OpenAI-compatible endpoint, so import
introduces no new configuration surface. Two runtimes cannot serve it: `mock`
has no model behind it, and PromptaaS exposes a fixed explainer agent rather
than an open completion endpoint. Since `mock` is the fresh-install default,
hitting this is a routine path, not an edge case — see the disclosure screen
below.

## Data contracts

```js
/** @typedef {Object} Conversation
 *  @property {string} id
 *  @property {string} title
 *  @property {string} createdAt      // ISO
 *  @property {Turn[]} turns
 *
 *  @typedef {Object} Turn
 *  @property {'user'|'assistant'} role
 *  @property {string} text
 */

/** @typedef {Object} MemoryCandidate
 *  @property {MemoryType} type          // reuses the existing six types
 *  @property {string} text              // one sentence, first person
 *  @property {string[]} evidenceTitles
 *  @property {number} confidence
 */

/** @typedef {MemoryCandidate & {
 *    supportCount: number,   // how many candidates merged into this
 *    existingId?: string     // set when it duplicates a stored memory
 *  }} MergedMemory */

/** @typedef {Object} MemorySource
 *  @property {string} id                                  // 'chatgpt' | 'claude'
 *  @property {(text: string) => boolean} sniff            // recognizes the format
 *  @property {(text: string) => ParseResult} parse
 *
 *  @typedef {Object} ParseResult
 *  @property {Conversation[]} conversations
 *  @property {number} skipped                             // unparseable, surfaced in the UI
 */
```

`sniff` and `parse` are both pure and synchronous — they take the file's text and
return plain data, with no `chrome.*` or network access. That is what lets the
whole ingestion layer be tested under `node --test`.

Only `user` and `assistant` turns survive parsing; `system`/`tool` turns carry no
signal about who the user is.

Batching truncates the two roles asymmetrically — user turns keep 2,000
characters, assistant turns only 300. The signal about who the user is lives on
the user's side; the assistant's reply is context. This is not the prefilter
returning by the back door: no conversation is dropped, each is simply carried
at the density where its signal actually sits.

`evidenceTitles` holds conversation **titles, not ids** — raw conversations are
never persisted, so ids would be undereferenceable after import, while titles are
short, readable, and travel with the candidate. The review screen can therefore
show "supported by 12 conversations including …", which extends the RFC's success
criterion ("why did WDIMTM think this mattered to me?", `docs/memory-rfc.md`) to
imported memories.

`existingId` handles collisions with stored memories: no duplicate is added; the
row is greyed and unchecked so the user sees the system noticed.

### Parsing decisions

**ChatGPT.** Each conversation carries `mapping` (a message tree keyed by id) and
`current_node`. The correct extraction walks from `current_node` up through
`parent` to the root and reverses, yielding the active branch. Iterating
`mapping` wholesale would include abandoned regeneration branches — three
versions of the same answer fed to the distiller.

**Verified against a real export.** A 714-conversation ChatGPT export (67MB)
confirmed the tree walk and turned up five things the design had not anticipated:

- **History splits across `conversations-000.json` … `conversations-007.json`.**
  The wizard therefore accepts a multi-file selection, sorted by name so the
  resume fingerprint stays stable across sessions. Accepting a single file would
  have silently imported an eighth of someone's history.
- **`thoughts` and `reasoning_recap` are ~35% of all messages.** Reasoning
  traces are the model thinking aloud, not the user, and are dropped.
- **Voice conversations keep their words in `audio_transcription` parts.**
  Filtering `parts` to strings — the original design — made an entire spoken
  conversation parse to nothing. Transcripts are now extracted.
- **`user_editable_context` holds custom instructions and a self-description.**
  Text-for-text the highest-value material in an export, and it has neither
  `parts` nor `text`, so it needs handling of its own.
- **Nodes carry `id`, `message`, `parent` — no `children`.** Harmless here,
  because the walk only ever follows `parent`.

Against that export the parser reads all 714 conversations, zero skipped.

A real 487-conversation Claude export (21MB, a single `conversations.json`)
confirmed that parser too, with one decision worth recording:

- Content blocks include `thinking`, `tool_use`, `tool_result` and
  `token_budget`; only `text` blocks are read.
- 258 messages carry an empty `text` field alongside a populated `content`
  array, so preferring blocks over `text` is load-bearing, not cosmetic.
- 53 conversations are wholly empty records and are correctly skipped.
- **`parent_message_uuid` forks in 42 conversations — 11.8% of messages sit on
  abandoned branches — and the parser deliberately keeps them.** Claude ships no
  `current_node` equivalent, so choosing a branch would be a guess, and guessing
  wrong drops real user content. Keeping everything costs only redundancy, which
  the dedupe and merge passes already absorb. The asymmetry decides it.

Parsers stay defensive either way: a conversation with missing fields is skipped
and counted, and the count is surfaced ("12 of 1,247 could not be parsed"),
rather than failing the import.

**`.zip` was descoped, then reversed.** The original reasoning was that
unzipping needs either a third-party library or hand-written container parsing,
and the extension has zero runtime dependencies. Measuring a real export changed
the balance: a ChatGPT archive is **527MB across 619 files, of which the
conversation JSON is 65MB — 12%**. Asking someone to unzip half a gigabyte and
then find the right files among 619 is worse than owning 200 lines.

`lib/memory-import/zip.js` reads the central directory and inflates only the
entries asked for, entirely through `Blob.slice()`, so the 88% we do not want is
never read off disk. Scope is deliberately narrow — stored and deflated entries,
ZIP64 sizes — and anything else (encrypted, exotic compression) is reported as
unsupported rather than silently mangled.

All four input paths converge on one seam:

```
a .zip        ─┐
a folder      ─┼─► collectJsonEntries() ─► [{ name, text }] ─► parseExport()
picked files  ─┤
a drop        ─┘
```

Below that line nothing knows how the bytes arrived, and classification is
unchanged: each entry is routed by what it turns out to be, never by what the
user said it was. Entries are sorted by name so batching — and therefore the
resume fingerprint — stays deterministic regardless of pick or drop order.

A folder pick hands over all 619 files; filtering by name happens before any
read, and `File` objects are lazy, so the 412MB of attachments cost nothing.

### Persistence mapping

| Origin | `source` | `confidence` |
|---|---|---|
| Typed in / Remember this | `explicit` | 1.0 (unchanged) |
| Import, checked in review | `inferred` | `0.6 + 0.3 × min(supportCount / 10, 1)` |
| Not checked | — | **not saved** |

Confidence floats with support rather than being a flat constant: a memory backed
by 30 conversations should outrank one backed by 2, and `supportCount` is a free
by-product of the reduce pass.

The scale is **fixed** (10 supporting conversations saturates it), deliberately
not normalized against the maximum in the current import. Normalizing per-import
would make confidence incomparable across imports — the top memory of a tiny
import would outrank a well-supported memory from a large one.

Nothing the user did not check is ever saved — including the folded long tail.
This satisfies the issue's "never silently save" requirement and the RFC's
explicit-only stance.

### Two targeted edits to existing code

1. **`search()` scores on confidence.** `if (m.source === 'explicit') score += 0.5`
   becomes `score += (m.confidence ?? 1) * 0.5`. Provenance (`source`) and
   endorsement (`confidence`) become separate axes, which the import case
   requires: a memory that came from an import but was hand-confirmed in review
   has `inferred` provenance and high trust. **No migration is needed** — stored
   memories all have `confidence: 1` because `add()` hardcoded it, so the new
   formula reproduces the old score exactly.

2. **The 200-memory cap becomes 500.** `add()` does
   `saveAll(all.slice(0, 200))`. Accepting 80 imported memories would silently
   evict the 80 oldest — harmless when memories arrived one at a time, damaging
   under bulk import. At roughly 100 bytes per memory, 500 is nothing for
   `chrome.storage.local`. The review screen additionally checks the post-accept
   total and says so plainly instead of truncating.

## The memory-store path

A real Claude export ships `memories.json`: the user's own curated memory store,
written by Claude over time. It is **already distilled** — the thing the
conversation pipeline spends half a million tokens producing. For the export
this was built against: a 5KB prose profile plus nine structured markdown notes,
11KB in total, **2,954 tokens in a single call — 174× cheaper than the same
user's full ChatGPT history**.

So it gets a short path of its own rather than being forced through batching and
per-conversation extraction:

```
memories.json → blocks → one call → candidates → (same dedupe / merge / review)
```

Three decisions make it worth the separate path:

**A different prompt, because it is a different job.** The conversation prompt is
written to look past chat noise and infer. A memory store needs *splitting*, not
inference: the statements are already about this person, in their own terms.
Re-inferring them would only add drift.

**The source path is a type hint.** `/preferences.md`, `/profile.md`,
`/topics/*` and `/areas/*` line up almost exactly with our memory types, so the
path travels with each block into the prompt and out again as review evidence.

**Curated statements keep their confidence through the merge.** They land at
0.9, above anything the support-count scale can reach from a handful of
conversations, and `parseMergeResponse` takes the maximum rather than
recomputing from support. Without this, a statement the user's own memory store
made would be demoted to 0.63 simply because no conversation happened to vouch
for it. For the same reason they never fold into the review screen's collapsed
tail.

It runs **before** the conversation phase: someone who selected only
`memories.json` is finished in one call, and someone who selected everything
gets the strongest material into the merge whether or not the long run finishes.
A failure here also stops the run — a model that rejects the small call will
reject the large one, and there is no reason to burn a whole history to find
that out. On resume it is skipped, since those candidates are already in the
saved job.

**The user never picks a vendor.** Every selected file is sniffed and routed by
what it turns out to be — ChatGPT history, Claude history, or a Claude memory
store. Selection order does not matter either; a memory store picked last still
runs first.

ChatGPT ships no equivalent. Its export carries `user.json` and
`user_settings.json`, which are account and interface settings, not memory.

## UI flow

Entry: a button on the Memory card, "Import from AI chat history", opening
`import.html`.

**① Choose file.** States supported formats and "unzip first, then select every
conversations file" — naming the split explicitly, since a user who picks one
file of eight has no way to tell that most of their history is missing. The privacy statement is up front, not after the fact:
raw text is processed in this page's memory only, never written to disk, and
nothing is sent anywhere without explicit confirmation.

**② Scale disclosure.** Parsing stops here and itemizes the bill as label/value
rows — this screen is a bill being submitted for approval, and the shape also
keeps every count out of a pluralized noun phrase, which plain string tables
cannot inflect:

> | | |
> |---|---|
> | Conversations parsed | 1,247 |
> | Could not be parsed, skipped | 12 |
> | Batches to send | 150 |
> | Estimated tokens | 620k |
> | Estimated time | 6–12 min |
> | Destination | gpt-4o-mini at api.openai.com |
>
> Raw conversations are not written to disk and are never sent to a WDIMTM server.
> [ Start distilling ] [ Back ]

Not a byte is sent until this is confirmed. The time figure is a range on
purpose: throughput depends on the provider's rate limits, which the extension
cannot see.

This screen is also where a `mock` runtime is intercepted. Rather than hiding the
entry point, it shows "configure a model first" with a link to AI access. **That
link must open in a new tab** — parsed conversations live only in this page's
memory, so navigating away would force the user to re-pick the file. This is a
hard UI requirement derived from the architecture, not a nicety.

**③ Running.** Progress bar, "87 of 150 batches", time estimate, a prominent
"keep this page open", and a cancel button that takes effect immediately. Rate
limiting shows "backing off" inline rather than raising an alarming error.

**④ Review.** Summary line, reusing the issue's own copy:

> We found: **12 interests · 8 areas you already understand · 5 response
> preferences · 3 active goals**

Grouped by `type`, sorted within a group by support count. Each row has a
checkbox, inline-editable text, an editable type, the support count, and
expandable source titles.

Filtering lands **after** distillation rather than before it: high-support items
are expanded and pre-checked, the long tail is collapsed and unchecked. The user
can skim the head and accept, or expand the tail and pick. Rows colliding with
existing memories are greyed and unchecked.

**⑤ Done.** "Saved 23 memories", with a link back to the Memory card. Unchecked
candidates are discarded with the page state.

**Resume state.** On reopening with an unfinished job: "last run reached 87 of
150 batches — re-select the same file to continue".

All copy goes through `options-i18n.js`'s existing key-value tables, English and
Simplified Chinese.

## Error handling

Error classification reuses `lib/runtime-errors.js` rather than inventing a
second taxonomy.

| Condition | Behavior |
|---|---|
| File is not valid JSON | Clear message, no crash |
| Valid JSON, unknown shape | "Could not recognize this file's format", list supported ones |
| One conversation fails to parse | Skip, count, report the total afterwards |
| Model returns non-JSON | Lenient parse (strip markdown fences, take first `[` to last `]`) → retry the batch once → skip and count. One bad batch never kills the job |
| `quota` / `timeout` / `offline` | Exponential backoff, concurrency to 1 |
| `unauthorized` / `forbidden` / `missing_key` / `not_found` | Abort immediately — retrying is pointless — keeping candidates already earned |
| Candidates exceed the reduce context | Reduce per `type` group, then a final merge across groups |
| The message round trip itself fails | Surfaced as an ordinary failure result, never an unhandled rejection — otherwise a torn-down worker leaves the wizard silently dead |
| Storage write fails | Surface the failure; do not report success |

## Testing

Because the pure/IO split keeps most logic in pure functions, the unit layer
carries the weight and the e2e surface stays thin.

**Unit (`node --test`, no mocks):**

- Parsers against redacted real-export fixtures: expected `Conversation[]`; a
  conversation with abandoned branches yields only the active branch; malformed
  conversations are skipped and counted
- `prefilter` drops empty and user-less conversations
- `buildDistillBatches` is deterministic across runs; batch-size boundaries
- Fingerprint: stable for the same file, changes when one conversation changes
- `parseDistillResponse` / `parseMergeResponse`: markdown fences, surrounding
  prose, malformed JSON
- `dedupeLexical` collapses exact and near-exact duplicates
- Confidence formula boundaries
- `memory.js` `search()` confidence scoring, **including a regression test that
  legacy memories with `confidence: 1` score exactly as before**

**E2E (`tests/e2e/extension.e2e.mjs`, headed Playwright):** file choice →
disclosure screen shows correct counts → `mock` runtime interception. The full
distillation loop is covered by unit tests, not e2e.

## Open questions deferred

- How stale goals decay or get reconfirmed (issue #49 open question) — needs
  real usage data first
- Whether local embeddings beat lexical retrieval, and at what memory count
  (`docs/memory-rfc.md` already defers this)
- Whether a second import should reconcile against the first, or simply append
