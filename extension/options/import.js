/**
 * Import wizard (#49).
 *
 * This page is the job driver. It holds the parsed conversations in page memory
 * — never on disk — and feeds one batch at a time to the service worker, which
 * stays stateless. That is what keeps MV3's worker lifetime from mattering:
 * the worker only has to survive a single request, not the whole import.
 *
 * Only distilled candidates and a cursor are persisted, so closing this page
 * costs a file re-selection, never the tokens already spent.
 */

import { MSG } from "../../core/messages.js";
import {
  buildDistillBatches,
  estimateBatchTokens,
  estimateTokens,
  fingerprintConversations,
} from "../../core/memory-import/distill.js";
import { dedupeLexical, rankForReview, splitForReduce } from "../../core/memory-import/merge.js";
import { buildProfileBatches } from "../../core/memory-import/profile.js";
import { prefilter } from "../../core/memory-import/prefilter.js";
import { collectJsonEntries, filesFromDrop } from "../../core/memory-import/collect.js";
import { classifyImportFailure, runDistillation } from "../../core/memory-import/runner.js";
import { parseExport } from "../../core/memory-sources/index.js";
import { MEMORY_LIMIT } from "../lib/memory.js";
import { applyOptionsI18n, ot } from "../lib/options-i18n.js";
import { applyPageTheme, watchSystemTheme } from "../lib/page-theme.js";

const JOB_KEY = "wdimtm.import.job";

/** Candidates below this share of the top support score are folded away. */
const TAIL_SUPPORT_RATIO = 0.34;

/** @type {'en' | 'zh_CN'} */
let uiLocale = "en";

