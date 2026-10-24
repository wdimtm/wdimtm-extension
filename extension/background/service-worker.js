/**
 * Background service worker — privileged APIs, runtime, memory.
 */

import { MSG, createMessageRouter } from "../../core/messages.js";
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
  clearRejectedCloudSession,
  forgetCloudSession,
  getAccountMode,
  getAuthProvider,
  getSyncProvider,
  setAccountMode,
} from "../lib/auth/index.js";
import {
  appendPageHistory,
  clearThread,
  listThreads,
  loadPageHistory,
  loadThread,
  saveThread,
} from "../lib/chat.js";
import { sanitizeThreadAttachments } from "../../core/images.js";
import {
  deleteCloudAccount,
  exportCloudAccount,
  fetchCloudAccount,
  onCloudSessionRejected,
  resolveCloudConfig,
} from "../../core/cloud.js";
import {
  cancelResearchJob,
  createResearchJobFromExplain,
  getResearchJob,
  listResearchJobs,
} from "../../core/research-client.js";
import { buildDistillPrompt, parseDistillResponse } from "../../core/memory-import/distill.js";
import { buildMergePrompt, parseMergeResponse } from "../../core/memory-import/merge.js";
import { buildProfilePrompt, parseProfileResponse } from "../../core/memory-import/profile.js";
import { classifyImportFailure } from "../../core/memory-import/runner.js";
import { classifyRuntimeError } from "../../core/runtime-errors.js";
import { creditNudge } from "../../core/funnel.js";
import { resolveServiceMode } from "../../core/service-mode.js";
import { testRuntimeConnection } from "../../core/runtime-test.js";
import { chat, explain } from "../../core/runtime/adapter.js";
import { complete, importRuntimeStatus } from "../../core/runtime/completion.js";

