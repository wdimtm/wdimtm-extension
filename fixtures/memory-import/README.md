# Memory import fixtures

Sample export files used by `tests/unit/memory-sources.test.mjs`.

## ChatGPT: verified against a real export

`chatgpt-sample.json` was rebuilt from the shapes found in a real 714-conversation
ChatGPT export (67MB across eight files). The parser now handles everything that
export actually contained; the entries here are hand-written stand-ins carrying
those shapes, not copied user data.

What a real export turned out to look like:

| Fact | Consequence |
|---|---|
| History splits across `conversations-000.json` … `conversations-007.json` | The wizard accepts multiple files; picking one would import an eighth of a history |
| `content_type: "thoughts"` and `"reasoning_recap"` are ~35% of all messages | Reasoning traces are dropped — they are the model thinking, not the user |
| Voice conversations store their words in `audio_transcription` parts | Extracted; without it a spoken conversation parses to nothing at all |
| `user_editable_context` holds custom instructions and a self-description | Extracted, and labelled — the highest-value text in an export when set |
| `multimodal_text` mixes `image_asset_pointer` objects with strings | Pointers dropped, text kept |
| Nodes carry `id`, `message`, `parent` — **no `children`** | The parser only ever walks `parent`, so this does not matter |
| No message was flagged `is_visually_hidden_from_conversation` | Handling kept anyway; harmless |

Against that export the parser reads all 714 conversations with zero skipped.

## Claude: verified against a real export

`claude-sample.json` carries the shapes found in a real 487-conversation Claude
export (21MB). Unlike ChatGPT, Claude ships a single `conversations.json`.

| Fact | Consequence |
|---|---|
| Content blocks include `thinking`, `tool_use`, `tool_result`, `token_budget` | Only `text` blocks are read; the rest is model machinery |
| 258 messages carry an empty `text` field but a populated `content` array | Blocks are preferred, with `text` as the fallback — that order matters |
| 53 conversations are wholly empty: `text: ""`, `content: []`, no files, no name | Correctly skipped and counted; not a parser failure |
| `parent_message_uuid` forks in 42 conversations (11.8% of messages) | **Deliberately not resolved** — see below |
| A separate `memories.json` holds a pre-distilled prose profile and nine markdown notes | Read on its own short path — 2,954 tokens in one call, 174× cheaper than the same user's full ChatGPT history |

Against that export the parser reads 427 of 487 conversations, the other 60
being genuinely empty records.

### Why Claude's branches are left alone

The ChatGPT parser follows `current_node` to the live branch, so abandoned
regenerations never reach the distiller. Claude's export has no equivalent
pointer: `chat_messages` is a flat, chronological array containing every branch.

Picking the branch that ends at the newest message would be a guess. Guessing
wrong **drops real user content**, while keeping everything only costs some
redundancy — which the dedupe and merge passes exist to absorb. The asymmetry
favours keeping it all, so that is what the parser does.

## What each fixture deliberately covers

**`chatgpt-sample.json`**

- A conversation whose `current_node` points at one branch while an abandoned
  regeneration hangs off the same parent — only the active branch should survive
- A `system` turn, which carries no signal about the user
- A message flagged `is_visually_hidden_from_conversation`
- A `code` content block, which stores its body in `text` rather than `parts`
- An entry with no `mapping` at all, which must be counted as skipped
- `thoughts` and `reasoning_recap` reasoning traces, which must not reach the
  distiller
- A voice conversation whose text lives in `audio_transcription` parts
- `user_editable_context`, both filled in and empty
- An image message where the pointer is dropped but the question is kept

**`claude-memories-sample.json`**

- The prose profile and each memory file, which become separate blocks
- Paths like `/preferences.md` and `/topics/*`, which hint at the memory type
- An empty memory file, which is counted rather than emitted as a blank block

**`claude-sample.json`**

- Typed `content` blocks alongside the older flat `text` field
- `sender: "human"` normalizing to the `user` role
- A conversation with no user turn, which the prefilter drops