/** @param {string} key @param {Record<string, string | number>} [vars] */
function t(key, vars) {
  const text = ot(key, uiLocale);
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

const state = {
  /** @type {import('../lib/memory-sources/types.js').Conversation[]} */
  kept: [],
  /** @type {import('../lib/memory-import/distill.js').DistillBatch[]} */
  batches: [],
  fingerprint: "",
  skipped: 0,
  dropped: 0,
  startIndex: 0,
  /** @type {import('../lib/memory-sources/types.js').MemoryCandidate[]} */
  resumedCandidates: [],
  /** @type {import('../lib/memory-sources/types.js').MergedMemory[]} */
  reviewed: [],
  /** @type {Set<number>} */
  selected: new Set(),
  tailExpanded: false,
  tailStart: Number.MAX_SAFE_INTEGER,
  stopRequested: false,
  /** @type {any} */
  runtime: null,
  /** @type {import('../lib/memory-import/profile.js').ProfileBatch[]} */
  profileBatches: [],
  profileBlockCount: 0,
  /** @type {import('../lib/memory-sources/types.js').MemoryCandidate[]} */
  profileCandidates: [],
  /** @type {string[]} */
  rejectedFiles: [],
  ignoredNonJson: 0,
  /** @type {any} */
  savedJob: null,
};

const el = (id) => document.getElementById(id);

const steps = {
  choose: el("step-choose"),
  disclose: el("step-disclose"),
  running: el("step-running"),
  review: el("step-review"),
  done: el("step-done"),
};

/** @param {keyof typeof steps} name */
function showStep(name) {
  for (const [key, node] of Object.entries(steps)) node.hidden = key !== name;
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Focus follows the wizard. Without this the activated control disappears
  // with its step and focus falls back to <body>, stranding a keyboard user at
  // the top of the document on every one of the five transitions — and leaving
  // a screen reader with no announcement that anything changed. Moving to the
  // step's heading both restores a sensible tab position and reads the new
  // step's title aloud.
  const heading = steps[name].querySelector("h2");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

/** @param {string} message @param {boolean} [isError] */
function flash(message, isError = false) {
  const status = el("status");
  status.textContent = message;
  status.classList.toggle("warn", isError);
}

/** @param {string} type */
function typeLabel(type) {
  const keys = {
    profile: "memProfile",
    interest: "memInterest",
    goal: "memGoal",
    knowledge: "memKnowledge",
    preference: "memPreference",
    note: "memNote",
  };
  return t(keys[type] || "memNote");
}

/**
 * Every message goes through here so a broken round trip looks like an ordinary
 * failure result rather than an unhandled rejection. Without this a worker that
 * is gone — an extension reload, say — leaves the wizard silently dead.
 *
 * @param {string} type
 * @param {unknown} [payload]
 */
async function send(type, payload) {
  try {
    const res = await chrome.runtime.sendMessage({ type, payload });
    if (res === undefined) {
      return classifyImportFailure(new Error("No response from the extension background."));
    }
    return res;
  } catch (err) {
    return classifyImportFailure(err);
  }
}

// ── Persistence ───────────────────────────────────────
// Only candidates and a cursor. The conversations themselves stay in memory.

async function loadJob() {
  const data = await chrome.storage.local.get({ [JOB_KEY]: null });
  return data[JOB_KEY];
}

/**
 * @param {import('../lib/memory-sources/types.js').MemoryCandidate[]} candidates
 * @param {number} completed
 */
async function saveJob(candidates, completed) {
  await chrome.storage.local.set({
    [JOB_KEY]: {
      fingerprint: state.fingerprint,
      total: state.batches.length,
      cursor: completed,
      candidates,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function clearJob() {
  await chrome.storage.local.remove(JOB_KEY);
  state.savedJob = null;
}

// ── ① Choose ──────────────────────────────────────────

el("choose-file").addEventListener("click", () => el("file-input").click());

el("resume-discard").addEventListener("click", async () => {
  await clearJob();
  el("resume-box").hidden = true;
  flash(t("importDiscarded"));
});

el("choose-folder").addEventListener("click", () => el("folder-input").click());

for (const id of ["file-input", "folder-input"]) {
  el(id).addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    await ingest(files);
  });
}

const dropZone = el("drop-zone");
for (const type of ["dragenter", "dragover"]) {
  dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}
for (const type of ["dragleave", "drop"]) {
  dropZone.addEventListener(type, () => dropZone.classList.remove("dragging"));
}
dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  await ingest(await filesFromDrop(event.dataTransfer));
});

/**
 * Every input path lands here: a .zip, a folder, picked files, or a drop.
 *
 * @param {File[]} files
 */
async function ingest(files) {
  if (!files.length) return;
  flash(t("importReading"));

  // One seam for all four: archives are read entry by entry, folders are
  // filtered by name before anything is read, and what comes out is a plain
  // list of JSON documents that still get classified by content, not by name.
  const { entries, skipped: nonJson, failed } = await collectJsonEntries(files);

  /** @type {import('../lib/memory-sources/types.js').Conversation[]} */
  const conversations = [];
  /** @type {import('../lib/memory-sources/claude-memory.js').ProfileBlock[]} */
  const profileBlocks = [];
  let skipped = 0;
  /** @type {string[]} */
  const rejected = [...failed];
  /** @type {string} */
  let lastCode = "unknown_format";

  for (const entry of entries) {
    const outcome = parseExport(entry.text);
    if (!outcome.ok) {
      rejected.push(entry.name);
      lastCode = outcome.code;
      continue;
    }
    // The user picks files, never a vendor: each one is routed by what it
    // turns out to be.
    if (outcome.kind === "profile") profileBlocks.push(...outcome.blocks);
    else conversations.push(...outcome.conversations);
    skipped += outcome.skipped;
  }

  // Nothing usable is an error; some unusable is a warning, because an export
  // folder is mostly files that are not conversation history.
  if (!conversations.length && !profileBlocks.length) {
    const messages = {
      invalid_json: "importErrInvalidJson",
      unknown_format: "importErrUnknownFormat",
      empty: "importErrEmpty",
    };
    flash(t(entries.length ? messages[lastCode] || "importErrUnknownFormat" : "importErrNoJson"), true);
    return;
  }

  state.ignoredNonJson = nonJson.length;
  state.rejectedFiles = rejected;
  state.profileBlocks = profileBlocks;
  state.profileBlockCount = profileBlocks.length;
  state.profileBatches = buildProfileBatches(profileBlocks);
  state.profileCandidates = [];

  const { kept, dropped } = prefilter(conversations);
  state.kept = kept;
  state.dropped = dropped;
  state.skipped = skipped;
  state.batches = buildDistillBatches(kept);
  state.fingerprint = fingerprintConversations(kept);
  state.startIndex = 0;
  state.resumedCandidates = [];

  // Resuming only makes sense against the same file: batching is deterministic,
  // so an identical fingerprint means an identical cursor.
  const saved = state.savedJob;
  if (saved?.fingerprint) {
    if (saved.fingerprint === state.fingerprint) {
      state.startIndex = Math.min(saved.cursor || 0, state.batches.length);
      state.resumedCandidates = saved.candidates || [];
      flash(t("importResumeReady", { done: state.startIndex }));
    } else {
      // Warn, but keep the saved job. A misclick on the wrong file should not
      // destroy resumable progress; starting a real import overwrites it on
      // the first checkpoint anyway.
      flash(t("importResumeMismatch"), true);
    }
  } else {
    flash("");
  }

  await renderDisclosure();
}

// ── ② Disclosure ──────────────────────────────────────

async function renderDisclosure() {
  const runtime = await send(MSG.IMPORT_STATUS);
  state.runtime = runtime;

  showStep("disclose");

  // A failed round trip is not the same as a runtime that is merely
  // unconfigured, and must not be reported as one.
  if (!runtime?.ok) {
    el("disclose-ready").hidden = true;
    el("disclose-blocked").hidden = false;
    el("blocked-reason").textContent = runtime?.error || t("importErrUnknownFormat");
    return;
  }

  if (runtime?.memoryProvider === "none") {
    el("disclose-ready").hidden = true;
    el("disclose-blocked").hidden = false;
    el("blocked-reason").textContent = t("importErrMemoryOff");
    el("open-settings").href = "options.html#memory-card";
    return;
  }

  if (!runtime?.ready) {
    el("disclose-ready").hidden = true;
    el("disclose-blocked").hidden = false;
    const reasons = {
      mock: "importNeedsModelMock",
      promptaas: "importNeedsModelPromptaas",
      missing_key: "importNeedsModelKey",
    };
    el("blocked-reason").textContent = t(reasons[runtime?.reason] || "importNeedsModelMock");
    el("open-settings").href = "options.html#sec-ai-access";
    return;
  }

  el("disclose-blocked").hidden = true;
  el("disclose-ready").hidden = false;

  const remaining = state.batches.slice(state.startIndex);
  const profileTokens = state.profileBatches.reduce((sum, b) => sum + estimateTokens(b.text), 0);
  const tokens = estimateBatchTokens(remaining) + profileTokens;
  const host = hostOf(runtime.apiBaseUrl);

  const ledger = el("disclose-ledger");
  ledger.replaceChildren();
  if (state.profileBlockCount) {
    addLedgerLine(ledger, t("importLedgerProfileBlocks"), String(state.profileBlockCount), true);
  }
  if (state.kept.length || !state.profileBlockCount) {
    addLedgerLine(ledger, t("importLedgerParsed"), String(state.kept.length), true);
  }
  if (state.skipped) addLedgerLine(ledger, t("importLedgerSkipped"), String(state.skipped));
  if (state.dropped) addLedgerLine(ledger, t("importLedgerDropped"), String(state.dropped));
  if (state.rejectedFiles.length) {
    addLedgerLine(ledger, t("importLedgerIgnoredFiles"), String(state.rejectedFiles.length));
  }
  if (state.ignoredNonJson) {
    addLedgerLine(ledger, t("importLedgerNonJson"), String(state.ignoredNonJson));
  }
  addLedgerLine(
    ledger,
    t("importLedgerBatches"),
    String(remaining.length + state.profileBatches.length),
    true
  );
  addLedgerLine(ledger, t("importLedgerTokens"), formatCount(tokens), true);
  addLedgerLine(
    ledger,
    t("importLedgerTime"),
    estimateDuration(remaining.length + state.profileBatches.length)
  );
  addLedgerLine(
    ledger,
    t("importLedgerDestination"),
    t("importLedgerDestinationValue", { model: runtime.model, host })
  );
}

/**
 * @param {HTMLElement} list
 * @param {string} label
 * @param {string} value
 * @param {boolean} [headline]
 */
function addLedgerLine(list, label, value, headline = false) {
  const li = document.createElement("li");
  if (headline) li.className = "headline";
  const labelNode = document.createElement("span");
  labelNode.className = "ledger-label";
  labelNode.textContent = label;
  const valueNode = document.createElement("span");
  valueNode.className = "ledger-value";
  valueNode.textContent = value;
  li.append(labelNode, valueNode);
  list.append(li);
}

/** @param {string} url */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || "the configured endpoint";
  }
}

