# WDIMTM ↔ Runtime contract

## Dogfood architecture (current)

```
selection
+ bounded page context
+ user profile
+ relevant memories
+ lens / mode
        │
        ▼
   one model call
   (openai-compatible recommended)
        │
        ▼
explanation (+ optional why-it-matters)
+ ≤3 predicted follow-ups
+ optional memory suggestion
+ meta (mode, personalization, capability)
```

**No WDIMTM backend, Dify, or required PromptaaS** for ordinary Explain.

| Runtime | Role |
|---------|------|
| **openai-compatible** | **Recommended real dogfood path** (BYOK / any OpenAI-compatible gateway including sub2api) |
| **anthropic** | Native Anthropic Messages API (`POST {base}/messages`, `x-api-key` + `anthropic-version`, top-level `system`, no sampling params) |
| **mock** | Offline / CI |
| **promptaas** | Optional; future routing / workflows / billing |
| **wdimtm-cloud** | Hosted service mode — same contract, server-side credentials (`cloud-api-contract.md` (private working repo)) |

## Boundary

| Owner | Responsibility |
|-------|----------------|
| **WDIMTM** | Selection UX, bounded page context, Lens, profile/memory relevance, privacy, single-shot context assembly |
| **Runtime** | Model execution. PromptaaS may later own tools, multi-step workflows, quota |

## ExplainRequest

```ts
interface ExplainRequest {
  selection: string;
  page: {
    url: string;
    title: string;
    context?: string; // bounded neighborhood, never full DOM
  };
  lens?: {
    id: string;
    instructions?: string;
  };
  /** Stable self-description (also may appear as memories type=profile). */
  profile?: string;
  memories?: Array<{
    type: string; // interest | preference | knowledge | goal | note | profile
    content: string;
  }>;
  mode?: ExplainMode;
  answerLanguage?: string;
  answerDepth?: "short" | "normal" | "detailed";
  languageInstruction?: string;
  /** Free-form question when mode = probe */
  followUpQuestion?: string;
}

type ExplainMode =
  | "explain"
  | "more"
  | "simplify"
  | "why_it_matters" // UI may still send "why"
  | "verify"
  | "research"
  | "opportunity"
  | "probe"
  | "summarize"
  | "summarize-page";
```

### Bounds

- `selection` ≤ 4000 characters  
- `page.context` ≤ 2500 characters  

Enforced in the content script and re-checked in the runtime adapter.

### Context builder sections (model input)

The OpenAI-compatible path renders **labeled sections** (not a flat blob):

1. **PAGE FACTS** — title, URL, selection, bounded surrounding context  
2. **USER PROFILE** — stable self-description  
3. **RELEVANT MEMORIES** — durable interests / knowledge / goals (not chat dumps)  
4. **LENS** — framing instructions  
5. **MODE / TASK** — explain posture  

## ExplainResponse

```ts
interface ExplainResponse {
  explanation: string;
  summary?: string;
  /** Optional explicit personal-implication block (also often woven into explanation). */
  whyItMatters?: string;
  /** Prefer ≤3 model/content predicted chips; UI may add discuss/remember. */
  followUps?: Array<string | FollowUpAction>;
  memorySuggestion?: {
    content: string; // durable, standalone; ≤280 chars; never full answer
    type: "interest" | "preference" | "knowledge" | "goal" | "note";
    reason?: string;
  } | null;
  runtime?: string;
  meta?: {
    mode?: ExplainMode | string;
    lensId?: string;
    personalization?: "none" | "light" | "rich";
    capability?: "single_shot" | "tools" | "workflow";
    capabilityStatus?: "current" | "future";
  };
}

interface FollowUpAction {
  id: string;
  label: string;
  intent: string; // more | why | verify | probe | discuss | remember | …
  question?: string; // for intent=probe
}
```

### Model trailers (openai-compatible)

Visible answer first, then optional trailers (stripped before UI display):

```
<<<WDIMTM_FOLLOWUPS>>>
Concrete question 1?
Concrete question 2?
<<<END>>>
<<<WDIMTM_MEMORY>>>
{"type":"interest","content":"durable user fact","reason":"..."}
<<<END>>>
```

## Modes vs future routing

| mode | Dogfood (today) | Future |
|------|-----------------|--------|
| `explain` / `more` / `simplify` / `why_it_matters` / `probe` | Single model call | Same |
| `verify` | Optional **web search** → inject WEB EVIDENCE → single model call | Multi-hop agents |
| `research` | Optional **web search** → single synthesis call | Multi-step research workflow |
| `chat` (page chat) | Optional **web search** per turn (query from latest user message) → inject WEB EVIDENCE into chat system prompt; optional SSE stream | Tool-calling agents |
| `opportunity` | Single-shot framing | Market/data tools |
| (code investigation) | — | GitHub tools |

### Web search (optional)

Settings: `webSearchEnabled`, `webSearchProvider` (`tavily` \| `brave` \| `serper`), `webSearchApiKey`.

When enabled and mode is `verify` / `research` / `chat` (or fact-check lens on explain):

1. Build query from selection (+ title), or for chat: latest user message (+ selection/title)
2. Fetch top snippets
3. Inject as **WEB EVIDENCE** (separate from PAGE FACTS / chat page context)
4. Model cites URLs; `meta.webSearch` / chat `webSearch` reports `{ used, provider, resultCount, error? }`

Normal Explain does **not** search.

### Page chat streaming

When `stream` is on, content connects to port `wdimtm-chat` and receives `chunk` / `done` (same shape as explain’s `wdimtm-explain` port).

## Product access modes

1. **BYOK** → runtime `openai-compatible` or `anthropic` (provider chosen inside BYOK)  
2. **WDIMTM Cloud** → runtime `wdimtm-cloud` (Agentaab is a server-side implementation detail)  
3. **mock** → offline / CI  

Service-mode semantics (which capability each mode can provide, and why) live in
[`service-mode.js`](../core/service-mode.js) and `business-model.md` (private working repo).  
Product UX: [`ai-access-modes.md`](ai-access-modes.md).

## Non-goals (current)

- Operating the WDIMTM Cloud backend (contract only — see #51)  
- Dify or forced multi-agent orchestration  
- Full-page DOM to the model  
- Auto-saving memory without explicit user confirm  
- Implementing the capability router (code boundary only)
