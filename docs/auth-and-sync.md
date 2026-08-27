# Auth & sync design (local vs signed-in)

Status: **Proposed** — product direction accepted; cloud backend is optional infrastructure.

Account mode is the **identity** axis. Who pays for inference is a separate axis
([`ai-access-modes.md`](ai-access-modes.md)); how both roll up into free vs paid service
modes is `business-model.md` (private working repo) (#50). A user may stay local-only while
paying a model vendor directly, or sign in without ever using WDIMTM Cloud inference.

## Product decision

Users choose:

| Mode | Identity | Data location | Default |
|------|----------|---------------|---------|
| **Local** | None | Browser only (`chrome.storage`) | **Yes** |
| **Signed-in** | OAuth (e.g. Google / GitHub / product IdP) | Local cache + cloud sync | Opt-in |

Principles:

1. **Local-first.** Local mode must remain fully useful (current MVP).
2. **No forced account.** Sign-in is never required for explain / chat / mock.
3. **Explicit sync.** User turns on sync; nothing uploads until signed in + sync enabled.
4. **Secrets stay local by default.** LLM API keys are **not** uploaded unless the user explicitly opts in to “sync secrets” (default **off**).
5. **Same privacy bounds.** Page selections still are not retained as a reading history; only user-owned prefs/memories/threads they chose to keep.

## What syncs when signed in

### Sync (user data)

- Profile text  
- Custom lenses  
- Memory cards  
- UI prefs (language, theme, depth, denylist, domain lens map)  
- Optional: page-chat threads (if user enables “sync chat history”)

### Never sync by default

- OpenAI / PromptaaS API keys  
- Ephemeral selection text / raw page DOM  
- Analytics of every page visited  

### Already partially “synced” without product OAuth

`chrome.storage.sync` already mirrors some settings across Chrome profiles when the user is signed into **Chrome**. That is **not** product OAuth and must not be marketed as a WDIMTM account.

## Architecture

```text
                    ┌─────────────────────┐
                    │  Account mode       │
                    │  local | signed-in  │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                                         ▼
   LocalStore                                   CloudSync
   chrome.storage.local/sync                    (optional backend)
   memories, settings                           Auth: OAuth tokens
                                                Sync: CRDT or LWW merge
```

```ts
interface AuthProvider {
  getSession(): Promise<Session | null>;
  signIn(): Promise<Session>;
  signOut(): Promise<void>;
}

interface SyncProvider {
  pull(): Promise<UserDataSnapshot>;
  push(snapshot: UserDataSnapshot): Promise<void>;
  /** Last-write-wins or field-level merge — document choice in implementation */
  merge(local: UserDataSnapshot, remote: UserDataSnapshot): UserDataSnapshot;
}

type UserDataSnapshot = {
  version: number;
  updatedAt: string;
  profileText?: string;
  customLenses?: unknown[];
  memories?: unknown[];
  preferences?: Record<string, unknown>; // non-secret settings
  chatThreads?: unknown[]; // optional, gated
};
```

### OAuth options (pick one for V1 cloud)

| Option | Pros | Cons |
|--------|------|------|
| **Google via `chrome.identity`** | Native extension UX | Google-only; still need a backend to store sync payload |
| **GitHub / generic OIDC** | Dev-friendly | WebAuth flow slightly heavier |
| **Supabase / Clerk / Auth0** | Fast path to auth + DB | Vendor lock-in; privacy review needed |

**Recommendation:** product OAuth + small sync API (or Supabase) behind `SyncProvider`. Do not invent a full IdP inside the extension.

## UX

### Settings → Account

```text
○ Local only (default)
  Data stays on this browser. No account.

○ Sign in to sync
  [Continue with Google]   [Sign out]
  Status: Signed in as a***@gmail.com
  ☑ Sync preferences & memories
  ☐ Sync chat history
  ☐ Sync API keys (not recommended)
  [Sync now]  Last synced: …
```

### First-run

- Default **Local only**  
- Banner optional: “Sign in to sync across devices” — dismissible  

### Conflicts

V1: **last-write-wins** by `updatedAt` per document (settings blob / memories list).  
V2: per-memory merge if conflicts become real.

### Sign-out

- Tokens cleared  
- Local data **kept** (do not wipe on sign-out)  
- Optional “Remove cloud copy” is a separate, confirmed action  

## Phased delivery

### Phase A — Account mode UI + contracts (no cloud required)

- [x] Design doc (this file)  
- [ ] `accountMode: 'local' | 'cloud'` in settings  
- [ ] Options Account card (local / signed-in copy)  
- [ ] `AuthProvider` + `SyncProvider` interfaces + `LocalOnly` implementations  
- [ ] Export/import remains the offline “sync” path  

### Phase B — OAuth + cloud store

- [ ] Choose IdP + sync backend  
- [ ] Sign-in / sign-out  
- [ ] Pull/push preferences + memories  
- [ ] Conflict policy + last synced UI  

### Phase C — Optional extras

- [ ] Sync chat threads  
- [ ] Device list / remote wipe  
- [ ] E2E encryption of cloud payload (user passphrase)  

## Privacy copy (for store / options)

> By default WDIMTM runs in **local mode**: preferences and memories stay in your browser.  
> If you sign in, we sync only the data you enable (profile, lenses, memories, optional chat).  
> API keys are not synced unless you turn that on. We do not upload full web pages or everything you read.

## Non-goals

- Requiring login to use the product  
- Silent cloud backup of browsing  
- Replacing memory providers (Nowledge/MCP remain separate experiments)  
