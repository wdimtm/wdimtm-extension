import { browserLocale } from "../lib/host-locale.js";
import { resolveUiLocale } from "../../core/i18n.js";
import {
  BUILTIN_LENSES,
  clearLensOverride,
  createCustomLens,
  findLens,
  forkLens,
  listManageableLenses,
  setLensOverride,
  updateCustomLens,
} from "../../core/lenses.js";
import {
  DOMAIN_LENS_PRESETS,
  formatDomainLensRules,
  parseDomainLensRules,
} from "../../core/domain-lenses.js";
import { getMemoryProvider } from "../lib/memory.js";
import { MSG } from "../../core/messages.js";
import { applyOptionsI18n, ot } from "../lib/options-i18n.js";
import { applyPageTheme, watchSystemTheme } from "../lib/page-theme.js";
import {
  DEFAULT_CLOUD_BASE_URL,
  fetchCloudPackages,
  reconcileCloudCredits,
  resolveCloudConfig,
  startCloudPackageCheckout,
} from "../../core/cloud.js";
import {
  ANTHROPIC_DEFAULTS,
  ANTHROPIC_MODELS,
  BYOK_PRESETS,
  accessModeToRuntime,
  byokProviderForSettings,
  isRuntimeReady,
  runtimeToAccessMode,
} from "../../core/runtime-presets.js";
import { getRuntime } from "../../core/runtime/registry.js";
import { runtimeIdForTestMode } from "../../core/runtime-test.js";
import { DEFAULT_SETTINGS, getSettings, saveSettings, topUpUrlFor } from "../lib/settings.js";

const form = document.getElementById("settings-form");
const runtimeEl = document.getElementById("runtime");
const byokFields = document.getElementById("byok-fields");
const openaiFields = document.getElementById("openai-fields");
const anthropicFields = document.getElementById("anthropic-fields");
const cloudAccessFields = document.getElementById("cloud-fields");
const mockFields = document.getElementById("mock-fields");
const statusEl = document.getElementById("status");
const defaultLensEl = document.getElementById("defaultLensId");
const lensListEl = document.getElementById("lens-list");
const lensEditForm = document.getElementById("lens-edit-form");
const customLensForm = document.getElementById("custom-lens-form");
const profileTextEl = document.getElementById("profileText");
const memoryProviderEl = document.getElementById("memoryProvider");
const memoryList = document.getElementById("memory-list");
const memoryForm = document.getElementById("memory-form");
const aiBanner = document.getElementById("ai-status-banner");
const byokPresetEl = document.getElementById("byokPreset");
const testByokBtn = document.getElementById("test-byok");
const testByokStatus = document.getElementById("test-byok-status");
const testAnthropicBtn = document.getElementById("test-anthropic");
const testAnthropicStatus = document.getElementById("test-anthropic-status");
const anthropicModelsEl = document.getElementById("anthropic-models");
const testCloudBtn = document.getElementById("test-cloud");
const testCloudStatus = document.getElementById("test-cloud-status");
const cloudSignInBtn = document.getElementById("cloud-sign-in");
const cloudSessionStatus = document.getElementById("cloud-session-status");
const cloudPackagesEl = document.getElementById("cloud-packages");
const cloudPackagesMeta = document.getElementById("cloud-packages-meta");

/** @type {'en' | 'zh_CN'} */
let uiLocale = "en";

function t(key) {
  return ot(key, uiLocale);
}

/** @type {number} */
let flashTimer = 0;

/**
 * Confirmation for anything that just happened — saving, forgetting a memory,
 * signing in. Renders as a floating toast (see `#status` in options.css), so it
 * is visible wherever the user is on the page rather than only next to the Save
 * button at the bottom of the form.
 *
 * @param {string} msg
 * @param {boolean} [isError]
 */
function flash(msg, isError = false) {
  window.clearTimeout(flashTimer);
  statusEl.textContent = msg;
  statusEl.classList.toggle("is-error", isError);
  // Drop and re-add on the next frame so a repeated action (saving twice) plays
  // the transition again instead of sitting there looking like nothing happened.
  statusEl.classList.remove("is-visible");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => statusEl.classList.add("is-visible"));
  });
  flashTimer = window.setTimeout(() => {
    statusEl.classList.remove("is-visible");
  }, 3000);
}

function selectedAccessMode() {
  const checked = form.querySelector('input[name="accessMode"]:checked');
  return /** @type {'mock' | 'byok' | 'cloud'} */ (checked?.value || "mock");
}

function selectedByokProvider() {
  return byokPresetEl?.value || "openai";
}

function setAccessMode(mode) {
  // Product modes only. Legacy "anthropic" / "promptaas" collapse into byok / cloud.
  const m =
    mode === "byok" || mode === "anthropic"
      ? "byok"
      : mode === "cloud" || mode === "promptaas"
        ? "cloud"
        : "mock";
  const radio = form.querySelector(`input[name="accessMode"][value="${m}"]`);
  if (radio) radio.checked = true;
  runtimeEl.value = accessModeToRuntime(m, selectedByokProvider());
  syncRuntimeFields();
}

function syncRuntimeFields() {
  const mode = selectedAccessMode();
  const provider = selectedByokProvider();
  runtimeEl.value = accessModeToRuntime(mode, provider);
  if (byokFields) byokFields.hidden = mode !== "byok";
  const isAnthropic = mode === "byok" && provider === "anthropic";
  if (openaiFields) openaiFields.hidden = !(mode === "byok" && !isAnthropic);
  if (anthropicFields) anthropicFields.hidden = !isAnthropic;
  if (cloudAccessFields) cloudAccessFields.hidden = mode !== "cloud";
  if (mockFields) mockFields.hidden = mode !== "mock";
  if (mode === "cloud") {
    if (form.cloudBaseUrl && !form.cloudBaseUrl.value.trim()) {
      form.cloudBaseUrl.value = DEFAULT_CLOUD_BASE_URL;
    }
    // Prefer accountMode=cloud so Google sign-in lands a Cloud session.
    const accountModeEl = document.getElementById("accountMode");
    if (accountModeEl && accountModeEl.value !== "cloud") {
      accountModeEl.value = "cloud";
      document.getElementById("cloud-account-fields").hidden = false;
    }
    refreshCloudSessionStatus();
    refreshCloudPackages();
  }
}