/** @param {number} n */
function formatCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/**
 * Deliberately a range, not a point estimate: throughput depends on the
 * provider's rate limits, which we cannot see from here.
 * @param {number} batchCount
 */
function estimateDuration(batchCount) {
  const lowMin = Math.max(1, Math.round((batchCount * 2) / 60));
  const highMin = Math.max(2, Math.round((batchCount * 5) / 60));
  return `${lowMin}–${highMin} min`;
}

el("disclose-back").addEventListener("click", () => {
  flash("");
  showStep("choose");
});

el("recheck-runtime").addEventListener("click", renderDisclosure);

// ── ③ Running ─────────────────────────────────────────

el("stop-distill").addEventListener("click", () => {
  state.stopRequested = true;
  el("stop-distill").disabled = true;
});

el("start-distill").addEventListener("click", async () => {
  state.stopRequested = false;
  el("stop-distill").disabled = false;
  showStep("running");

  // The memory store runs first. It is tiny and already distilled, so someone
  // who selected only memories.json is finished in one call, and someone who
  // selected everything gets the strongest material into the merge whether or
  // not the long conversation run reaches the end.
  //
  // Skipped when resuming: those candidates are already in the saved job, and
  // re-running would duplicate them.
  if (state.profileBatches.length && state.startIndex === 0) {
    updateProgress({
      completed: 0,
      total: state.profileBatches.length,
      candidates: 0,
      phase: "profile",
    });
    const profileRun = await runDistillation({
      batches: state.profileBatches,
      concurrency: 1,
      shouldStop: () => state.stopRequested,
      send: (batch) => send(MSG.IMPORT_PROFILE, { batch }),
      onProgress: (progress) => updateProgress({ ...progress, phase: "profile" }),
    });
    state.profileCandidates = profileRun.candidates;

    // A model that rejected the small profile call will reject the large run
    // too, so stop here rather than burning the whole history to learn that.
    if (profileRun.error || profileRun.cancelled) {
      await finishRun([...state.profileCandidates], profileRun);
      return;
    }
  }

  if (!state.batches.length) {
    await finishRun([...state.profileCandidates], {
      candidates: [],
      completed: 0,
      failed: 0,
      cancelled: false,
      error: "",
    });
    return;
  }

  updateProgress({ completed: state.startIndex, total: state.batches.length, candidates: 0 });

  const outcome = await runDistillation({
    batches: state.batches,
    startIndex: state.startIndex,
    concurrency: 3,
    shouldStop: () => state.stopRequested,
    send: (batch) => send(MSG.IMPORT_DISTILL, { batch }),
    onProgress: updateProgress,
    // The runner only knows about candidates from this run. A resumed job has
    // to carry the earlier ones through, or stopping twice loses the first
    // run's work.
    onCandidates: (candidates, completed) =>
      saveJob([...state.profileCandidates, ...state.resumedCandidates, ...candidates], completed),
  });

  const all = [...state.profileCandidates, ...state.resumedCandidates, ...outcome.candidates];
  await finishRun(all, outcome);
});

