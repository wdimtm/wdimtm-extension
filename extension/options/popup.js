import { browserLocale } from "../lib/host-locale.js";
import { resolveUiLocale } from "../../core/i18n.js";
import { findLens, lensLabel } from "../../core/lenses.js";
import { ot } from "../lib/options-i18n.js";
import { isRuntimeReady, runtimeToAccessMode } from "../../core/runtime-presets.js";
import { getSettings, isRestrictedUrl, saveSettings } from "../lib/settings.js";
import { addDeniedHost, normalizeHost, removeDeniedHost } from "../../core/site-scope.js";

const POPUP = {
  en: {
    lede: "Select text → pick a Lens → understand it in place.",
    s1: "Select text on the page",
    s2: "Click the WDIMTM bubble (or press ⌥⇧W)",
    s3: "Use Explain more / Why it matters / Discuss further",
    note: "If another translate extension (e.g. Trancy) steals selection UI, use ⌥⇧W or turn off its selection popup.",
    settings: "Open settings",
    aiMock: "AI: Mock demo only. Open settings for BYOK or WDIMTM Cloud.",
    aiNeedKey: "AI: API key missing. Open settings → AI access.",
    aiReadyByok: "AI: BYOK ready",
    aiReadyAnthropic: "AI: Anthropic (Claude) ready",
    aiReadyCloud: "AI: WDIMTM Cloud (in development)",
    runtimeLabel: "Runtime",
    lensLabel: "Default lens",
    memoryLabel: "Memory",
    lensAuto: "Auto",
    memoryLocal: "local",
    memoryOff: "off",
    siteOn: "Active on this site",
    siteOff: "Turned off for this site",
  },
  zh_CN: {
    lede: "选中文字 → 选择镜头 → 在页面内直接理解。",
    s1: "在页面上选中文字",
    s2: "点击 WDIMTM bubble（或按 ⌥⇧W）",
    s3: "使用展开说明 / 为什么重要 / 深入对话",
    note: "若其他划词插件（如 Trancy）抢占选区 UI，请用 ⌥⇧W，或关闭其划词弹层。",
    settings: "打开设置",
    aiMock: "AI：当前为 Mock 演示。请到设置接入 BYOK 或 WDIMTM Cloud。",
    aiNeedKey: "AI：缺少 API 密钥。打开设置 → AI 接入。",
    aiReadyByok: "AI：自备密钥已就绪",
    aiReadyAnthropic: "AI：Anthropic（Claude）已就绪",
    aiReadyCloud: "AI：WDIMTM Cloud（开发中）",
    runtimeLabel: "运行时",
    lensLabel: "默认镜头",
    memoryLabel: "记忆",
    lensAuto: "自动",
    memoryLocal: "本地",
    memoryOff: "关闭",
    siteOn: "在此站点启用",
    siteOff: "已在此站点关闭",
  },
};

const settings = await getSettings().catch(() => ({ uiLocale: "auto", runtime: "mock" }));
const locale = resolveUiLocale(settings.uiLocale, browserLocale());
const copy = POPUP[locale] || POPUP.en;
document.documentElement.lang = locale === "zh_CN" ? "zh-CN" : "en";
document.getElementById("popup-lede").textContent = copy.lede;
document.getElementById("popup-s1").textContent = copy.s1;
document.getElementById("popup-s2").textContent = copy.s2;
document.getElementById("popup-s3").textContent = copy.s3;
document.getElementById("popup-note").textContent = copy.note;
document.getElementById("popup-settings").textContent = copy.settings || ot("settings", locale);

const version =
  typeof chrome !== "undefined" ? chrome.runtime?.getManifest?.()?.version : undefined;
if (version) document.getElementById("popup-version").textContent = `v${version}`;

/** Runtime / lens / memory summary — the same three facts the options page owns. */
function setFact(labelId, valueId, label, value) {
  document.getElementById(labelId).textContent = label;
  document.getElementById(valueId).textContent = value;
}

const preferZh = locale === "zh_CN";
const lens = findLens(settings.defaultLensId || "general", settings.customLenses || [], settings.lensOverrides || {});
const lensText =
  settings.lensMode === "manual"
    ? lensLabel(lens ?? { name: settings.defaultLensId || "—" }, preferZh)
    : copy.lensAuto;

setFact("popup-runtime-label", "popup-runtime", copy.runtimeLabel, settings.runtime || "mock");
setFact("popup-lens-label", "popup-lens", copy.lensLabel, lensText);
setFact(
  "popup-memory-label",
  "popup-memory",
  copy.memoryLabel,
  settings.memoryProvider === "none" ? copy.memoryOff : copy.memoryLocal
);

const aiEl = document.getElementById("popup-ai");
if (aiEl) {
  const ready = isRuntimeReady(settings);
  const mode = runtimeToAccessMode(settings.runtime || "mock");
  if (mode === "mock" || settings.runtime === "mock") {
    aiEl.textContent = copy.aiMock;
    aiEl.classList.add("is-warn");
  } else if (!ready.ok) {
    aiEl.textContent = copy.aiNeedKey;
    aiEl.classList.add("is-error");
  } else {
    aiEl.textContent =
      mode === "cloud"
        ? copy.aiReadyCloud
        : settings.runtime === "anthropic"
          ? copy.aiReadyAnthropic
          : copy.aiReadyByok;
    aiEl.classList.add("is-ok");
  }
}

/**
 * Per-site switch.
 *
 * Turning WDIMTM off where it is unwelcome used to mean opening the options
 * page and typing the hostname into a textarea — at the moment the user is
 * annoyed by it, on the page they are annoyed on. The switch writes the same
 * `denylist`, so the options textarea stays the place to see and edit the whole
 * list; this is only the shortcut for the site in front of you.
 *
 * `activeTab` is what makes the current URL readable, and it is granted by the
 * click that opened this popup — no standing access to browsing history.
 */
async function setUpSiteToggle() {
  const row = document.getElementById("popup-site");
  const box = /** @type {HTMLInputElement | null} */ (
    document.getElementById("popup-site-enabled")
  );
  const title = document.getElementById("popup-site-title");
  const hostEl = document.getElementById("popup-site-host");
  if (!row || !box || !title || !hostEl) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const url = tab?.url || "";
  // Restricted pages never run the content script, so a switch there would be a
  // control that does nothing. Leave the row hidden instead of lying about it.
  if (!url || isRestrictedUrl(url)) return;

  let host = "";
  try {
    host = normalizeHost(new URL(url).hostname);
  } catch {
    return;
  }
  if (!host) return;

  const render = (denylist) => {
    const denied = denylist.length !== removeDeniedHost(denylist, host).length;
    box.checked = !denied;
    title.textContent = denied ? copy.siteOff : copy.siteOn;
    row.classList.toggle("is-off", denied);
  };

  let denylist = Array.isArray(settings.denylist) ? settings.denylist : [];
  render(denylist);
  hostEl.textContent = host;
  row.hidden = false;

  box.addEventListener("change", async () => {
    denylist = box.checked
      ? removeDeniedHost(denylist, host)
      : addDeniedHost(denylist, host);
    await saveSettings({ denylist });
    // The content script watches storage, so the page it is open on reacts
    // without a reload; re-rendering here just keeps the label honest.
    render(denylist);
  });
}

await setUpSiteToggle().catch(() => {
  /* A popup that cannot read the tab still shows everything else. */
});