function applyByokPreset(presetId, { force = false } = {}) {
  const preset = BYOK_PRESETS.find((p) => p.id === presetId);
  if (!preset || preset.id === "custom") {
    syncRuntimeFields();
    return;
  }
  if (preset.protocol === "anthropic") {
    if (form.anthropicBaseUrl) {
      form.anthropicBaseUrl.value = preset.apiBaseUrl || ANTHROPIC_DEFAULTS.apiBaseUrl;
    }
    if (form.anthropicModel) {
      if (force || !form.anthropicModel.value.trim()) {
        form.anthropicModel.value = preset.model || ANTHROPIC_DEFAULTS.model;
      }
    }
  } else {
    form.apiBaseUrl.value = preset.apiBaseUrl;
    if (force || !form.model.value.trim() || form.model.dataset.fromPreset !== "0") {
      form.model.value = preset.model;
    }
    form.model.dataset.fromPreset = "1";
  }
  syncRuntimeFields();
}

function formatPackagePrice(pkg) {
  const cents = Number(pkg.price_cents) || 0;
  const currency = String(pkg.currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(uiLocale === "zh_CN" ? "zh-CN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Cloud product path: sign in → pick package → pay.
 * Base URL / token fields stay under Advanced for self-host only.
 */
async function refreshCloudPackages() {
  if (!cloudPackagesEl) return;
  cloudPackagesEl.textContent = "";
  if (cloudPackagesMeta) {
    cloudPackagesMeta.hidden = true;
    cloudPackagesMeta.textContent = "";
  }

  const loading = document.createElement("p");
  loading.className = "hint";
  loading.textContent = t("cloudPackagesLoading");
  cloudPackagesEl.appendChild(loading);

  try {
    const settings = await getSettings();
    if (!form.cloudBaseUrl?.value?.trim()) {
      form.cloudBaseUrl.value = settings.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL;
    }
    const config = resolveCloudConfig({
      cloudBaseUrl: form.cloudBaseUrl?.value || settings.cloudBaseUrl,
      cloudAccessToken: form.cloudAccessToken?.value || settings.cloudAccessToken,
    });
    const catalog = await fetchCloudPackages(config, {
      currency: uiLocale === "zh_CN" ? "CNY" : "USD",
    });
    cloudPackagesEl.textContent = "";
    const packages = Array.isArray(catalog.packages) ? catalog.packages : [];
    if (!packages.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = t("cloudPackagesEmpty");
      cloudPackagesEl.appendChild(empty);
      return;
    }

    if (cloudPackagesMeta) {
      cloudPackagesMeta.hidden = false;
      cloudPackagesMeta.textContent =
        catalog.source === "agentaab"
          ? t("cloudPackagesFromAgentaab")
          : t("cloudPackagesPreview");
      if (catalog.warning) {
        cloudPackagesMeta.textContent += ` ${catalog.warning}`;
      }
    }

    const signedIn = Boolean(
      (form.cloudAccessToken?.value || settings.cloudAccessToken || "").trim()
    );

    for (const pkg of packages) {
      const row = document.createElement("div");
      row.className = "cloud-package";
      const left = document.createElement("div");
      const title = document.createElement("div");
      title.className = "cloud-package-title";
      title.textContent =
        uiLocale === "zh_CN" && pkg.nameZh ? pkg.nameZh : pkg.name || pkg.id;
      const meta = document.createElement("div");
      meta.className = "cloud-package-meta";
      const desc =
        uiLocale === "zh_CN" && pkg.descriptionZh
          ? pkg.descriptionZh
          : pkg.description || "";
      meta.textContent = `${pkg.credits} credits${desc ? ` · ${desc}` : ""}`;
      left.appendChild(title);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.className = "actions";
      const price = document.createElement("span");
      price.className = "cloud-package-price";
      price.textContent = formatPackagePrice(pkg);
      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "btn";
      const canBuy = signedIn && catalog.checkout_available !== false;
      buy.textContent = canBuy ? t("cloudBuy") : t("cloudBuyUnavailable");
      buy.disabled = !canBuy;
      buy.title = !signedIn
        ? t("cloudNeedSignIn")
        : catalog.checkout_available === false
          ? t("cloudPackagesPreview")
          : "";
      buy.addEventListener("click", () => buyCloudPackage(pkg.id));
      right.appendChild(price);
      right.appendChild(buy);

      row.appendChild(left);
      row.appendChild(right);
      cloudPackagesEl.appendChild(row);
    }

    if (signedIn) {
      // The poll after checkout covers the usual case; this covers paying on a
      // phone, closing the tab, or coming back the next day.
      const claim = document.createElement("button");
      claim.type = "button";
      claim.className = "btn ghost";
      claim.textContent = t("cloudRefreshCredits");
      claim.addEventListener("click", () => claimPaidCredits());
      const claimRow = document.createElement("div");
      claimRow.className = "actions";
      claimRow.appendChild(claim);
      cloudPackagesEl.appendChild(claimRow);
    }
  } catch (err) {
    cloudPackagesEl.textContent = "";
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = err instanceof Error ? err.message : String(err);
    cloudPackagesEl.appendChild(p);
  }
}

async function buyCloudPackage(packageId) {
  try {
    const settings = await getSettings();
    const config = resolveCloudConfig({
      cloudBaseUrl: form.cloudBaseUrl?.value || settings.cloudBaseUrl,
      cloudAccessToken: form.cloudAccessToken?.value || settings.cloudAccessToken,
    });
    if (!config.accessToken) {
      flash(t("cloudNeedSignIn"), true);
      return;
    }
    flash(t("cloudCheckoutOpening"));
    const result = await startCloudPackageCheckout(config, { packageId });
    const url = result?.checkout_url;
    if (!url) throw new Error(t("cloudCheckoutFailed"));
    window.open(url, "_blank", "noopener,noreferrer");
    // Payment completes on the provider's page, which cannot talk back to the
    // extension. Nothing here knows the money landed until Cloud is asked.
    flash(t("cloudCheckoutWaiting"));
    watchForPayment();
  } catch (err) {
    flash(err instanceof Error ? err.message : t("cloudCheckoutFailed"), true);
  }
}

/** @type {ReturnType<typeof setInterval> | null} */
let paymentPoll = null;

function stopWatchingForPayment() {
  if (paymentPoll === null) return;
  clearInterval(paymentPoll);
  paymentPoll = null;
}

/**
 * Ask Cloud to turn a completed payment into credits (#88).
 * @param {{ quiet?: boolean }} [opts] quiet suppresses "nothing found yet",
 *   which is the normal answer while a poll is still waiting.
 * @returns {Promise<number>} credits added by this call
 */
async function claimPaidCredits({ quiet = false } = {}) {
  const settings = await getSettings();
  const config = resolveCloudConfig({
    cloudBaseUrl: form.cloudBaseUrl?.value || settings.cloudBaseUrl,
    cloudAccessToken: form.cloudAccessToken?.value || settings.cloudAccessToken,
  });
  if (!config.accessToken) {
    if (!quiet) flash(t("cloudNeedSignIn"), true);
    return 0;
  }
  try {
    const result = await reconcileCloudCredits(config);
    const added = Number(result?.creditsAdded) || 0;
    if (added > 0) {
      flash(t("cloudCheckoutCredited").replace("{n}", String(added)));
      await refreshCloudPackages();
    } else if (!quiet) {
      flash(t("cloudCheckoutPending"));
    }
    return added;
  } catch (err) {
    if (!quiet) flash(err instanceof Error ? err.message : t("cloudCheckoutFailed"), true);
    return 0;
  }
}

/**
 * Poll for a couple of minutes after checkout opens. Bounded on purpose: an
 * unbounded poll would keep hitting Cloud for a payment the user abandoned,
 * and the manual button covers the case where they paid later.
 */
function watchForPayment() {
  stopWatchingForPayment();
  let attempts = 0;
  paymentPoll = setInterval(async () => {
    attempts += 1;
    const added = await claimPaidCredits({ quiet: true });
    if (added > 0 || attempts >= 24) stopWatchingForPayment();
  }, 5000);
}

async function refreshCloudSessionStatus() {
  if (!cloudSessionStatus) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: "wdimtm:account-status" });
    const email = res?.data?.session?.email || res?.data?.session?.displayName;
    const token = form.cloudAccessToken?.value?.trim();
    if (email || token) {
      cloudSessionStatus.textContent = email
        ? `${t("cloudSignedInAs")} ${email}`
        : t("cloudSignedInAs");
      cloudSessionStatus.style.color = "#86efac";
      if (cloudSignInBtn) cloudSignInBtn.hidden = Boolean(email || token);
    } else {
      cloudSessionStatus.textContent = t("cloudNeedSignIn");
      cloudSessionStatus.style.color = "var(--muted)";
      if (cloudSignInBtn) cloudSignInBtn.hidden = false;
    }
  } catch {
    cloudSessionStatus.textContent = t("cloudNeedSignIn");
  }
}