/** @param {{ completed: number, total: number, candidates: number, backingOff?: boolean }} progress */
function updateProgress(progress) {
  const pct = progress.total ? (progress.completed / progress.total) * 100 : 0;
  el("progress-fill").style.width = `${pct}%`;
  el("progress-text").textContent = t(
    progress.phase === "profile" ? "importRunningProfile" : "importRunningProgress",
    {
      done: progress.completed,
      total: progress.total,
      candidates: progress.candidates,
    }
  );
  el("backoff-note").hidden = !progress.backingOff;
}

/**
 * @param {import('../lib/memory-sources/types.js').MemoryCandidate[]} candidates
 * @param {import('../lib/memory-import/runner.js').DistillOutcome} outcome
 */
async function finishRun(candidates, outcome) {
  el("progress-text").textContent = t("importMerging");

  const deduped = dedupeLexical(candidates);
  const existing = await loadExistingMemories();

  /** @type {import('../lib/memory-sources/types.js').MergedMemory[]} */
  let merged = [];
  for (const group of splitForReduce(deduped)) {
    const res = await send(MSG.IMPORT_MERGE, { candidates: group, existing });
    // A failed reduce degrades quality but must never discard work already
    // paid for, so the lexically deduped group stands in for it.
    merged = merged.concat(res?.ok ? res.merged : group);
  }

  state.reviewed = rankForReview(merged);

  // A run that finished is done with its cursor. A run the user stopped, or
  // that an auth failure killed, may still be worth continuing — so the saved
  // job survives, and only committing (or discarding it) clears it.
  if (!outcome.cancelled && !outcome.error) await clearJob();

  renderReview(outcome);
}

