/**
 * Background service worker — privileged APIs, runtime, memory.
 */

import { MSG } from "../../core/messages.js";
import { hasDomainRule, setDomainLens } from "../../core/domain-lenses.js";
import { browserLocale } from "../lib/host-locale.js";
import { getMemoryProvider } from "../lib/memory.js";
import { safePortPost, servePortStream } from "../lib/port-server.js";
import {
  DEFAULT_SETTINGS,
  SECRET_KEYS,
  getSettings,
  publicSettings,
  saveSettings,
} from "../lib/settings.js";
import {
  buildUserDataSnapshot,
  getAccountMode,
  getAuthProvider,
  getSyncProvider,
  setAccountMode,
} from "../lib/auth/index.js";
import {
  appendPageHistory,
  clearPageHistory,
  clearThread,
  listThreads,
  loadPageHistory,
  loadThread,
  saveThread,
} from "../lib/chat.js";
import { sanitizeThreadAttachments } from "../../core/images.js";
import { fetchCloudAccount, resolveCloudConfig } from "../../core/cloud.js";
import {
  cancelResearchJob,
  createResearchJobFromExplain,
  getResearchJob,
  listResearchJobs,
} from "../../core/research-client.js";
import { isRuntimeReady } from "../../core/runtime-presets.js";
import { buildDistillPrompt, parseDistillResponse } from "../../core/memory-import/distill.js";
import { buildMergePrompt, parseMergeResponse } from "../../core/memory-import/merge.js";
import { buildProfilePrompt, parseProfileResponse } from "../../core/memory-import/profile.js";
import { classifyImportFailure } from "../../core/memory-import/runner.js";
import { classifyRuntimeError } from "../../core/runtime-errors.js";
import { resolveServiceMode } from "../../core/service-mode.js";
import { testRuntimeConnection } from "../../core/runtime-test.js";
import { chat, explain } from "../../core/runtime/adapter.js";
import { complete, importRuntimeStatus } from "../../core/runtime/completion.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch(async (err) => {
      // Same classification as the streaming path — the non-streaming explain
      // and every options action land here, and a raw string helps nobody (#18).
      const classified = await classifyForCurrentMode(err);
      sendResponse({ ok: false, error: classified.message, code: classified.code });
    });
  return true;
});

/**
 * The runtime no longer reaches for storage itself, so the host assembles what
 * it needs. This is the extension's half of that contract; Cloud supplies the
 * same shape from D1.
 */
async function runtimeDeps() {
  const settings = await getSettings();
  return {
    settings,
    hostLocale: browserLocale(),
    memoryProvider:
      settings.memoryProvider === "none" ? null : getMemoryProvider(settings.memoryProvider),
  };
}

/**
 * @param {unknown} err
 * @returns {Promise<{ code: string, message: string }>}
 */
async function classifyForCurrentMode(err) {
  const settings = await getSettings().catch(() => null);
  const mode = settings ? resolveServiceMode(settings) : "byok";
  return classifyRuntimeError(err, mode === "local" ? "byok" : mode);
}

/** Streaming explain / chat via long-lived ports. */
chrome.runtime.onConnect.addListener((port) => {
  // Disconnecting the port used to hide the UI while the request kept running —
  // and on the hosted path, kept being billed. Cancel now cancels (#18).
  const canceler = new AbortController();
  port.onDisconnect.addListener(() => canceler.abort());

  if (port.name === "wdimtm-explain") {
    port.onMessage.addListener(async (msg) => {
      if (msg?.type !== MSG.EXPLAIN) return;
      const request = msg.payload;
      await servePortStream(port, {
        validate: () => (request?.selection ? null : "Missing selection."),
        run: async ({ onChunk }) =>
          explain(request, {
            ...(await runtimeDeps()),
            signal: canceler.signal,
            onChunk,
          }),
        textOf: (response) => response.explanation,
        onError: (err) => postRuntimeError(port, err, canceler.signal),
      });
    });
    return;
  }

  if (port.name === "wdimtm-chat") {
    port.onMessage.addListener(async (msg) => {
      if (msg?.type !== MSG.CHAT) return;
      const payload = msg.payload || {};
      await servePortStream(port, {
        validate: () => {
          if (!payload.page?.url) return "Chat requires page.url.";
          if (!payload.messages?.length) return "Chat requires messages.";
          return null;
        },
        run: async ({ onChunk }) =>
          chat(
            {
              selection: payload.selection || "",
              page: payload.page,
              lens: payload.lens,
              messages: sanitizeThreadAttachments(payload.messages || []),
            },
            {
              ...(await runtimeDeps()),
              signal: canceler.signal,
              onChunk,
            }
          ),
        textOf: (response) => response.reply,
        onError: (err) => postRuntimeError(port, err, canceler.signal),
      });
    });
  }
});