/**
 * @param {Awaited<ReturnType<typeof getSettings>>} settings
 */
function renderAiStatusBanner(settings) {
  if (!aiBanner) return;
  const ready = isRuntimeReady(settings);
  const mode = runtimeToAccessMode(settings.runtime);

  if (ready.ok && settings.runtime !== "mock") {
    const tested =
      settings.lastRuntimeTestOk && settings.lastRuntimeTestAt
        ? ` ${t("lastTestOk")} ${settings.lastRuntimeTestAt.slice(0, 16).replace("T", " ")}`
        : "";
    aiBanner.hidden = false;
    aiBanner.className = "onboarding-banner ok";
    if (mode === "cloud") {
      // Cloud session may exist while product path (packages/checkout) is still WIP.
      aiBanner.className = "onboarding-banner";
      aiBanner.textContent = `${t("statusCloudInDev")}${tested}`;
    } else if (settings.runtime === "anthropic") {
      aiBanner.textContent = `${t("statusAnthropicReady")}${tested}`;
    } else {
      aiBanner.textContent = `${t("statusByokReady")}${tested}`;
    }
    return;
  }

  aiBanner.hidden = false;
  aiBanner.className = "onboarding-banner";
  if (settings.runtime === "mock" || mode === "mock") {
    aiBanner.textContent = t("statusMock");
  } else if (ready.reason === "missing_byok_key") {
    aiBanner.classList.add("error");
    aiBanner.textContent = t("statusMissingByokKey");
  } else if (ready.reason === "missing_byok_base") {
    aiBanner.classList.add("error");
    aiBanner.textContent = t("statusMissingByokBase");
  } else if (ready.reason === "missing_anthropic_key") {
    aiBanner.classList.add("error");
    aiBanner.textContent = t("statusMissingAnthropicKey");
  } else if (ready.reason === "missing_anthropic_base") {
    aiBanner.classList.add("error");
    aiBanner.textContent = t("statusMissingAnthropicBase");
  } else if (ready.reason === "use_cloud") {
    aiBanner.classList.add("error");
    aiBanner.textContent = t("statusUseCloudInstead");
  } else if (mode === "cloud" || settings.runtime === "wdimtm-cloud") {
    // Product path still WIP (#86–#88) — don't read as a broken config.
    aiBanner.textContent = t("statusCloudInDev");
  } else if (ready.reason === "missing_cloud_base") {
    aiBanner.classList.add("error");
    aiBanner.textContent = t("statusMissingCloudBase");
  } else if (ready.reason === "missing_cloud_token") {
    aiBanner.classList.add("error");
    aiBanner.textContent = t("statusMissingCloudToken");
  } else {
    aiBanner.textContent = t("statusConfigureAi");
  }
}

/**
 * @param {Awaited<ReturnType<typeof getSettings>>} settings
 */
function applyLocaleFromSettings(settings) {
  uiLocale = resolveUiLocale(settings.uiLocale, browserLocale());
  applyOptionsI18n(uiLocale);
  // Refresh preset labels for locale
  if (byokPresetEl) {
    for (const opt of byokPresetEl.options) {
      const preset = BYOK_PRESETS.find((p) => p.id === opt.value);
      if (!preset) continue;
      opt.textContent = uiLocale === "zh_CN" ? preset.labelZh : preset.label;
    }
  }
}