async function loadExistingMemories() {
  const res = await send(MSG.MEMORY_LIST);
  if (!res?.ok) return [];
  return (res.data || []).map((m) => ({ id: m.id, type: m.type, text: m.text }));
}

// ── ④ Review ──────────────────────────────────────────

/** @param {import('../lib/memory-import/runner.js').DistillOutcome} outcome */
function renderReview(outcome) {
  showStep("review");

  const warnings = [];
  if (outcome.error) warnings.push(t("importReviewStopped", { error: outcome.error }));
  if (outcome.failed) warnings.push(t("importReviewFailed", { failed: outcome.failed }));
  const warningNode = el("review-warnings");
  warningNode.hidden = warnings.length === 0;
  warningNode.textContent = warnings.join(" ");

  if (!state.reviewed.length) {
    el("review-summary").textContent = t("importReviewEmpty");
    el("review-groups").replaceChildren();
    el("accept-selected").hidden = true;
    return;
  }

  el("accept-selected").hidden = false;
  el("review-summary").textContent = summarize(state.reviewed);

  // The head is pre-checked because it is well supported and the user can see
  // it; the tail stays folded and unchecked so a long list never gets
  // rubber-stamped. Nothing unchecked is ever saved.
  //
  // Curated memory-store statements never fold: they are the user's own account
  // of themselves, and they arrive with a support count of one purely because
  // no conversation had to vouch for them.
  const topSupport = state.reviewed[0]?.supportCount || 1;
  const weakBelow = Math.max(2, topSupport * TAIL_SUPPORT_RATIO);
  state.tailStart = state.reviewed.findIndex(
    (m) => !m.fromProfile && (m.existingId || m.supportCount < weakBelow)
  );
  // A fold that would swallow the whole list is not a fold, it is an empty
  // review screen — which is exactly what an import of uniformly
  // single-support candidates used to produce. When nothing stands out as
  // weaker, everything belongs in the head.
  if (state.tailStart <= 0) state.tailStart = state.reviewed.length;

  state.selected = new Set(
    state.reviewed.map((_, i) => i).filter((i) => i < state.tailStart)
  );

  renderGroups();
}

/** @param {import('../lib/memory-sources/types.js').MergedMemory[]} merged */
function summarize(merged) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const memory of merged) counts.set(memory.type, (counts.get(memory.type) || 0) + 1);
  return [...counts.entries()].map(([type, n]) => `${n} ${typeLabel(type)}`).join(" · ");
}

function renderGroups() {
  const container = el("review-groups");
  container.replaceChildren();

  const visible = state.tailExpanded ? state.reviewed.length : state.tailStart;

  /** @type {Map<string, number[]>} */
  const byType = new Map();
  state.reviewed.slice(0, visible).forEach((memory, index) => {
    const list = byType.get(memory.type) || [];
    list.push(index);
    byType.set(memory.type, list);
  });

  for (const [type, indices] of byType) {
    const group = document.createElement("section");
    group.className = "review-group";

    const heading = document.createElement("h3");
    heading.textContent = typeLabel(type);
    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = ` ${indices.length}`;
    heading.append(count);
    group.append(heading);

    for (const index of indices) group.append(renderCandidate(index));
    container.append(group);
  }

  const hiddenCount = state.reviewed.length - state.tailStart;
  if (hiddenCount > 0) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn ghost tail-toggle";
    toggle.textContent = state.tailExpanded
      ? t("importHideTail")
      : t("importShowTail", { n: hiddenCount });
    toggle.addEventListener("click", () => {
      state.tailExpanded = !state.tailExpanded;
      renderGroups();
    });
    container.append(toggle);
  }

  updateAcceptButton();
}