// An expired or revoked Cloud session is forgotten on the first 401 (#139),
// so Settings asks for sign-in instead of showing a dead "Signed in as …".
onCloudSessionRejected(clearRejectedCloudSession);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch(async (err) => {
      // Same classification as the streaming path — the non-streaming explain
      // and every options action land here, and a raw string helps nobody (#18).
      const classified = await classifyForCurrentMode(err);
      sendResponse({ ok: false, ...errorPayload(classified) });
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
 * runExplain and runChat are the only way the worker runs either. The streaming
 * port and the one-shot message used to call the adapter separately, and the
 * one-shot chat forgot the runtime deps (#164); both paths now come through here.
 *
 * @param {any} request
 * @param {{ signal?: AbortSignal, onChunk?: (text: string) => void }} [stream]
 */
async function runExplain(request, stream = {}) {
  return withCreditNudge(await explain(request, { ...(await runtimeDeps()), ...stream }));
}

/**
 * @param {any} payload
 * @param {{ signal?: AbortSignal, onChunk?: (text: string) => void }} [stream]
 */
async function runChat(payload, stream = {}) {
  return chat(
    {
      selection: payload.selection || "",
      page: payload.page,
      lens: payload.lens,
      messages: sanitizeThreadAttachments(payload.messages || []),
    },
    { ...(await runtimeDeps()), ...stream }
  );
}

/** @param {any} request @returns {string | null} */
function explainProblem(request) {
  return request?.selection ? null : "Missing selection.";
}

/** @param {any} payload @returns {string | null} */
function chatProblem(payload) {
  if (!payload?.page?.url) return "Chat requires page.url.";
  if (!payload.messages?.length) return "Chat requires messages.";
  return null;
}

/**
 * The Cloud account endpoints act for the signed-in user, so they need the
 * session's token rather than whatever the runtime settings hold.
 */
async function signedInCloudConfig() {
  const settings = await getSettings();
  const session = await (await getAuthProvider()).getSession();
  if (!session?.accessToken || !settings.cloudBaseUrl?.trim()) return null;
  return { baseUrl: settings.cloudBaseUrl, accessToken: session.accessToken };
}

/** Local first-run funnel state (#40). Never leaves the browser. */
const FUNNEL_KEY = "wdimtm.funnel";

/**
 * Attach the top-up line, if any, to a hosted answer (#40). The first hosted
 * answer is remembered so its "credits are there when you need more" line
 * shows once. A storage failure costs the line, never the answer.
 * @template {{ runtime?: string, meta?: any }} R
 * @param {R} response
 * @returns {Promise<R>}
 */
async function withCreditNudge(response) {
  if (response?.runtime !== "wdimtm-cloud") return response;
  try {
    const { [FUNNEL_KEY]: funnel } = await chrome.storage.local.get({ [FUNNEL_KEY]: {} });
    const firstHostedAnswer = !funnel?.firstHostedAnswerAt;
    if (firstHostedAnswer) {
      await chrome.storage.local.set({
        [FUNNEL_KEY]: { ...funnel, firstHostedAnswerAt: new Date().toISOString() },
      });
    }
    const nudge = creditNudge({
      runtime: response.runtime,
      entitlement: response.meta?.entitlement,
      firstHostedAnswer,
    });
    return nudge ? { ...response, nudge } : response;
  } catch {
    return response;
  }
}

/**
 * What a classified error carries to a page: the words, the code that picks
 * its buttons, and for a 402 why it was refused and where to pay (#75).
 * @param {import('../../core/runtime-errors.js').ClassifiedRuntimeError} classified
 */
function errorPayload(classified) {
  return {
    error: classified.message,
    code: classified.code,
    ...(classified.reason ? { reason: classified.reason } : {}),
    ...(classified.checkoutUrl ? { checkoutUrl: classified.checkoutUrl } : {}),
  };
}

/**
 * @param {unknown} err
 * @returns {Promise<import('../../core/runtime-errors.js').ClassifiedRuntimeError>}
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
        validate: () => explainProblem(request),
        run: ({ onChunk }) => runExplain(request, { signal: canceler.signal, onChunk }),
        textOf: (response) => response.explanation,
        onError: (err) => postRuntimeError(port, err, canceler.signal),
      });
    });
    return;
  }

  if (port.name === "wdimtm-chat") {
    port.onMessage.addListener(async (msg) => {
      if (msg?.type !== MSG.CHAT) return;
      const payload = msg.payload;
      await servePortStream(port, {
        validate: () => chatProblem(payload),
        run: ({ onChunk }) => runChat(payload, { signal: canceler.signal, onChunk }),
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
  safePortPost(port, { type: "error", ...errorPayload(classified) });
}

/**
 * Every one-shot message the extension's pages send, keyed by its `MSG` type.
 * The router answers unknown types itself, so a handler only ever sees its own
 * payload.
 *
 * @type {Record<string, (payload: any) => Promise<any>>}
 */
const handlers = {
  [MSG.EXPLAIN]: async (payload) => {
    const invalid = explainProblem(payload);
    if (invalid) return { ok: false, error: invalid };
    return { ok: true, data: await runExplain(payload) };
  },

  [MSG.GET_SETTINGS]: async () => {
    const settings = await getSettings();
    return { ok: true, data: publicSettings(settings) };
  },

  [MSG.RESEARCH_START]: async (payload) => {
    const moment = payload;
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
  },

  [MSG.RESEARCH_GET]: async (payload) => {
    const id = payload?.id;
    if (!id) return { ok: false, error: "Missing job id." };
    const settings = await getSettings();
    return { ok: true, data: await getResearchJob(resolveCloudConfig(settings), id) };
  },

  [MSG.RESEARCH_CANCEL]: async (payload) => {
    const id = payload?.id;
    if (!id) return { ok: false, error: "Missing job id." };
    const settings = await getSettings();
    return { ok: true, data: await cancelResearchJob(resolveCloudConfig(settings), id) };
  },

  [MSG.RESEARCH_LIST]: async () => {
    const settings = await getSettings();
    return { ok: true, data: await listResearchJobs(resolveCloudConfig(settings)) };
  },

  [MSG.SET_DEFAULT_LENS]: async (payload) => {
    const id = payload?.id;
    if (!id) return { ok: false, error: "Missing lens id." };
    const hostname = String(payload?.hostname || "").trim();
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
  },

  [MSG.OPEN_OPTIONS]: async (payload) => {
    // "Buy credits" lands on the Cloud packages, not the top of Settings (#75).
    if (payload?.section === "cloud") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html#cloud") });
      return { ok: true };
    }
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },

  [MSG.MEMORY_LIST]: async () => {
    const settings = await getSettings();
    const provider = getMemoryProvider(settings.memoryProvider);
    const items = await provider.list();
    return { ok: true, data: items };
  },

  [MSG.MEMORY_ADD]: async (payload) => {
    const settings = await getSettings();
    if (settings.memoryProvider === "none") {
      return { ok: false, error: "Memory is disabled in settings." };
    }
    const provider = getMemoryProvider(settings.memoryProvider);
    const item = await provider.add({
      type: payload?.type || "note",
      text: payload?.text || "",
      source: payload?.source || "explicit",
    });
    return { ok: true, data: item };
  },

      // --- Conversation import (#49) -------------------------------------
      // These three are deliberately stateless. The import page owns the job:
      // it holds the parsed conversations in page memory, decides what to send
      // next, and persists progress itself. The worker sees one batch at a time,
      // so it can be torn down between requests without losing anything.

  [MSG.IMPORT_STATUS]: async () => {
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
  },

  [MSG.IMPORT_DISTILL]: async (payload) => {
    const settings = await getSettings();
    const status = importRuntimeStatus(settings);
    if (!status.ready) return { ok: false, error: "No model configured.", reason: status.reason };

    const batch = payload?.batch;
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
  },

  [MSG.IMPORT_PROFILE]: async (payload) => {
    const settings = await getSettings();
    const status = importRuntimeStatus(settings);
    if (!status.ready) return { ok: false, error: "No model configured.", reason: status.reason };

    const batch = payload?.batch;
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
  },

  [MSG.IMPORT_MERGE]: async (payload) => {
    const settings = await getSettings();
    const status = importRuntimeStatus(settings);
    if (!status.ready) return { ok: false, error: "No model configured.", reason: status.reason };

    const candidates = payload?.candidates || [];
    const existing = payload?.existing || [];
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
  },

  [MSG.IMPORT_COMMIT]: async (payload) => {
    const settings = await getSettings();
    if (settings.memoryProvider === "none") {
      return { ok: false, error: "Memory is disabled." };
    }
    const provider = getMemoryProvider(settings.memoryProvider);
    const accepted = payload?.memories || [];
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
  },

  [MSG.RESET_ALL]: async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    // Through saveSettings so secrets are routed to local storage rather than
    // being written straight back into the synced store.
    await saveSettings(DEFAULT_SETTINGS);
    return { ok: true };
  },

  [MSG.EXPORT_SETTINGS]: async () => {
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
  },

  [MSG.IMPORT_SETTINGS]: async (payload) => {
    const incoming = payload;
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
  },

  [MSG.CHAT]: async (payload) => {
    const invalid = chatProblem(payload);
    if (invalid) return { ok: false, error: invalid };
    return { ok: true, data: await runChat(payload) };
  },

  [MSG.CHAT_LOAD]: async (payload) => {
    const url = payload?.url || "";
    const selection = payload?.selection || "";
    // Thread for this selection + every thread on the page, so the panel can
    // offer the other conversations without loading their full messages.
    const [thread, threads] = await Promise.all([
      loadThread(url, selection),
      listThreads(url),
    ]);
    return { ok: true, data: { thread, threads } };
  },

  [MSG.CHAT_SAVE]: async (payload) => {
    const url = payload?.url || "";
    const session = payload?.session || {};
    const store = await saveThread(url, session);
    return { ok: true, data: { threadCount: store.threads.length } };
  },

  [MSG.CHAT_THREAD_LOAD]: async (payload) => {
    const url = payload?.url || "";
    const selection = payload?.selection || "";
    const thread = await loadThread(url, selection);
    return { ok: true, data: thread };
  },

  [MSG.CHAT_THREAD_CLEAR]: async (payload) => {
    const url = payload?.url || "";
    await clearThread(url, payload?.selection || "");
    return { ok: true };
  },

  [MSG.HISTORY_LOAD]: async (payload) => {
    const url = payload?.url || "";
    const items = await loadPageHistory(url);
    return { ok: true, data: items };
  },

  [MSG.HISTORY_APPEND]: async (payload) => {
    const url = payload?.url || "";
    const items = await appendPageHistory(url, payload?.entry || {});
    return { ok: true, data: items };
  },

  [MSG.ACCOUNT_STATUS]: async () => {
    const mode = await getAccountMode();
    const auth = await getAuthProvider();
    const stored = await auth.getSession();
    const settings = await getSettings();
    const account = await cloudAccountSummary(settings, stored);
    // A 401 from that call has just cleared an expired session (#139), so
    // report what is stored now rather than what was read before it.
    const session = stored && !account ? await auth.getSession() : stored;
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
        account,
      },
    };
  },

  [MSG.ACCOUNT_SET_MODE]: async (payload) => {
    const mode = payload?.mode === "cloud" ? "cloud" : "local";
    await setAccountMode(mode);
    if (mode === "local") {
      const auth = await getAuthProvider();
      await auth.signOut().catch(() => {});
    }
    return { ok: true, data: { accountMode: mode } };
  },

  [MSG.ACCOUNT_SIGN_IN]: async () => {
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
  },

  [MSG.ACCOUNT_SIGN_OUT]: async () => {
    const auth = await getAuthProvider();
    await auth.signOut();
    return { ok: true };
  },

  [MSG.ACCOUNT_EXPORT]: async () => {
    const config = await signedInCloudConfig();
    if (!config) return { ok: false, error: "Sign in to WDIMTM Cloud first." };
    return { ok: true, data: await exportCloudAccount(config) };
  },

  [MSG.ACCOUNT_DELETE]: async () => {
    const config = await signedInCloudConfig();
    if (!config) return { ok: false, error: "Sign in to WDIMTM Cloud first." };
    await deleteCloudAccount(config);
    // Local data stays: deleting the Cloud account is not a device reset.
    await forgetCloudSession();
    await setAccountMode("local");
    return { ok: true };
  },

  [MSG.ACCOUNT_SYNC_NOW]: async () => {
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
  },

  [MSG.TEST_RUNTIME]: async (payload) => {
    const settings = await getSettings();
    // mode may be a product access id (byok/cloud) or a runtime id — either
    // way the registry owns the mapping and the form overlay.
    const which = String(payload?.mode || settings.runtime || "mock");
    const result = await testRuntimeConnection(which, settings, payload || {});
    if (result.runtime !== "mock") {
      await saveSettings({
        lastRuntimeTestAt: new Date().toISOString(),
        lastRuntimeTestOk: Boolean(result.ok),
      });
    }
    return { ok: result.ok, data: result, error: result.ok ? undefined : result.message };
  },
};

const handleMessage = createMessageRouter(handlers);

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