function fillLensSelect(settings) {
  const preferZh = uiLocale === "zh_CN";
  const list = listManageableLenses(settings.customLenses || [], settings.lensOverrides || {});
  const options = list.map((l) => {
    let name =
      preferZh && l.nameZh ? `${l.nameZh} · ${l.name}` : l.nameZh ? `${l.name} · ${l.nameZh}` : l.name;
    if (l.kind === "builtin" && l.overridden) name = `${name} *`;
    return { id: l.id, name, hint: l.hint || "" };
  });
  const selected = settings.defaultLensId;
  defaultLensEl.innerHTML = options
    .map(
      (l) =>
        `<option value="${escapeAttr(l.id)}"${
          l.id === selected ? " selected" : ""
        } title="${escapeAttr(l.hint)}">${escapeHtml(l.name)}</option>`
    )
    .join("");
}

function closeLensEditor() {
  if (!lensEditForm) return;
  lensEditForm.hidden = true;
  document.getElementById("lens-edit-id").value = "";
  document.getElementById("lens-edit-kind").value = "";
  document.getElementById("lens-name").value = "";
  document.getElementById("lens-name-zh").value = "";
  document.getElementById("lens-hint").value = "";
  document.getElementById("lens-instructions").value = "";
  document.getElementById("lens-reset-btn").hidden = true;
  lensListEl?.querySelectorAll(".lens-item.editing").forEach((el) => el.classList.remove("editing"));
}

/**
 * @param {{ id: string, kind: 'builtin' | 'custom', name: string, nameZh?: string, hint?: string, instructions: string, overridden?: boolean }} lens
 */
function openLensEditor(lens) {
  if (!lensEditForm) return;
  lensEditForm.hidden = false;
  document.getElementById("lens-edit-id").value = lens.id;
  document.getElementById("lens-edit-kind").value = lens.kind;
  document.getElementById("lens-name").value = lens.name || "";
  document.getElementById("lens-name-zh").value = lens.nameZh || "";
  document.getElementById("lens-hint").value = lens.hint || "";
  document.getElementById("lens-instructions").value = lens.instructions || "";
  const title = document.getElementById("lens-edit-title");
  if (lens.kind === "builtin") {
    title.textContent = lens.overridden
      ? t("editingBuiltinOverride")
      : t("editingBuiltin");
    document.getElementById("lens-reset-btn").hidden = !lens.overridden;
  } else {
    title.textContent = t("editingCustom");
    document.getElementById("lens-reset-btn").hidden = true;
  }
  lensListEl?.querySelectorAll(".lens-item.editing").forEach((el) => el.classList.remove("editing"));
  lensListEl?.querySelector(`.lens-item[data-id="${CSS.escape(lens.id)}"]`)?.classList.add("editing");
  lensEditForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  document.getElementById("lens-instructions").focus();
}