/**
 * Failures reach the user here, so this is where they stop being raw strings.
 * The classifier already knows how each service mode fails; it was only wired
 * into Test connection, which is the one place users were not looking (#18).
 *
 * @param {chrome.runtime.Port} port
 * @param {unknown} err
 * @param {AbortSignal} canceled
 */
async function postRuntimeError(port, err, canceled) {
  // The user closed the popover. Reporting their own action as an error would
  // be noise, and the port is gone anyway.
  if (canceled.aborted) return;

  const classified = await classifyForCurrentMode(err);
  safePortPost(port, {
    type: "error",
    error: classified.message,
    code: classified.code,
  });
}

/**
 * @param {{ type: string, payload?: any }} msg
 */
async function handleMessage(msg) {
  switch (msg.type) {
    case MSG.EXPLAIN: {
      const request = msg.payload;
      if (!request?.selection) return { ok: false, error: "Missing selection." };
      const response = await explain(request, await runtimeDeps());
      return { ok: true, data: response };
    }

    case MSG.GET_SETTINGS: {
      const settings = await getSettings();
      return { ok: true, data: publicSettings(settings) };
    }

    case MSG.RESEARCH_START: {
      const moment = msg.payload;
      if (!moment?.selection) return { ok: false, error: "Missing selection." };
      const settings = await getSettings();
      // Research carries the same personal context that produced the
      // explanation — escalating must not lose what made the answer relevant.
      const provider = getMemoryProvider(settings.memoryProvider);
      const memories = await provider.list().catch(() => []);
      const job = await createResearchJobFromExplain(resolveCloudConfig(settings), {
        ...moment,
        profile: settings.profileText || "",
        memories: (memories || []).slice(0, 12).map((m) => ({
          type: m.type,
          content: m.content || m.text || "",
        })),
      });
      return { ok: true, data: job };
    }

    case MSG.RESEARCH_GET: {
      const id = msg.payload?.id;
      if (!id) return { ok: false, error: "Missing job id." };
      const settings = await getSettings();
      return { ok: true, data: await getResearchJob(resolveCloudConfig(settings), id) };
    }

    case MSG.RESEARCH_CANCEL: {
      const id = msg.payload?.id;
      if (!id) return { ok: false, error: "Missing job id." };
      const settings = await getSettings();
      return { ok: true, data: await cancelResearchJob(resolveCloudConfig(settings), id) };
    }

    case MSG.RESEARCH_LIST: {
      const settings = await getSettings();
      return { ok: true, data: await listResearchJobs(resolveCloudConfig(settings)) };
    }

    case MSG.SET_DEFAULT_LENS: {
      const id = msg.payload?.id;
      if (!id) return { ok: false, error: "Missing lens id." };
      const hostname = String(msg.payload?.hostname || "").trim();
      const settings = await getSettings();

      // The pick is remembered where the default came from: on a site that has
      // its own rule, update that rule rather than silently changing the global
      // default the user set for everywhere else (#19).
      if (hostname && hasDomainRule(hostname, settings.domainLenses || [])) {
        await saveSettings({
          domainLenses: setDomainLens(settings.domainLenses || [], hostname, id),
        });
        return { ok: true, data: { scope: "domain", hostname } };
      }

      await saveSettings({ defaultLensId: id });
      return { ok: true, data: { scope: "global" } };
    }

    case MSG.OPEN_OPTIONS: {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    }

    case MSG.MEMORY_LIST: {
      const settings = await getSettings();
      const provider = getMemoryProvider(settings.memoryProvider);
      const items = await provider.list();
      return { ok: true, data: items };
    }

    case MSG.MEMORY_ADD: {
      const settings = await getSettings();
      if (settings.memoryProvider === "none") {
        return { ok: false, error: "Memory is disabled in settings." };
      }
      const provider = getMemoryProvider(settings.memoryProvider);
      const item = await provider.add({
        type: msg.payload?.type || "note",
        text: msg.payload?.text || "",
        source: msg.payload?.source || "explicit",
      });
      return { ok: true, data: item };
    }

    case MSG.MEMORY_UPDATE: {
      const settings = await getSettings();
      const provider = getMemoryProvider(settings.memoryProvider);
      const item = await provider.update(msg.payload?.id, {
        type: msg.payload?.type,
        text: msg.payload?.text,
      });
      return item ? { ok: true, data: item } : { ok: false, error: "Not found." };
    }

    case MSG.MEMORY_REMOVE: {
      const settings = await getSettings();
      const provider = getMemoryProvider(settings.memoryProvider);
      const ok = await provider.remove(msg.payload?.id);
      return ok ? { ok: true } : { ok: false, error: "Not found." };
    }

    case MSG.MEMORY_CLEAR: {
      const settings = await getSettings();
      const provider = getMemoryProvider(settings.memoryProvider);
      await provider.clear();
      return { ok: true };
    }

    // --- Conversation import (#49) -------------------------------------
    // These three are deliberately stateless. The import page owns the job:
    // it holds the parsed conversations in page memory, decides what to send
    // next, and persists progress itself. The worker sees one batch at a time,
    // so it can be torn down between requests without losing anything.

    case MSG.IMPORT_STATUS: {
      const settings = await getSettings();
      const status = importRuntimeStatus(settings);
      return {
        ok: true,
        ready: status.ready,
        reason: status.reason || "",
        model: settings.model,
        apiBaseUrl: settings.apiBaseUrl,
        memoryProvider: settings.memoryProvider,
      };
    }

    case MSG.IMPORT_DISTILL: {
      const settings = await getSettings();
      const status = importRuntimeStatus(settings);
      if (!status.ready) return { ok: false, error: "No model configured.", reason: status.reason };

      const batch = msg.payload?.batch;
      if (!batch?.text) return { ok: false, error: "Empty batch." };

      let raw;
      try {
        raw = await complete(buildDistillPrompt(batch), settings);
      } catch (err) {
        // Classified here rather than left to the top-level catch, so the page
        // learns whether to back off or stop.
        return classifyImportFailure(err);
      }

      const candidates = parseDistillResponse(raw, batch);
      // A response we cannot read is the caller's cue to retry this batch;
      // it must not look like a batch that legitimately found nothing.
      if (!candidates) return { ok: false, error: "Unreadable model response.", retryable: true };
      return { ok: true, candidates };
    }

    case MSG.IMPORT_PROFILE: {
      const settings = await getSettings();
      const status = importRuntimeStatus(settings);
      if (!status.ready) return { ok: false, error: "No model configured.", reason: status.reason };

      const batch = msg.payload?.batch;
      if (!batch?.text) return { ok: false, error: "Empty batch." };

      let raw;
      try {
        // A memory store is dense — every line is a fact worth keeping — so it
        // needs more output room per input character than a chat batch does.
        raw = await complete(buildProfilePrompt(batch), { ...settings, maxTokens: 2500 });
      } catch (err) {
        return classifyImportFailure(err);
      }

      const candidates = parseProfileResponse(raw, batch);
      if (!candidates) return { ok: false, error: "Unreadable model response.", retryable: true };
      return { ok: true, candidates };
    }

    case MSG.IMPORT_MERGE: {
      const settings = await getSettings();
      const status = importRuntimeStatus(settings);
      if (!status.ready) return { ok: false, error: "No model configured.", reason: status.reason };

      const candidates = msg.payload?.candidates || [];
      const existing = msg.payload?.existing || [];
      if (!candidates.length) return { ok: true, merged: [] };

      // The reduce returns the whole consolidated list in one reply, so it
      // needs far more output room than a single distill batch.
      let raw;
      try {
        raw = await complete(buildMergePrompt(candidates, existing), {
          ...settings,
          maxTokens: 4000,
        });
      } catch (err) {
        return classifyImportFailure(err);
      }

      const merged = parseMergeResponse(raw, candidates, existing);
      if (!merged) return { ok: false, error: "Unreadable model response.", retryable: true };
      return { ok: true, merged };
    }

    case MSG.IMPORT_COMMIT: {
      const settings = await getSettings();
      if (settings.memoryProvider === "none") {
        return { ok: false, error: "Memory is disabled." };
      }
      const provider = getMemoryProvider(settings.memoryProvider);
      const accepted = msg.payload?.memories || [];
      if (!accepted.length) return { ok: true, saved: 0 };

      const stored = await provider.addMany(
        accepted.map((memory) => ({
          type: memory.type,
          text: memory.text,
          source: "inferred",
          confidence: memory.confidence,
        }))
      );
      return { ok: true, saved: stored.length };
    }

    case MSG.RESET_ALL: {
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
      // Through saveSettings so secrets are routed to local storage rather than
      // being written straight back into the synced store.
      await saveSettings(DEFAULT_SETTINGS);
      return { ok: true };
    }

    case MSG.EXPORT_SETTINGS: {
      const settings = await getSettings();
      // Strip every secret, not a hand-listed subset — webSearchApiKey used to
      // ride along in the exported file.
      const safe = { ...settings };
      for (const k of SECRET_KEYS) delete safe[k];
      return {
        ok: true,
        data: {
          ...safe,
          // Export flags whether secrets existed, not the secrets themselves.
          hasApiKey: Boolean(settings.apiKey),
          hasWebSearchKey: Boolean(settings.webSearchApiKey),
          hasCloudToken: Boolean(settings.cloudAccessToken),
          exportedAt: new Date().toISOString(),
          version: 1,
        },
      };
    }

    case MSG.IMPORT_SETTINGS: {
      const incoming = msg.payload;
      if (!incoming || typeof incoming !== "object") {
        return { ok: false, error: "Invalid settings payload." };
      }
      /** @type {Record<string, unknown>} */
      const patch = {};
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (key === "apiKey" || key === "cloudAccessToken") {
          continue;
        }
        if (key in incoming) patch[key] = incoming[key];
      }
      await saveSettings(patch);
      return { ok: true };
    }

    case MSG.CHAT: {
      const payload = msg.payload || {};
      const result = await chat({
        selection: payload.selection || "",
        page: payload.page,
        lens: payload.lens,
        messages: sanitizeThreadAttachments(payload.messages || []),
      });
      return { ok: true, data: result };
    }

    case MSG.CHAT_LOAD: {
      const url = msg.payload?.url || "";
      const selection = msg.payload?.selection || "";
      // Thread for this selection + every thread on the page, so the panel can
      // offer the other conversations without loading their full messages.
      const [thread, threads] = await Promise.all([
        loadThread(url, selection),
        listThreads(url),
      ]);
      return { ok: true, data: { thread, threads } };
    }

    case MSG.CHAT_SAVE: {
      const url = msg.payload?.url || "";
      const session = msg.payload?.session || {};
      const store = await saveThread(url, session);
      return { ok: true, data: { threadCount: store.threads.length } };
    }

    case MSG.CHAT_THREAD_LOAD: {
      const url = msg.payload?.url || "";
      const selection = msg.payload?.selection || "";
      const thread = await loadThread(url, selection);
      return { ok: true, data: thread };
    }

    case MSG.CHAT_THREAD_CLEAR: {
      const url = msg.payload?.url || "";
      await clearThread(url, msg.payload?.selection || "");
      return { ok: true };
    }

    case MSG.HISTORY_LOAD: {
      const url = msg.payload?.url || "";
      const items = await loadPageHistory(url);
      return { ok: true, data: items };
    }

    case MSG.HISTORY_APPEND: {
      const url = msg.payload?.url || "";
      const items = await appendPageHistory(url, msg.payload?.entry || {});
      return { ok: true, data: items };
    }

    case MSG.HISTORY_CLEAR: {
      const url = msg.payload?.url || "";
      await clearPageHistory(url);
      return { ok: true };
    }

    case MSG.ACCOUNT_STATUS: {
      const mode = await getAccountMode();
      const auth = await getAuthProvider();
      const session = await auth.getSession();
      const settings = await getSettings();
      return {
        ok: true,
        data: {
          accountMode: mode,
          session: session
            ? {
                userId: session.userId,
                email: session.email,
                displayName: session.displayName,
                provider: session.provider,
              }
            : null,
          syncPreferences: settings.syncPreferences !== false,
          syncChatHistory: Boolean(settings.syncChatHistory),
          syncSecrets: Boolean(settings.syncSecrets),
          lastSyncedAt: settings.lastSyncedAt || "",
          // #51: a configured cloud endpoint (hosted or self-hosted) makes
          // sign-in real rather than a stub.
          cloudReady: Boolean(settings.cloudBaseUrl?.trim()),
          account: await cloudAccountSummary(settings, session),
        },
      };
    }

    case MSG.ACCOUNT_SET_MODE: {
      const mode = msg.payload?.mode === "cloud" ? "cloud" : "local";
      await setAccountMode(mode);
      if (mode === "local") {
        const auth = await getAuthProvider();
        await auth.signOut().catch(() => {});
      }
      return { ok: true, data: { accountMode: mode } };
    }

    case MSG.ACCOUNT_SIGN_IN: {
      const auth = await getAuthProvider();
      const session = await auth.signIn();

      // First sign-in carries existing local memories up, but never overwrites a
      // newer cloud copy (#51). Failing to migrate must not fail the sign-in.
      let migration = null;
      const settings = await getSettings();
      if (settings.syncPreferences !== false && settings.cloudBaseUrl?.trim()) {
        try {
          const sync = await getSyncProvider();
          if (typeof sync.migrateLocalToCloud === "function") {
            const provider = getMemoryProvider(settings.memoryProvider || "local");
            const memories = await provider.list();
            const result = await sync.migrateLocalToCloud(
              buildUserDataSnapshot(settings, memories)
            );
            migration = result.action;
            if (result.action === "uploaded") {
              await saveSettings({ lastSyncedAt: new Date().toISOString() });
            }
          }
        } catch {
          migration = "failed";
        }
      }

      return {
        ok: true,
        data: {
          userId: session.userId,
          email: session.email,
          displayName: session.displayName,
          provider: session.provider,
          migration,
        },
      };
    }

    case MSG.ACCOUNT_SIGN_OUT: {
      const auth = await getAuthProvider();
      await auth.signOut();
      return { ok: true };
    }

    case MSG.ACCOUNT_SYNC_NOW: {
      const mode = await getAccountMode();
      if (mode !== "cloud") {
        return { ok: false, error: "Switch to signed-in mode to sync." };
      }
      const settings = await getSettings();
      const provider = getMemoryProvider(settings.memoryProvider || "local");
      const memories = await provider.list();
      const snapshot = buildUserDataSnapshot(settings, memories);
      const sync = await getSyncProvider();
      // Pull-merge-push when remote exists
      const remote = await sync.pull();
      const merged = remote ? sync.merge(snapshot, remote) : snapshot;
      await sync.push(merged);
      await saveSettings({ lastSyncedAt: new Date().toISOString() });
      return { ok: true, data: { lastSyncedAt: new Date().toISOString() } };
    }

    case MSG.RUNTIME_STATUS: {
      const settings = await getSettings();
      const ready = isRuntimeReady(settings);
      return {
        ok: true,
        data: {
          runtime: settings.runtime,
          ready: ready.ok,
          reason: ready.reason,
          hasApiKey: Boolean(settings.apiKey),
          promptaasSubscribeUrl: settings.promptaasSubscribeUrl || "",
          serviceMode: resolveServiceMode(settings),
          hasCloudToken: Boolean(settings.cloudAccessToken),
          cloudSignUpUrl: settings.cloudSignUpUrl || "",
          lastRuntimeTestAt: settings.lastRuntimeTestAt || "",
          lastRuntimeTestOk: Boolean(settings.lastRuntimeTestOk),
        },
      };
    }

    case MSG.TEST_RUNTIME: {
      const settings = await getSettings();
      // mode may be product access id (byok/promptaas) or runtime id — either
      // way the registry owns the mapping and the form overlay.
      const which = String(msg.payload?.mode || settings.runtime || "mock");
      const result = await testRuntimeConnection(which, settings, msg.payload || {});
      if (result.runtime !== "mock") {
        await saveSettings({
          lastRuntimeTestAt: new Date().toISOString(),
          lastRuntimeTestOk: Boolean(result.ok),
        });
      }
      return { ok: result.ok, data: result, error: result.ok ? undefined : result.message };
    }

    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}

/**
 * Plan + credits for the account card, when a cloud session exists (#51).
 * Never fails the status call — the card degrades to "signed in" only.
 * @param {Awaited<ReturnType<typeof getSettings>>} settings
 * @param {import('../lib/auth/types.js').Session | null} session
 */
async function cloudAccountSummary(settings, session) {
  if (!session?.accessToken || !settings.cloudBaseUrl?.trim()) return null;
  try {
    const account = await fetchCloudAccount({
      baseUrl: settings.cloudBaseUrl,
      accessToken: session.accessToken,
    });
    return {
      plan: account.plan || "",
      planLabel: account.planLabel || "",
      quota: account.quota || null,
    };
  } catch {
    return null;
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});