/** @param {number} index */
function renderCandidate(index) {
  const memory = state.reviewed[index];
  const row = document.createElement("div");
  row.className = memory.existingId ? "candidate existing" : "candidate";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selected.has(index);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selected.add(index);
    else state.selected.delete(index);
    updateAcceptButton();
  });

  const body = document.createElement("div");

  const text = document.createElement("textarea");
  text.className = "candidate-text";
  text.rows = 1;
  text.value = memory.text;
  text.setAttribute("aria-label", t("importReviewTitle"));
  text.addEventListener("input", () => {
    memory.text = text.value;
    autoSize(text);
  });

  const meta = document.createElement("div");
  meta.className = "candidate-meta";

  const typeSelect = document.createElement("select");
  for (const type of ["profile", "interest", "goal", "knowledge", "preference", "note"]) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = typeLabel(type);
    option.selected = type === memory.type;
    typeSelect.append(option);
  }
  typeSelect.addEventListener("change", () => {
    memory.type = typeSelect.value;
    renderGroups();
  });
  meta.append(typeSelect);

  const support = document.createElement("span");
  support.textContent = t("importSupport", { n: memory.supportCount });
  meta.append(support);

  if (memory.existingId) {
    const badge = document.createElement("span");
    badge.className = "badge-existing";
    badge.textContent = t("importExistingBadge");
    meta.append(badge);
  }

  body.append(text, meta);

  if (memory.evidenceTitles?.length) {
    const evidence = document.createElement("div");
    evidence.className = "candidate-meta candidate-evidence";
    evidence.textContent = t("importEvidence", {
      titles: memory.evidenceTitles.slice(0, 4).join(" · "),
    });
    body.append(evidence);
  }

  row.append(checkbox, body);
  // Sized on render, not only on input. A one-row textarea clipped whatever it
  // could not fit, so the review screen — the one place the user is asked to
  // approve a memory — was showing a fraction of what it would save, and only
  // revealed the rest once the user happened to type into it.
  requestAnimationFrame(() => autoSize(text));
  return row;
}

/** @param {HTMLTextAreaElement} node */
function autoSize(node) {
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
}

function updateAcceptButton() {
  const button = el("accept-selected");
  button.textContent = t("importAccept", { n: state.selected.size });
  button.disabled = state.selected.size === 0;
}

el("select-all").addEventListener("click", () => {
  const visible = state.tailExpanded ? state.reviewed.length : state.tailStart;
  state.selected = new Set(state.reviewed.slice(0, visible).map((_, i) => i));
  renderGroups();
});

el("select-none").addEventListener("click", () => {
  state.selected.clear();
  renderGroups();
});

el("accept-selected").addEventListener("click", async () => {
  if (!state.selected.size) {
    flash(t("importAcceptNone"), true);
    return;
  }

  const chosen = [...state.selected]
    .sort((a, b) => a - b)
    .map((index) => state.reviewed[index])
    .filter((memory) => memory.text.trim());

  // Checked before committing rather than letting the store truncate silently.
  const existing = await loadExistingMemories();
  if (existing.length + chosen.length > MEMORY_LIMIT) {
    flash(t("importOverLimit", { limit: MEMORY_LIMIT }), true);
    return;
  }

  const res = await send(MSG.IMPORT_COMMIT, { memories: chosen });
  if (!res?.ok) {
    flash(res?.error || t("importErrUnknownFormat"), true);
    return;
  }

  await clearJob();
  flash("");
  el("done-body").textContent = t("importDoneBody", { n: res.saved });
  showStep("done");
});

el("run-again").addEventListener("click", () => {
  state.reviewed = [];
  state.selected.clear();
  state.tailExpanded = false;
  flash("");
  showStep("choose");
});

// ── Boot ──────────────────────────────────────────────

async function boot() {
  const settings = await send(MSG.GET_SETTINGS);
  uiLocale = settings?.data?.resolvedUiLocale === "zh_CN" ? "zh_CN" : "en";
  const themePref = settings?.data?.theme || "system";
  applyPageTheme(themePref);
  watchSystemTheme(() => themePref);
  applyOptionsI18n(uiLocale);
  document.title = t("importPageTitle");

  state.savedJob = await loadJob();
  if (state.savedJob?.fingerprint) {
    el("resume-box").hidden = false;
    el("resume-body").textContent = t("importResumeBody", {
      done: state.savedJob.cursor || 0,
      total: state.savedJob.total || 0,
    });
  }

  showStep("choose");
}

boot();