function renderLenses(settings) {
  if (!lensListEl) return;
  const list = listManageableLenses(settings.customLenses || [], settings.lensOverrides || {});
  const preferZh = uiLocale === "zh_CN";

  lensListEl.innerHTML = list
    .map((l) => {
      const label =
        preferZh && l.nameZh ? `${l.nameZh} · ${l.name}` : l.nameZh ? `${l.name} · ${l.nameZh}` : l.name;
      const badge =
        l.kind === "custom"
          ? `<span class="badge custom">${escapeHtml(t("badgeCustom"))}</span>`
          : l.overridden
            ? `<span class="badge override">${escapeHtml(t("badgeTweaked"))}</span>`
            : `<span class="badge">${escapeHtml(t("badgeBuiltin"))}</span>`;
      const preview = (l.instructions || "").slice(0, 220);
      const defaultMark =
        l.id === settings.defaultLensId
          ? ` <span class="badge">${escapeHtml(t("badgeDefault"))}</span>`
          : "";
      return `
      <div class="list-item lens-item" data-id="${escapeAttr(l.id)}" data-kind="${escapeAttr(l.kind)}">
        <div class="lens-row">
          <div>
            <strong>${escapeHtml(label)}</strong>${badge}${defaultMark}
            ${l.hint ? `<p class="meta" style="margin:4px 0 0">${escapeHtml(l.hint)}</p>` : ""}
            <p class="lens-instructions-preview">${escapeHtml(preview)}${
              (l.instructions || "").length > 220 ? "…" : ""
            }</p>
          </div>
          <div class="lens-actions">
            <button type="button" class="btn small" data-edit-lens="${escapeAttr(l.id)}">${escapeHtml(
              t("edit")
            )}</button>
            ${
              l.kind === "builtin"
                ? `<button type="button" class="btn ghost small" data-fork-lens="${escapeAttr(
                    l.id
                  )}">${escapeHtml(t("forkLens"))}</button>`
                : `<button type="button" class="btn ghost small" data-remove-lens="${escapeAttr(
                    l.id
                  )}">${escapeHtml(t("remove"))}</button>`
            }
            ${
              l.id !== settings.defaultLensId
                ? `<button type="button" class="btn ghost small" data-default-lens="${escapeAttr(
                    l.id
                  )}">${escapeHtml(t("setDefault"))}</button>`
                : ""
            }
          </div>
        </div>
      </div>`;
    })
    .join("");

  lensListEl.querySelectorAll("[data-edit-lens]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-edit-lens");
      const s = await getSettings();
      const item = listManageableLenses(s.customLenses || [], s.lensOverrides || {}).find(
        (x) => x.id === id
      );
      if (item) openLensEditor(item);
    });
  });

  lensListEl.querySelectorAll("[data-remove-lens]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-remove-lens");
      if (!confirm(t("removeLensConfirm"))) return;
      const s = await getSettings();
      const customLenses = (s.customLenses || []).filter((x) => x.id !== id);
      const defaultLensId = s.defaultLensId === id ? "general" : s.defaultLensId;
      await saveSettings({ customLenses, defaultLensId });
      closeLensEditor();
      await reload();
      flash(t("lensRemoved"));
    });
  });

  lensListEl.querySelectorAll("[data-fork-lens]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-fork-lens");
      const s = await getSettings();
      const source = findLens(id, s.customLenses || [], s.lensOverrides || {});
      if (!source) return;
      const forked = forkLens(source, uiLocale === "zh_CN" ? "（副本）" : " (copy)");
      await saveSettings({ customLenses: [...(s.customLenses || []), forked] });
      await reload();
      openLensEditor({ ...forked, kind: "custom" });
      flash(t("lensForked"));
    });
  });

  lensListEl.querySelectorAll("[data-default-lens]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-default-lens");
      await saveSettings({ defaultLensId: id || "general" });
      await reload();
      flash(t("defaultLensSet"));
    });
  });
}

function memTypeLabel(type) {
  const map = {
    interest: "memInterest",
    goal: "memGoal",
    knowledge: "memKnowledge",
    preference: "memPreference",
    note: "memNote",
    profile: "memProfile",
  };
  return t(map[type] || "memNote");
}

async function renderMemories() {
  const settings = await getSettings();
  const provider = getMemoryProvider(settings.memoryProvider);
  const items = await provider.list();
  if (!items.length) {
    memoryList.innerHTML = `<p class="empty">${escapeHtml(t("noMemories"))}</p>`;
    return;
  }
  memoryList.innerHTML = items
    .map(
      (m) => `
      <div class="list-item" data-id="${escapeAttr(m.id)}">
        <div>
          <strong>${escapeHtml(memTypeLabel(m.type))}</strong>
          <span class="meta">${escapeHtml(m.source)} · ${escapeHtml(
            (m.updatedAt || "").slice(0, 10)
          )}</span>
          <p>${escapeHtml(m.text)}</p>
        </div>
        <button type="button" class="btn ghost small" data-remove-mem="${escapeAttr(
          m.id
        )}">${escapeHtml(t("forget"))}</button>
      </div>`
    )
    .join("");

  memoryList.querySelectorAll("[data-remove-mem]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-remove-mem");
      const s = await getSettings();
      await getMemoryProvider(s.memoryProvider).remove(id);
      await renderMemories();
      flash(t("memoryForgotten"));
    });
  });
}

async function reload() {
  const settings = await getSettings();
  applyLocaleFromSettings(settings);

  const mode = runtimeToAccessMode(settings.runtime || "mock");
  if (byokPresetEl) {
    byokPresetEl.value = byokProviderForSettings(settings);
  }
  setAccessMode(mode);
  form.enabled.checked = settings.enabled !== false;
  form.denylist.value = (settings.denylist || []).join("\n");
  if (form.domainLenses) {
    form.domainLenses.value = formatDomainLensRules(settings.domainLenses || []);
  }
  form.answerDepth.value = settings.answerDepth || "normal";
  form.theme.value = settings.theme || "system";
  // The popover already honoured this setting; the settings page itself did
  // not, so choosing Dark used to leave this page white.
  applyPageTheme(form.theme.value);
  if (form.lensMode) form.lensMode.value = settings.lensMode === "manual" ? "manual" : "auto";
  form.stream.checked = settings.stream !== false;
  if (form.webSearchEnabled) {
    form.webSearchEnabled.checked = Boolean(settings.webSearchEnabled);
  }
  if (form.webSearchProvider) {
    form.webSearchProvider.value = settings.webSearchProvider || "none";
  }
  if (form.webSearchApiKey) {
    form.webSearchApiKey.value = settings.webSearchApiKey || "";
  }
  if (form.webSearchMaxResults) {
    form.webSearchMaxResults.value = String(settings.webSearchMaxResults || 5);
  }
  form.uiLocale.value = settings.uiLocale || "auto";
  form.answerLanguage.value = settings.answerLanguage || "auto";
  form.apiBaseUrl.value = settings.apiBaseUrl || "";
  form.apiKey.value = settings.apiKey || "";
  form.model.value = settings.model || "gpt-4o-mini";
  form.model.dataset.fromPreset = "0";
  if (form.anthropicBaseUrl) {
    form.anthropicBaseUrl.value = settings.anthropicBaseUrl || ANTHROPIC_DEFAULTS.apiBaseUrl;
    form.anthropicApiKey.value = settings.anthropicApiKey || "";
    form.anthropicModel.value = settings.anthropicModel || ANTHROPIC_DEFAULTS.model;
  }
  if (form.cloudBaseUrl) {
    form.cloudBaseUrl.value = settings.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL;
  }
  if (form.cloudAccessToken) form.cloudAccessToken.value = settings.cloudAccessToken || "";
  if (form.cloudSignUpUrl) form.cloudSignUpUrl.value = settings.cloudSignUpUrl || "";
  profileTextEl.value = settings.profileText || "";
  memoryProviderEl.value = settings.memoryProvider || "local";

  await refreshAccountCard(settings);
  await refreshResearchCard(settings).catch(() => {});
  fillLensSelect(settings);
  renderLenses(settings);
  syncRuntimeFields();
  renderAiStatusBanner(settings);
  await renderMemories();
  if (selectedAccessMode() === "cloud") {
    await refreshCloudSessionStatus();
    await refreshCloudPackages();
  }
}

/**
 * Loopback endpoints are optional permissions, not baseline ones — a published
 * extension should not ship standing access to the user's local machine. Ask
 * for the origin only when they actually point a runtime at it. Runs inside the
 * submit handler so the request still counts as a user gesture.
 * @param {string[]} urls
 */
async function ensureLocalHostAccess(urls) {
  const origins = new Set();
  for (const raw of urls) {
    if (!raw) continue;
    let host;
    try {
      host = new URL(raw).hostname;
    } catch {
      continue;
    }
    if (host === "localhost") origins.add("http://localhost/*");
    else if (host === "127.0.0.1") origins.add("http://127.0.0.1/*");
  }
  if (!origins.size) return true;
  const list = [...origins];
  try {
    if (await chrome.permissions.contains({ origins: list })) return true;
    return await chrome.permissions.request({ origins: list });
  } catch {
    return false;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const denylist = form.denylist.value
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const accessMode = selectedAccessMode();
  const byokProvider = selectedByokProvider();
  const runtime = accessModeToRuntime(accessMode, byokProvider);
  const granted = await ensureLocalHostAccess([
    form.apiBaseUrl.value.trim(),
    form.anthropicBaseUrl?.value?.trim() || "",
    form.cloudBaseUrl?.value?.trim() || "",
  ]);
  await saveSettings({
    enabled: form.enabled.checked,
    denylist,
    domainLenses: parseDomainLensRules(form.domainLenses?.value || ""),
    answerDepth: form.answerDepth.value || "normal",
    theme: form.theme.value || "system",
    lensMode: form.lensMode?.value === "manual" ? "manual" : "auto",
    runtime,
    stream: form.stream.checked,
    webSearchEnabled: Boolean(form.webSearchEnabled?.checked),
    webSearchProvider: form.webSearchProvider?.value || "none",
    webSearchApiKey: form.webSearchApiKey?.value?.trim() || "",
    webSearchMaxResults: Math.min(
      8,
      Math.max(1, Number(form.webSearchMaxResults?.value) || 5)
    ),
    uiLocale: form.uiLocale.value || "auto",
    answerLanguage: form.answerLanguage.value || "auto",
    apiBaseUrl: form.apiBaseUrl.value.trim() || "https://api.openai.com/v1",
    apiKey: form.apiKey.value.trim(),
    model: form.model.value.trim() || "gpt-4o-mini",
    anthropicBaseUrl:
      form.anthropicBaseUrl?.value?.trim() || ANTHROPIC_DEFAULTS.apiBaseUrl,
    anthropicApiKey: form.anthropicApiKey?.value?.trim() || "",
    anthropicModel: form.anthropicModel?.value?.trim() || ANTHROPIC_DEFAULTS.model,
    cloudBaseUrl: form.cloudBaseUrl?.value?.trim() || DEFAULT_CLOUD_BASE_URL,
    cloudAccessToken: form.cloudAccessToken?.value?.trim() || "",
    cloudSignUpUrl: form.cloudSignUpUrl?.value?.trim() || "",
    defaultLensId: form.defaultLensId.value || "general",
    memoryProvider: memoryProviderEl.value || "local",
    accountMode: document.getElementById("accountMode").value === "cloud" ? "cloud" : "local",
    syncPreferences: document.getElementById("syncPreferences").checked,
    syncChatHistory: document.getElementById("syncChatHistory").checked,
    syncSecrets: document.getElementById("syncSecrets").checked,
  });
  await chrome.runtime.sendMessage({
    type: "wdimtm:account-set-mode",
    payload: {
      mode: document.getElementById("accountMode").value === "cloud" ? "cloud" : "local",
    },
  });
  await reload();
  flash(granted ? t("saved") : t("savedNoLocalAccess"), !granted);
});

// Live preview when changing UI language before save
document.getElementById("uiLocale").addEventListener("change", async () => {
  const provisional = form.uiLocale.value || "auto";
  uiLocale = resolveUiLocale(provisional, browserLocale());
  applyOptionsI18n(uiLocale);
  const s = await getSettings();
  form.uiLocale.value = provisional;
  form.answerLanguage.value = form.answerLanguage.value || s.answerLanguage || "auto";
  form.answerDepth.value = form.answerDepth.value || s.answerDepth || "normal";
  form.theme.value = form.theme.value || s.theme || "system";
  applyPageTheme(form.theme.value);
  const mode = selectedAccessMode();
  setAccessMode(mode);
  if (form.lensMode) {
    form.lensMode.value = form.lensMode.value || s.lensMode || "auto";
  }
  fillLensSelect({ ...s, defaultLensId: form.defaultLensId.value || s.defaultLensId });
  renderLenses(s);
  await renderMemories();
  await refreshAccountCard({ ...s, uiLocale: provisional });
  renderAiStatusBanner({
    ...s,
    runtime: accessModeToRuntime(mode, selectedByokProvider()),
  });
  syncRuntimeFields();
});

async function refreshAccountCard(settings) {
  if (!settings) settings = await getSettings();
  const modeEl = document.getElementById("accountMode");
  const cloudFields = document.getElementById("cloud-account-fields");
  const statusLine = document.getElementById("account-status-line");
  const syncMeta = document.getElementById("account-sync-meta");
  modeEl.value = settings.accountMode === "cloud" ? "cloud" : "local";
  cloudFields.hidden = modeEl.value !== "cloud";
  document.getElementById("syncPreferences").checked = settings.syncPreferences !== false;
  document.getElementById("syncChatHistory").checked = Boolean(settings.syncChatHistory);
  document.getElementById("syncSecrets").checked = Boolean(settings.syncSecrets);

  const res = await chrome.runtime.sendMessage({ type: "wdimtm:account-status" });
  if (res?.ok && res.data) {
    const d = res.data;
    if (d.session?.email || d.session?.displayName) {
      statusLine.textContent = `${t("signedInAs")} ${d.session.email || d.session.displayName}`;
    } else if (d.accountMode === "cloud") {
      statusLine.textContent = d.cloudReady ? t("notSignedIn") : t("notSignedInCloudPending");
    } else {
      statusLine.textContent = t("localModeNoAccount");
    }
    const syncedText = d.lastSyncedAt
      ? `${t("lastSynced")} ${d.lastSyncedAt}`
      : t("neverSynced");
    // #51: when signed in, show what the plan actually buys this period.
    const q = d.account?.quota;
    const remaining =
      q && typeof q.limit === "number"
        ? (q.remaining ?? Math.max(0, q.limit - (q.used || 0)))
        : null;
    syncMeta.textContent =
      remaining === null
        ? syncedText
        : `${syncedText} · ${d.account.planLabel || d.account.plan} · ${t("creditsLeft")} ${remaining}/${q.limit}`;

    renderBalanceBanner(settings, remaining, q?.resetAt);
  }

/**
 * An exhausted balance has to be visible *before* the next explain fails (#41),
 * and it has to name the ways out. A number quietly reaching zero is how a
 * product looks broken rather than out of credits.
 *
 * @param {object} settings
 * @param {number | null} remaining
 * @param {string} [resetAt]
 */
function renderBalanceBanner(settings, remaining, resetAt) {
  const banner = document.getElementById("balance-banner");
  if (!banner) return;
  if (remaining === null || remaining > 0) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }

  banner.textContent = "";
  const line = document.createElement("p");
  line.textContent = resetAt
    ? `${t("balanceEmpty")} ${t("balanceResets")} ${new Date(resetAt).toLocaleDateString()}`
    : t("balanceEmpty");
  banner.appendChild(line);

  const actions = document.createElement("div");
  actions.className = "actions";

  const topUp = topUpUrlFor(settings);
  if (topUp) {
    const a = document.createElement("a");
    a.className = "btn";
    a.href = topUp;
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    a.textContent = t("topUp");
    actions.appendChild(a);
  }

  const byok = document.createElement("button");
  byok.type = "button";
  byok.className = "btn ghost";
  byok.textContent = t("useOwnKey");
  byok.addEventListener("click", () => {
    // One click to the alternative that always works, rather than a dead end.
    setAccessMode("byok");
    document.getElementById("apiKey")?.focus();
  });
  actions.appendChild(byok);

  banner.appendChild(actions);
  banner.hidden = false;
}
}

document.getElementById("domain-lens-presets")?.addEventListener("click", () => {
  // Suggestions, not defaults: they land in the textarea for the user to keep,
  // edit or delete before saving.
  const field = form.domainLenses;
  if (!field) return;
  const existing = parseDomainLensRules(field.value);
  const known = new Set(existing.map((r) => r.host));
  const merged = [...existing, ...DOMAIN_LENS_PRESETS.filter((p) => !known.has(p.host))];
  field.value = formatDomainLensRules(merged);
  field.focus();
});

document.getElementById("accountMode").addEventListener("change", () => {
  document.getElementById("cloud-account-fields").hidden =
    document.getElementById("accountMode").value !== "cloud";
});

/**
 * Research jobs outlive the tab that started them (#52), so they need a home
 * that is not a popover — otherwise "durable" is a claim the UI never keeps.
 * @param {object} [settings]
 */
async function refreshResearchCard(settings) {
  if (!settings) settings = await getSettings();
  const card = document.getElementById("research-card");
  const list = document.getElementById("research-jobs");
  const configured = Boolean(String(settings.cloudBaseUrl || "").trim());
  card.hidden = !configured;
  if (!configured) return;

  list.textContent = "";
  const res = await chrome.runtime.sendMessage({ type: MSG.RESEARCH_LIST });
  if (!res?.ok) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = res?.error || t("researchJobsUnavailable");
    list.appendChild(p);
    return;
  }

  const jobs = Array.isArray(res.data) ? res.data : [];
  if (!jobs.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = t("researchJobsEmpty");
    list.appendChild(p);
    return;
  }

  for (const job of jobs) {
    const row = document.createElement("div");
    row.className = "memory-item";
    const title = document.createElement("div");
    title.textContent = job.goal || job.id;
    const meta = document.createElement("div");
    meta.className = "hint";
    meta.textContent = `${job.state} · ${job.mode || ""} · ${
      job.updatedAt ? new Date(job.updatedAt).toLocaleString() : ""
    }`;
    row.append(title, meta);
    if (job.error?.message) {
      const err = document.createElement("div");
      err.className = "hint";
      err.textContent = job.error.message;
      row.appendChild(err);
    }
    list.appendChild(row);
  }
}

document.getElementById("research-refresh").addEventListener("click", () => {
  refreshResearchCard().catch(() => {});
});

document.getElementById("account-sign-in").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "wdimtm:account-sign-in" });
  if (!res?.ok) {
    flash(res?.error || t("signInFailed"), true);
    return;
  }
  flash(t("signedIn"));
  await refreshAccountCard();
});

document.getElementById("account-sign-out").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "wdimtm:account-sign-out" });
  flash(t("signedOut"));
  await refreshAccountCard();
});

document.getElementById("account-sync-now").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "wdimtm:account-sync-now" });
  if (!res?.ok) {
    flash(res?.error || t("syncFailed"), true);
    return;
  }
  flash(t("synced"));
  await refreshAccountCard();
});

document.getElementById("export-settings").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "wdimtm:export-settings" });
  if (!res?.ok) {
    flash(res?.error || t("exportFailed"), true);
    return;
  }
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wdimtm-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  flash(t("exported"));
});

document.getElementById("import-settings").addEventListener("click", () => {
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const res = await chrome.runtime.sendMessage({
      type: "wdimtm:import-settings",
      payload: json,
    });
    if (!res?.ok) throw new Error(res?.error || t("importFailed"));
    await reload();
    flash(t("imported"));
  } catch (err) {
    flash(err instanceof Error ? err.message : String(err), true);
  } finally {
    e.target.value = "";
  }
});

document.getElementById("reset-all").addEventListener("click", async () => {
  if (!confirm(t("resetConfirm"))) return;
  const res = await chrome.runtime.sendMessage({ type: "wdimtm:reset-all" });
  if (!res?.ok) {
    flash(res?.error || t("resetFailed"), true);
    return;
  }
  await reload();
  flash(t("resetComplete"));
});

form.querySelectorAll('input[name="accessMode"]').forEach((el) => {
  el.addEventListener("change", () => {
    syncRuntimeFields();
    const mode = selectedAccessMode();
    const provider = selectedByokProvider();
    renderAiStatusBanner({
      runtime: accessModeToRuntime(mode, provider),
      apiKey: form.apiKey.value,
      apiBaseUrl: form.apiBaseUrl.value,
      anthropicApiKey: form.anthropicApiKey?.value || "",
      anthropicBaseUrl: form.anthropicBaseUrl?.value || "",
      cloudBaseUrl: form.cloudBaseUrl?.value,
      cloudAccessToken: form.cloudAccessToken?.value,
      lastRuntimeTestAt: "",
      lastRuntimeTestOk: false,
    });
  });
});

if (byokPresetEl) {
  byokPresetEl.addEventListener("change", () => {
    applyByokPreset(byokPresetEl.value, { force: true });
    const mode = selectedAccessMode();
    renderAiStatusBanner({
      runtime: accessModeToRuntime(mode, selectedByokProvider()),
      apiKey: form.apiKey.value,
      apiBaseUrl: form.apiBaseUrl.value,
      anthropicApiKey: form.anthropicApiKey?.value || "",
      anthropicBaseUrl: form.anthropicBaseUrl?.value || "",
      cloudBaseUrl: form.cloudBaseUrl?.value,
      cloudAccessToken: form.cloudAccessToken?.value,
      lastRuntimeTestAt: "",
      lastRuntimeTestOk: false,
    });
  });
}

if (anthropicModelsEl) {
  for (const m of ANTHROPIC_MODELS) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.label = m.label;
    anthropicModelsEl.appendChild(opt);
  }
}

form.model?.addEventListener("input", () => {
  form.model.dataset.fromPreset = "0";
});

cloudSignInBtn?.addEventListener("click", async () => {
  // Same path as the Account card — Google → Cloud session token.
  const accountModeEl = document.getElementById("accountMode");
  if (accountModeEl) {
    accountModeEl.value = "cloud";
    document.getElementById("cloud-account-fields").hidden = false;
  }
  await chrome.runtime.sendMessage({
    type: "wdimtm:account-set-mode",
    payload: { mode: "cloud" },
  });
  const res = await chrome.runtime.sendMessage({ type: "wdimtm:account-sign-in" });
  if (!res?.ok) {
    flash(res?.error || t("signInFailed"), true);
    return;
  }
  await reload();
  flash(t("signedIn"));
});

/**
 * Fields whose blank form value has always meant "use the product default"
 * rather than "fall back to whatever is saved". Which fields a runtime reads
 * at all is the registry's answer, not this file's.
 */
const TEST_FIELD_FALLBACKS = {
  model: DEFAULT_SETTINGS.model,
  anthropicBaseUrl: ANTHROPIC_DEFAULTS.apiBaseUrl,
  anthropicModel: ANTHROPIC_DEFAULTS.model,
};

async function runTestConnection(mode, statusElLocal, btn) {
  statusElLocal.textContent = t("testingConnection");
  statusElLocal.style.color = "var(--muted)";
  btn.disabled = true;
  try {
    /** @type {Record<string, unknown>} */
    const payload = { mode };
    const entry = getRuntime(runtimeIdForTestMode(mode));
    for (const key of entry?.settingsKeys || []) {
      const field = form[key];
      if (!field) continue;
      payload[key] = String(field.value || "").trim() || TEST_FIELD_FALLBACKS[key] || "";
    }
    const res = await chrome.runtime.sendMessage({
      type: MSG.TEST_RUNTIME,
      payload,
    });
    const msg = res?.data?.message || res?.error || (res?.ok ? t("testOk") : t("testFailed"));
    statusElLocal.textContent = msg;
    statusElLocal.style.color = res?.ok ? "#86efac" : "#fda4af";
    const s = await getSettings();
    renderAiStatusBanner(s);
  } catch (err) {
    statusElLocal.textContent = err instanceof Error ? err.message : String(err);
    statusElLocal.style.color = "#fda4af";
  } finally {
    btn.disabled = false;
  }
}

testByokBtn?.addEventListener("click", () =>
  runTestConnection("byok", testByokStatus, testByokBtn)
);
testAnthropicBtn?.addEventListener("click", () =>
  runTestConnection("anthropic", testAnthropicStatus, testAnthropicBtn)
);
testCloudBtn?.addEventListener("click", () =>
  runTestConnection("cloud", testCloudStatus, testCloudBtn)
);

lensEditForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("lens-edit-id").value;
  const kind = document.getElementById("lens-edit-kind").value;
  const name = document.getElementById("lens-name").value.trim();
  const nameZh = document.getElementById("lens-name-zh").value.trim();
  const hint = document.getElementById("lens-hint").value.trim();
  const instructions = document.getElementById("lens-instructions").value.trim();
  if (!id || !name || !instructions) {
    flash(t("lensFieldsRequired"), true);
    return;
  }
  const s = await getSettings();
  if (kind === "builtin") {
    const lensOverrides = setLensOverride(s.lensOverrides || {}, id, {
      name,
      nameZh,
      hint,
      instructions,
    });
    await saveSettings({ lensOverrides });
    flash(t("lensOverrideSaved"));
  } else {
    const customLenses = updateCustomLens(
      id,
      { name, nameZh, hint, instructions },
      s.customLenses || []
    );
    await saveSettings({ customLenses });
    flash(t("lensSaved"));
  }
  closeLensEditor();
  await reload();
});

document.getElementById("lens-cancel-btn")?.addEventListener("click", () => {
  closeLensEditor();
});

document.getElementById("lens-reset-btn")?.addEventListener("click", async () => {
  const id = document.getElementById("lens-edit-id").value;
  if (!id) return;
  if (!confirm(t("resetLensConfirm"))) return;
  const s = await getSettings();
  const lensOverrides = clearLensOverride(s.lensOverrides || {}, id);
  await saveSettings({ lensOverrides });
  closeLensEditor();
  await reload();
  flash(t("lensReset"));
});

customLensForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("new-lens-name").value;
  const instructions = document.getElementById("new-lens-instructions").value;
  const lens = createCustomLens(name, instructions);
  const s = await getSettings();
  const customLenses = [...(s.customLenses || []), lens];
  await saveSettings({ customLenses });
  customLensForm.reset();
  await reload();
  openLensEditor({ ...lens, kind: "custom" });
  flash(t("lensAdded"));
});

document.getElementById("save-profile").addEventListener("click", async () => {
  await saveSettings({ profileText: profileTextEl.value });
  flash(t("profileSaved"));
});

memoryProviderEl.addEventListener("change", async () => {
  await saveSettings({ memoryProvider: memoryProviderEl.value });
  await renderMemories();
  flash(t("providerUpdated"));
});

memoryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const s = await getSettings();
  if (s.memoryProvider === "none") {
    flash(t("enableMemoryFirst"), true);
    return;
  }
  const type = document.getElementById("mem-type").value;
  const text = document.getElementById("mem-text").value;
  await getMemoryProvider(s.memoryProvider).add({ type, text, source: "explicit" });
  memoryForm.reset();
  await renderMemories();
  flash(t("memoryAdded"));
});

document.getElementById("clear-memories").addEventListener("click", async () => {
  if (!confirm(t("clearMemoriesConfirm"))) return;
  const s = await getSettings();
  await getMemoryProvider(s.memoryProvider).clear();
  await renderMemories();
  flash(t("memoriesCleared"));
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/** Highlight the contents-rail entry for whichever section is currently on screen. */
function bindContentsRail() {
  const links = [...document.querySelectorAll(".rail a[href^='#']")];
  if (!links.length || typeof IntersectionObserver !== "function") return;

  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const targets = [...byId.keys()]
    .map((id) => document.getElementById(id))
    .filter((el) => el !== null);

  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      // First target in document order wins, so the rail reads top-to-bottom.
      const current = targets.find((el) => visible.has(el.id));
      for (const [id, link] of byId) link.classList.toggle("is-current", id === current?.id);
    },
    { rootMargin: "-10% 0px -70% 0px" }
  );

  for (const el of targets) observer.observe(el);
}

bindContentsRail();

reload().catch((err) => flash(err instanceof Error ? err.message : String(err), true));

// Changing the theme applies immediately rather than waiting for Save — the
// control is a preview of the page it is sitting on.
document.getElementById("theme")?.addEventListener("change", (event) => {
  applyPageTheme(event.target.value);
});

// Follow the OS while the user is on "system"; an explicit choice wins.
watchSystemTheme(() => document.getElementById("theme")?.value || "system");
