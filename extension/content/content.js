/**
 * Content script — selection bubble, lens switch, popover, follow-ups, streaming.
 * Classic (non-module) script for reliable MV3 injection.
 *
 * UI lives in an open Shadow DOM so host-page CSS cannot hide/zero our chrome.
 */

import * as WdimtmMarkdown from "../../core/markdown.js";
import * as WdimtmDomainLens from "../../core/domain-lenses.js";
import * as WdimtmSuggestLens from "../../core/suggest-lens.js";
import * as WdimtmImages from "../../core/images.js";
import * as WdimtmSiteScope from "../../core/site-scope.js";
import { hideStreamingTrailers } from "../../core/followups.js";
import { consumePortStream } from "../lib/port-client.js";
import { CONTENT_CSS } from "./styles.inline.js";

(() => {
  "use strict";

  // Avoid double-inject when all_frames + SPA re-runs.
  if (window.__WDIMTM_LOADED__) return;
  window.__WDIMTM_LOADED__ = true;

  const MSG = {
    EXPLAIN: "wdimtm:explain",
    GET_SETTINGS: "wdimtm:get-settings",
    OPEN_OPTIONS: "wdimtm:open-options",
    MEMORY_ADD: "wdimtm:memory-add",
    SET_DEFAULT_LENS: "wdimtm:set-default-lens",
    CHAT_LOAD: "wdimtm:chat-load",
    CHAT_SAVE: "wdimtm:chat-save",
    CHAT_THREAD_LOAD: "wdimtm:chat-thread-load",
    CHAT_THREAD_CLEAR: "wdimtm:chat-thread-clear",
    HISTORY_LOAD: "wdimtm:history-load",
    HISTORY_APPEND: "wdimtm:history-append",
  };

  const MAX_SELECTION = 4000;
  const MAX_CONTEXT = 2500;
  const NEIGHBOR_CHARS = 600;
  const HOST_ID = "wdimtm-host";
  const BUBBLE_ID = "wdimtm-bubble";
  const POPOVER_ID = "wdimtm-popover";
  const CHAT_ID = "wdimtm-chat";
  /** Floating chat popup preferred width (CSS mirror). */
  const CHAT_PANEL_WIDTH = 380;

  const ICON_IMAGE = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><rect x="1.8" y="3" width="12.4" height="10" rx="1.4"/><circle cx="5.6" cy="6.4" r="1.1"/><path d="M2.4 11.6l3.3-3 2.4 2.1 2.3-2.4 3.2 3.3"/></svg>`;

  /** @type {HTMLElement | null} */
  let host = null;
  /** @type {ShadowRoot | null} */
  let shadow = null;
  /** @type {{ selection: string, context: string, rect: DOMRect } | null} */
  let pending = null;
  /** @type {string} */
  let activeLensId = "general";
  /** @type {'auto' | 'manual'} */
  let lensMode = "auto";
  let defaultLensId = "general";
  /** Per-domain default Lens rules (#19). @type {Array<{host:string,lensId:string}>} */
  let domainLenses = [];
  let profileText = "";
  /**
   * Session pin from bubble: null | 'auto' | lens id
   * @type {string | null}
   */
  let sessionLensPick = null;
  /** @type {{ id: string, confidence?: number, reason?: string } | null} */
  let lastLensSuggestion = null;
  /** @type {Array<{ id: string, name: string, nameZh?: string, hint?: string }>} */
  let lenses = [
    { id: "general", name: "Explain", nameZh: "通俗解释", hint: "这是在说什么？" },
    { id: "sanity", name: "Sanity check", nameZh: "有没有道理", hint: "主张站得住吗？" },
    { id: "fact-check", name: "Fact check", nameZh: "核实主张", hint: "哪些能核验？" },
    { id: "opportunities", name: "Opportunities", nameZh: "找机会", hint: "有无套利/激励？" },
    { id: "engineering", name: "Engineering", nameZh: "工程视角", hint: "架构与取舍" },
    { id: "investing", name: "Investing", nameZh: "投资视角", hint: "商业与风险" },
  ];
  const preferZhUi =
    (document.documentElement?.lang || "").toLowerCase().startsWith("zh") ||
    /[\u4e00-\u9fff]/.test(document.title || "");
  let streamEnabled = true;
  /** @type {Record<string, string>} */
  let uiStrings = {};
  let extensionEnabled = true;
  /** @type {string[]} */
  let denylist = [];
  let themePref = "system";
  let hideBubbleTimer = 0;
  let showBubbleTimer = 0;
  /** @type {number[]} */
  let showRetryTimers = [];
  /** @type {chrome.runtime.Port | null} */
  let activePort = null;
  let lastRequest = null;
  let lastExplanation = "";
  /** @type {Array<{id:string,label:string,intent:string}>} */
  let lastFollowUps = [];
  /** @type {{ content: string, type: string, reason?: string } | null} */
  let lastMemorySuggestion = null;
  /** Suppress hide briefly after show — translate extensions often jostle selection. */
  let suppressHideUntil = 0;
  /** Where "Top up credits" goes when the hosted balance runs out (#41). */
  let topUpUrl = "";
  /** Research job being watched in the popover (#52). @type {any} */
  let researchJob = null;
  let researchPollTimer = 0;
  /** Whether a signed-in WDIMTM Cloud can run durable research (#52). */
  let researchReady = false;

  function ensureRoot() {
    if (host && document.documentElement.contains(host) && shadow) {
      return shadow;
    }

    // Clean stale host if DOM was replaced (SPA).
    const stale = document.getElementById(HOST_ID);
    if (stale) stale.remove();

    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-wdimtm", "1");
    // Host is an invisible fixed layer; real UI is inside shadow.
    Object.assign(host.style, {
      all: "initial",
      position: "fixed",
      inset: "0",
      width: "0",
      height: "0",
      margin: "0",
      padding: "0",
      border: "none",
      overflow: "visible",
      zIndex: "2147483646",
      pointerEvents: "none",
    });

    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = getStyles();
    shadow.appendChild(style);

    // Mount root container inside shadow (fixed full viewport, no pointer capture).
    const root = document.createElement("div");
    root.id = "wdimtm-root";
    root.setAttribute("part", "root");
    shadow.appendChild(root);

    // Prefer body so some sites' html filters don't strip us; fall back to documentElement.
    (document.body || document.documentElement).appendChild(host);
    return shadow;
  }

  function uiRoot() {
    const s = ensureRoot();
    return s.getElementById("wdimtm-root");
  }

  function qs(id) {
    return ensureRoot().getElementById(id);
  }

  function getStyles() {
    // Prefer generated bundle; fall back to minimal critical CSS.
    if (typeof CONTENT_CSS === "string" && CONTENT_CSS.length > 0) {
      return CONTENT_CSS;
    }
    return `
      #wdimtm-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;
        font-family: "Lora", Georgia, "Songti SC", serif;
        --wd-bg: #191817; --wd-fg: #f0eeea; --wd-muted: rgba(240,238,234,.62);
        --wd-rule: rgba(240,238,234,.16); --wd-accent: #e1ad66; --wd-accent-deep: #facb8d; }
      #wdimtm-root[data-theme="light"] {
        --wd-bg: #f3f2f2; --wd-fg: #201f1d; --wd-muted: rgba(32,31,29,.62);
        --wd-rule: rgba(32,31,29,.16); --wd-accent: #b68235; --wd-accent-deep: #7d5411; }
      .wdimtm-bubble-wrap { position: fixed; display: inline-flex; align-items: center; gap: 6px;
        padding: 3px 5px; border-radius: 999px; background: var(--wd-bg); border: 1px solid var(--wd-accent);
        color: var(--wd-accent-deep); box-shadow: 0 3px 10px rgba(0,0,0,.3); pointer-events: auto; }
      .wdimtm-bubble-wrap[hidden] { display: none !important; }
      .wdimtm-bubble { display: inline-flex; align-items: center; gap: 7px; height: 26px;
        padding: 0 8px 0 5px; border: 0; border-radius: 999px; background: transparent;
        color: var(--wd-accent-deep); font: 600 13px/1 "Cormorant Garamond", Palatino, Georgia, serif; cursor: pointer; }
      .wdimtm-bubble-mark { display: inline-flex; align-items: center; justify-content: center;
        width: 18px; height: 18px; border-radius: 999px; border: 1px solid var(--wd-accent);
        color: var(--wd-accent); font-weight: 600; font-size: 11px; }
      .wdimtm-lens-field { position: relative; display: inline-flex; align-items: center; max-width: 148px; height: 24px;
        border-left: 1px solid var(--wd-rule); padding: 0 20px 0 9px; }
      .wdimtm-lens-caret { position: absolute; right: 5px; font-size: 9px; color: var(--wd-muted); pointer-events: none; }
      .wdimtm-lens-select { appearance: none; -webkit-appearance: none; max-width: 120px; height: 24px; border: 0;
        background: transparent; color: var(--wd-muted); font-size: 12px; cursor: pointer; }
      .wdimtm-popover { position: fixed; max-width: min(400px, calc(100vw - 16px)); max-height: min(440px, calc(100vh - 16px));
        display: flex; flex-direction: column; overflow: hidden; border-radius: 4px;
        border: 1px solid var(--wd-rule); background: var(--wd-bg); color: var(--wd-fg);
        box-shadow: 0 12px 32px rgba(0,0,0,.4); pointer-events: auto; }
      .wdimtm-popover[hidden] { display: none !important; }
      .wdimtm-popover-header { display: flex; justify-content: space-between; align-items: center;
        gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--wd-rule); }
      .wdimtm-popover-title { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600;
        font-family: "Cormorant Garamond", Palatino, Georgia, serif; }
      .wdimtm-surface { border-radius: 4px; border: 1px solid var(--wd-rule); background: var(--wd-bg);
        color: var(--wd-fg); overflow: hidden; pointer-events: auto; }
      .wdimtm-surface-selection { padding: 11px 15px; border-bottom: 1px solid var(--wd-rule); }
      .wdimtm-surface-selection-label { font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase;
        color: var(--wd-accent); margin-bottom: 5px; }
      .wdimtm-surface-selection-body { font-size: 12px; line-height: 1.55; color: var(--wd-muted);
        max-height: 3.2em; overflow: hidden; }
      .wdimtm-mark { display: inline-flex; width: 17px; height: 17px; border-radius: 999px; align-items: center;
        justify-content: center; border: 1px solid var(--wd-accent); color: var(--wd-accent); font-size: 10px; font-weight: 600; }
      .wdimtm-icon-btn { border: 0; background: transparent; color: var(--wd-muted); width: 26px; height: 26px;
        border-radius: 2px; font-size: 17px; cursor: pointer; }
      .wdimtm-popover-body { padding: 14px; overflow: auto; font-size: 13px; line-height: 1.68; color: var(--wd-fg); }
      .wdimtm-loading { display: flex; align-items: center; gap: 10px; color: var(--wd-muted); min-height: 44px; }
      .wdimtm-spinner { width: 13px; height: 13px; border: 1px solid var(--wd-rule); border-top-color: var(--wd-accent);
        border-radius: 50%; animation: wdimtm-spin .9s linear infinite; }
      @keyframes wdimtm-spin { to { transform: rotate(360deg); } }
      .wdimtm-error { color: #f0b8b0; border: 1px solid rgba(240,184,176,.4);
        border-radius: 4px; padding: 10px 12px; font-size: 12.5px; margin-bottom: 12px; }
      .wdimtm-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .wdimtm-btn { height: 28px; padding: 0 13px; border-radius: 4px; background: transparent;
        border: 1px solid var(--wd-accent); color: var(--wd-accent-deep);
        font: 600 13px "Cormorant Garamond", Palatino, Georgia, serif; cursor: pointer; }
      .wdimtm-btn-ghost { border-color: var(--wd-rule); color: var(--wd-fg); }
      .wdimtm-followups { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; padding-top: 12px;
        border-top: 1px solid var(--wd-rule); }
      .wdimtm-chip { border: 1px solid transparent; background: rgba(128,128,128,.12); color: var(--wd-fg);
        height: 22px; padding: 0 10px; border-radius: 2px; font-size: 11px; cursor: pointer; }
      .wdimtm-meta { margin-top: 12px; padding-top: 9px; border-top: 1px solid var(--wd-rule); font-size: 10px; color: var(--wd-muted); }
      .wdimtm-toast { margin-top: 10px; padding: 6px 0; border-top: 1px solid var(--wd-rule); color: #b8d3a8; font-size: 11px; }
      .wdimtm-answer { text-align: justify; }
      .wdimtm-answer a { color: var(--wd-accent-deep); text-underline-offset: 3px; }
      .wdimtm-answer strong { font-weight: 600; }
      .wdimtm-answer code { font-family: ui-monospace, monospace; background: rgba(128,128,128,.14); padding: .1em .35em; border-radius: 2px; }
      .wdimtm-answer ul { margin: .4em 0 .6em 1.1em; padding: 0; }
    `;
  }

  function init() {
    if (isRestrictedPage()) return;
    ensureRoot();
    // Capture phase so we still see events even if another extension stops bubbling
    // (common with translate/select tools like Trancy, Immersive Translate, etc.).
    document.addEventListener("selectionchange", onSelectionChange, true);
    document.addEventListener("mouseup", onPointerUp, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize, true);
    document.addEventListener("keydown", onGlobalKeydown, true);
    document.addEventListener("mousedown", onGlobalMouseDown, true);
    document.addEventListener("pointerdown", onGlobalMouseDown, true);
    document.addEventListener("paste", onDocumentPaste, true);
    // Window-level capture as a second line if document handlers are interfered with.
    window.addEventListener("mouseup", onPointerUp, true);
    window.addEventListener("pointerup", onPointerUp, true);
    bindThemeListeners();
    applyTheme();
    refreshSettings();
  }

  function isRestrictedPage() {
    const href = location.href || "";
    return (
      href.startsWith("chrome://") ||
      href.startsWith("chrome-extension://") ||
      href.startsWith("devtools://") ||
      href.startsWith("edge://") ||
      href.startsWith("about:")
    );
  }

  function isSiteDisabled() {
    if (!extensionEnabled) return true;
    return WdimtmSiteScope.isHostDenied(location.hostname, denylist);
  }

  function resolveThemeMode() {
    let mode = themePref || "system";
    if (mode === "system") {
      mode = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
        ? "dark"
        : "light";
    }
    return mode === "light" ? "light" : "dark";
  }

  function applyTheme() {
    const root = uiRoot();
    if (!root) return;
    root.setAttribute("data-theme", resolveThemeMode());
  }

  function bindThemeListeners() {
    try {
      const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
      if (mq) {
        const onScheme = () => {
          if ((themePref || "system") === "system") applyTheme();
        };
        if (typeof mq.addEventListener === "function") {
          mq.addEventListener("change", onScheme);
        } else if (typeof mq.addListener === "function") {
          mq.addListener(onScheme);
        }
      }
    } catch {
      /* ignore */
    }
    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "sync" && area !== "local") return;
        // settings may be nested under a key or stored flat; refresh wholesale
        if (
          changes.settings ||
          changes.theme ||
          changes.defaultLensId ||
          changes.enabled ||
          changes.denylist ||
          changes.uiLocale ||
          changes.stream
        ) {
          refreshSettings();
        }
      });
    } catch {
      /* ignore */
    }
  }

  function clearShowRetries() {
    for (const id of showRetryTimers) window.clearTimeout(id);
    showRetryTimers = [];
  }

  /**
   * Re-assert the bubble several times after selection.
   * Other selection UIs (Trancy, etc.) often win the first paint or briefly
   * disturb the selection; retries make coexistence more reliable.
   */
  function scheduleBubbleShow() {
    if (isSiteDisabled()) {
      hideBubble();
      return;
    }
    window.clearTimeout(showBubbleTimer);
    clearShowRetries();
    const delays = [0, 40, 120, 280, 500];
    for (const d of delays) {
      const id = window.setTimeout(() => {
        if (getSelectionPayload()) maybeShowBubble();
      }, d);
      showRetryTimers.push(id);
    }
  }

  function refreshSettings() {
    try {
      chrome.runtime
        .sendMessage({ type: MSG.GET_SETTINGS })
        .then((res) => {
          if (!res?.ok || !res.data) return;
          defaultLensId = res.data.defaultLensId || "general";
          domainLenses = Array.isArray(res.data.domainLenses) ? res.data.domainLenses : [];
          lensMode = res.data.lensMode === "manual" ? "manual" : "auto";
          profileText = res.data.profileText || "";
          streamEnabled = res.data.stream !== false;
          extensionEnabled = res.data.enabled !== false;
          denylist = Array.isArray(res.data.denylist) ? res.data.denylist : [];
          themePref = res.data.theme || "system";
          topUpUrl = res.data.topUpUrl || "";
          researchReady = Boolean(res.data.researchReady);
          if (res.data.uiStrings && typeof res.data.uiStrings === "object") {
            uiStrings = res.data.uiStrings;
          }
          if (lensMode === "manual" && !sessionLensPick) {
            activeLensId = effectiveDefaultLensId();
          }
          applyTheme();
          if (isSiteDisabled()) {
            dismissAll();
          }
          const builtin = res.data.builtinLenses || [];
          const custom = res.data.customLenses || [];
          const merged = [...builtin, ...custom].map((l) => ({
            id: l.id,
            name: l.name || l.id,
            nameZh: l.nameZh,
            hint: l.hint,
          }));
          if (merged.length) lenses = merged;
        })
        .catch(() => {});
    } catch {
      /* extension context invalidated */
    }
  }

  function lensApi() {
    return (
      WdimtmSuggestLens ||
      null
    );
  }

  /**
   * The default that applies on *this* site: a per-domain rule if one matches,
   * otherwise the global default (#19). Resolved per call because a SPA can
   * change hostname without reloading the content script.
   */
  function effectiveDefaultLensId() {
    const api = domainLensApi();
    const available = lenses.map((l) => l.id);
    if (!api?.resolveDefaultLensId) return defaultLensId;
    return api.resolveDefaultLensId({
      hostname: location.hostname || "",
      rules: domainLenses,
      defaultLensId,
      availableLensIds: available,
    });
  }

  function domainLensApi() {
    return (
      WdimtmDomainLens || null
    );
  }

  /**
   * Resolve which lens id to send on Explain.
   * @param {string} [selection]
   */
  function resolveLensForRequest(selection) {
    const api = lensApi();
    const available = lenses.map((l) => l.id);
    const siteDefault = effectiveDefaultLensId();
    const pinned =
      sessionLensPick && sessionLensPick !== "auto" ? sessionLensPick : undefined;

    if (api?.resolveActiveLens) {
      const r = api.resolveActiveLens({
        lensMode,
        manualLensId: pinned,
        defaultLensId: siteDefault,
        selection: selection || pending?.selection || "",
        pageTitle: document.title || "",
        pageUrl: location.href || "",
        profileText,
        availableLensIds: available,
      });
      lastLensSuggestion = r.suggestion || null;
      activeLensId = r.lensId;
      return r.lensId;
    }

    // Fallback without heuristics module
    if (pinned && available.includes(pinned)) {
      activeLensId = pinned;
      return pinned;
    }
    activeLensId = available.includes(siteDefault) ? siteDefault : "general";
    return activeLensId;
  }

  function onSelectionChange() {
    window.clearTimeout(hideBubbleTimer);

    // Debounced show + retries (coexist with other selection toolbars).
    scheduleBubbleShow();

    hideBubbleTimer = window.setTimeout(() => {
      if (Date.now() < suppressHideUntil) return;
      if (!getSelectionPayload()) {
        hideBubble();
        // Don't clear pending while popover is open — follow-ups need it.
        if (!isPopoverOpen()) pending = null;
      }
    }, 220);
  }

  function onPointerUp() {
    scheduleBubbleShow();
  }

  function onKeyUp(e) {
    if (
      e.key === "Shift" ||
      e.key.startsWith("Arrow") ||
      e.key === "End" ||
      e.key === "Home" ||
      ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey))
    ) {
      scheduleBubbleShow();
    }
  }

  function isPopoverOpen() {
    const pop = qs(POPOVER_ID);
    return Boolean(pop && !pop.hidden);
  }

  function onScrollOrResize() {
    if (isChatPanelVisible()) syncChatPageLayout();
    if (!pending) return;
    const payload = getSelectionPayload();
    if (payload?.rect) {
      pending.rect = payload.rect;
      if (!isPopoverOpen()) positionBubble(payload.rect);
      else positionPopover(payload.rect);
      return;
    }
    if (!isPopoverOpen()) hideBubble();
  }

  /**
   * Read current selection from window or active input/textarea.
   * @returns {{ selection: string, context: string, rect: DOMRect } | null}
   */
  function getSelectionPayload() {
    // 1) Input / textarea
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "TEXTAREA" ||
        (active.tagName === "INPUT" &&
          /^(text|search|url|tel|password|email|number)$/i.test(active.type || "text")))
    ) {
      const el = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (active);
      if (host && (host === el || host.contains(el))) return null;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      if (end > start) {
        const text = normalizeWhitespace(el.value.slice(start, end));
        if (text.length >= 2) {
          const rect = el.getBoundingClientRect();
          if (rect.width || rect.height) {
            return {
              selection: truncate(text, MAX_SELECTION),
              context: truncate(normalizeWhitespace(el.value), MAX_CONTEXT),
              rect,
            };
          }
        }
      }
    }

    // 2) Normal DOM selection
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const anchor = selection.anchorNode;
    if (anchor && host && (host === anchor || host.contains(anchor))) return null;

    const selectedText = normalizeWhitespace(selection.toString());
    if (!selectedText || selectedText.length < 2) return null;

    const range = selection.getRangeAt(0);
    const rect = getRangeRect(range);
    if (!rect) return null;

    const context = extractNeighborhood(range, selectedText);
    return {
      selection: truncate(selectedText, MAX_SELECTION),
      context: truncate(context, MAX_CONTEXT),
      rect,
    };
  }

  /** @param {Range} range */
  function getRangeRect(range) {
    let rect = range.getBoundingClientRect();
    if (rect && (rect.width > 0 || rect.height > 0)) return rect;

    const rects = range.getClientRects();
    if (rects && rects.length) {
      // Use first non-empty client rect (common for multi-line / zero-width caret quirks).
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.width > 0 || r.height > 0) return r;
      }
      // Fallback: union of first and last
      const a = rects[0];
      const b = rects[rects.length - 1];
      const top = Math.min(a.top, b.top);
      const left = Math.min(a.left, b.left);
      const bottom = Math.max(a.bottom, b.bottom);
      const right = Math.max(a.right, b.right);
      if (bottom > top || right > left) {
        return new DOMRect(left, top, Math.max(right - left, 1), Math.max(bottom - top, 1));
      }
    }

    // Last resort: anchor element box
    const node = range.commonAncestorContainer;
    const el =
      node.nodeType === Node.ELEMENT_NODE
        ? /** @type {Element} */ (node)
        : node.parentElement;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) return r;
    }
    return null;
  }

  function maybeShowBubble() {
    if (isSiteDisabled()) {
      hideBubble();
      return;
    }
    // Don't steal focus while popover is open unless selection changed meaningfully.
    if (isPopoverOpen()) return;

    const payload = getSelectionPayload();
    if (!payload) {
      if (Date.now() >= suppressHideUntil) hideBubble();
      return;
    }
    pending = payload;
    showBubble(payload.rect);
    suppressHideUntil = Date.now() + 400;
  }

  function extractNeighborhood(range, selectedText) {
    // Prefer social/post containers (X/Twitter, etc.) before generic blocks.
    const post = nearestPostContainer(range.commonAncestorContainer);
    if (post) {
      const postText = normalizeWhitespace(post.innerText || post.textContent || "");
      if (postText) {
        if (postText.length <= MAX_CONTEXT) return postText;
        return sliceAroundMatch(postText, selectedText, Math.min(NEIGHBOR_CHARS * 2, 1200));
      }
    }

    const block = nearestBlock(range.commonAncestorContainer);
    if (block) {
      const blockText = normalizeWhitespace(block.innerText || block.textContent || "");
      if (blockText && blockText.length <= MAX_CONTEXT) return blockText;
      if (blockText) return sliceAroundMatch(blockText, selectedText, NEIGHBOR_CHARS);
    }
    const bodyText = normalizeWhitespace(document.body?.innerText || "");
    return sliceAroundMatch(bodyText, selectedText, NEIGHBOR_CHARS);
  }

  /**
   * Find a post/tweet/article-like container for better context on social sites.
   * @param {Node} node
   * @returns {HTMLElement | null}
   */
  function nearestPostContainer(node) {
    /** @type {Element | null} */
    let current =
      node.nodeType === Node.ELEMENT_NODE
        ? /** @type {Element} */ (node)
        : node.parentElement;

    while (current && current !== document.body && current !== document.documentElement) {
      if (current instanceof HTMLElement) {
        const testId = current.getAttribute("data-testid") || "";
        const role = current.getAttribute("role") || "";
        const tag = current.tagName;

        // X/Twitter-ish
        if (
          testId === "tweetText" ||
          testId === "tweet" ||
          testId === "cellInnerDiv" ||
          role === "article" ||
          tag === "ARTICLE"
        ) {
          // Prefer the full article/tweet over just tweetText when possible.
          if (testId === "tweetText") {
            const article = current.closest('article, [data-testid="tweet"], [role="article"]');
            if (article instanceof HTMLElement) {
              const t = (article.innerText || "").trim();
              if (t.length > 0 && t.length <= MAX_CONTEXT * 2) return article;
            }
          }
          const t = (current.innerText || "").trim();
          if (t.length > 0) return current;
        }

        // Generic post/card patterns
        if (
          current.matches?.(
            '[itemprop="articleBody"], .post-content, .entry-content, .tweet-text, [data-contents]'
          )
        ) {
          const t = (current.innerText || "").trim();
          if (t.length > 20 && t.length <= MAX_CONTEXT * 2) return current;
        }
      }
      current = current.parentElement;
    }
    return null;
  }

  function nearestBlock(node) {
    let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const blockTags = new Set([
      "P", "LI", "BLOCKQUOTE", "PRE", "ARTICLE", "SECTION",
      "TD", "TH", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6", "DIV", "SPAN",
    ]);
    while (current && current !== document.body) {
      if (
        current instanceof HTMLElement &&
        blockTags.has(current.tagName) &&
        (current.innerText || "").trim().length > 0
      ) {
        // On X, text often lives in nested spans — climb to a richer parent.
        if (current.tagName === "SPAN") {
          const len = (current.innerText || "").length;
          if (len < selectedTextLength(current) * 1.2) {
            // keep climbing if this span is basically just the selection
            current = current.parentElement;
            continue;
          }
        }
        if (current.tagName === "DIV" || current.tagName === "SPAN") {
          const len = (current.innerText || "").length;
          if (len > MAX_CONTEXT * 2) {
            current = current.parentElement;
            continue;
          }
        }
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  /** @param {HTMLElement} el */
  function selectedTextLength(el) {
    return (el.innerText || "").trim().length;
  }

  function sliceAroundMatch(text, needle, radius) {
    const idx = text.indexOf(needle.slice(0, Math.min(needle.length, 80)));
    if (idx < 0) return truncate(text, radius * 2);
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + needle.length + radius);
    let slice = text.slice(start, end);
    if (start > 0) slice = "…" + slice;
    if (end < text.length) slice = slice + "…";
    return slice;
  }

  function normalizeWhitespace(s) {
    return s.replace(/\s+/g, " ").trim();
  }

  function truncate(s, max) {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  // ── bubble ─────────────────────────────────────────────────

  function showBubble(rect) {
    const root = uiRoot();
    if (!root) return;

    let bubble = qs(BUBBLE_ID);
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.id = BUBBLE_ID;
      bubble.className = "wdimtm-bubble-wrap";
      bubble.innerHTML = `
        <button type="button" class="wdimtm-bubble" data-action="explain" aria-label="What does this mean to me?">
          <span class="wdimtm-bubble-mark">?</span>
          <span class="wdimtm-bubble-label">WDIMTM</span>
        </button>
        <button type="button" class="wdimtm-bubble-chat" data-action="open-chat" title="Chat" aria-label="Open page chat">
          💬
        </button>
        <label class="wdimtm-lens-field" title="选择解读方式 / Choose how to read this">
          <span class="wdimtm-lens-caret" aria-hidden="true">▾</span>
          <select class="wdimtm-lens-select" data-action="lens" aria-label="解读方式"></select>
        </label>
      `;
      bubble.addEventListener("mousedown", (e) => {
        // Keep selection; but allow the <select> to open normally.
        const t = e.target;
        if (t instanceof Element && t.closest("select")) return;
        e.preventDefault();
        e.stopPropagation();
      });
      bubble.addEventListener("pointerdown", (e) => {
        const t = e.target;
        if (t instanceof Element && t.closest("select")) return;
        e.preventDefault();
        e.stopPropagation();
      });
      bubble.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.closest("select") || t.closest(".wdimtm-lens-field")) return;
        if (t.closest("[data-action='open-chat']")) {
          e.preventDefault();
          e.stopPropagation();
          // Same floating surface as explain escalate — bind current selection.
          escalateToChat({ seedFromExplain: true });
          return;
        }
        if (t.closest("[data-action='explain']")) {
          e.preventDefault();
          e.stopPropagation();
          runExplain("explain");
        }
      });
      bubble.addEventListener("change", (e) => {
        const t = e.target;
        if (t instanceof HTMLSelectElement && t.matches("[data-action='lens']")) {
          const v = t.value;
          sessionLensPick = v;
          if (v === "auto") {
            resolveLensForRequest(pending?.selection || "");
          } else {
            activeLensId = v;
            // Persist explicit pick as default only in manual mode. The hostname
            // rides along so the pick lands where the default came from: a site
            // with its own rule updates that rule instead of silently
            // overwriting the global default (#19).
            if (lensMode === "manual") {
              try {
                chrome.runtime
                  .sendMessage({
                    type: MSG.SET_DEFAULT_LENS,
                    payload: { id: activeLensId, hostname: location.hostname || "" },
                  })
                  .catch(() => {});
              } catch {
                /* ignore */
              }
            }
          }
          fillLensSelect(t);
        }
      });
      root.appendChild(bubble);
    }

    // Refresh auto suggestion for this selection before painting options
    if (lensMode === "auto" && (!sessionLensPick || sessionLensPick === "auto")) {
      resolveLensForRequest(pending?.selection || "");
    }
    fillLensSelect(bubble.querySelector(".wdimtm-lens-select"));
    bubble.style.pointerEvents = "auto";
    bubble.hidden = false;
    // Inline fallbacks so we stay visible even if CSS fails to load.
    bubble.style.position = "fixed";
    bubble.style.zIndex = "2147483647";
    positionBubble(rect);
  }

  function fillLensSelect(select) {
    if (!select) return;
    // Prefer Chinese labels when page looks Chinese (e.g. X 中文帖).
    const useZh =
      preferZhUi ||
      (pending && /[\u4e00-\u9fff]/.test(pending.selection || ""));

    const labelOf = (id) => {
      const l = lenses.find((x) => x.id === id);
      if (!l) return id;
      return useZh && l.nameZh ? l.nameZh : l.name;
    };

    /** @type {string[]} */
    const parts = [];

    if (lensMode === "auto") {
      // Ensure suggestion is current
      if (!sessionLensPick || sessionLensPick === "auto") {
        resolveLensForRequest(pending?.selection || "");
      }
      const sugId = lastLensSuggestion?.id || activeLensId || "general";
      const autoLabel = useZh
        ? `自动 · ${labelOf(sugId)}`
        : `Auto · ${labelOf(sugId)}`;
      const autoSelected =
        !sessionLensPick || sessionLensPick === "auto" ? " selected" : "";
      parts.push(
        `<option value="auto"${autoSelected} title="${escapeAttr(
          useZh ? "根据选区智能选择镜头（可改）" : "Suggest lens from selection (changeable)"
        )}">${escapeHtml(autoLabel)}</option>`
      );
    }

    for (const l of lenses) {
      const label = useZh && l.nameZh ? l.nameZh : l.name;
      const title = l.hint ? ` title="${escapeAttr(l.hint)}"` : "";
      let selected = false;
      if (lensMode === "manual") {
        selected =
          l.id ===
          (sessionLensPick && sessionLensPick !== "auto"
            ? sessionLensPick
            : effectiveDefaultLensId() || activeLensId);
      } else {
        selected = sessionLensPick === l.id;
      }
      parts.push(
        `<option value="${escapeAttr(l.id)}"${selected ? " selected" : ""}${title}>${escapeHtml(
          label
        )}</option>`
      );
    }
    select.innerHTML = parts.join("");
  }

  function positionBubble(rect) {
    const bubble = qs(BUBBLE_ID);
    if (!bubble) return;
    const gap = 8;
    const bw = bubble.offsetWidth || 180;
    const bh = bubble.offsetHeight || 34;
    // Prefer ABOVE + slightly LEFT of selection.
    // Translate tools (Trancy etc.) often pin a small icon at the selection END;
    // anchoring left reduces overlap.
    let top = rect.top - bh - gap;
    let left = rect.left - 4;
    if (top < 8) top = rect.bottom + gap + 28; // extra offset below end-icons
    if (left + bw > window.innerWidth - 8) left = window.innerWidth - bw - 8;
    left = Math.max(8, left);
    top = Math.max(8, Math.min(top, window.innerHeight - bh - 8));
    bubble.style.top = `${Math.round(top)}px`;
    bubble.style.left = `${Math.round(left)}px`;
  }

  function hideBubble() {
    const bubble = qs(BUBBLE_ID);
    if (bubble) bubble.hidden = true;
  }

  // ── popover ────────────────────────────────────────────────

  function showPopover(rect, state) {
    const root = uiRoot();
    if (!root) return;
    hideBubble();
    let pop = qs(POPOVER_ID);
    if (!pop) {
      pop = document.createElement("div");
      pop.id = POPOVER_ID;
      pop.className = "wdimtm-popover wdimtm-surface";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "WDIMTM explanation");
      root.appendChild(pop);
    }
    pop.style.pointerEvents = "auto";
    pop.style.position = "fixed";
    pop.style.zIndex = "2147483647";
    pop.hidden = false;
    renderPopover(pop, state);
    positionPopover(rect);
  }

  function tr(key, fallback) {
    return uiStrings[key] || fallback;
  }

  function renderPopover(pop, state) {
    const selText = String(
      pending?.selection || lastRequest?.selection || ""
    ).trim();
    const selPreview = selText.slice(0, 160);
    const selectionStrip = selPreview
      ? `<div class="wdimtm-surface-selection">
          <div class="wdimtm-surface-selection-label">${escapeHtml(
            tr("chatSelection", "Selection")
          )}</div>
          <div class="wdimtm-surface-selection-body">${escapeHtml(selPreview)}${
            selText.length > 160 ? "…" : ""
          }</div>
        </div>`
      : "";

    const header = `
      <div class="wdimtm-popover-header wdimtm-surface-header">
        <div class="wdimtm-popover-title wdimtm-surface-title">
          <span class="wdimtm-mark">?</span>
          <span>${escapeHtml(tr("popoverTitle", "What does it mean to me?"))}</span>
        </div>
        <button type="button" class="wdimtm-icon-btn" data-action="close" aria-label="${escapeAttr(
          tr("close", "Close")
        )}">×</button>
      </div>${selectionStrip}`;

    let body = "";
    if (state.kind === "loading") {
      body = `
        <div class="wdimtm-popover-body">
          <div class="wdimtm-loading">
            <span class="wdimtm-spinner" aria-hidden="true"></span>
            <span>${escapeHtml(
              state.message || tr("loadingExplain", "Understanding selection…")
            )}</span>
          </div>
          <div class="wdimtm-actions wdimtm-toolbar">
            <button type="button" class="wdimtm-btn wdimtm-btn-ghost" data-action="cancel">${escapeHtml(
              tr("cancel", "Cancel")
            )}</button>
          </div>
        </div>`;
    } else if (state.kind === "streaming" || state.kind === "ok") {
      const actions = normalizeFollowUpList(state.followUps);
      const follow =
        state.kind === "ok" && actions.length
          ? `<div class="wdimtm-followups">${actions
              .map(
                (f) =>
                  `<button type="button" class="wdimtm-chip" data-action="followup" data-intent="${escapeAttr(
                    f.intent
                  )}" data-followup="${escapeAttr(f.label)}" data-question="${escapeAttr(
                    f.question || f.label || ""
                  )}">${escapeHtml(f.label)}</button>`
              )
              .join("")}</div>`
          : state.kind === "streaming"
            ? `<div class="wdimtm-followups"><span class="wdimtm-streaming-hint">${escapeHtml(
                tr("streaming", "Streaming…")
              )}</span></div>`
            : "";
      const memSug = state.memorySuggestion;
      const memBlock =
        state.kind === "ok" && memSug && !state.remembered
          ? `<div class="wdimtm-memory-suggest" role="region" aria-label="${escapeAttr(
              tr("rememberPromptTitle", "Remember this?")
            )}">
              <div class="wdimtm-memory-suggest-title">${escapeHtml(
                tr("rememberPromptTitle", "Remember this?")
              )}</div>
              <div class="wdimtm-memory-suggest-body">${escapeHtml(memSug.content)}</div>
              ${
                memSug.reason
                  ? `<div class="wdimtm-memory-suggest-reason">${escapeHtml(memSug.reason)}</div>`
                  : ""
              }
              <div class="wdimtm-actions">
                <button type="button" class="wdimtm-btn" data-action="mem-accept">${escapeHtml(
                  tr("rememberAccept", "Remember")
                )}</button>
                <button type="button" class="wdimtm-btn wdimtm-btn-ghost" data-action="mem-dismiss">${escapeHtml(
                  tr("rememberDismiss", "Not now")
                )}</button>
              </div>
            </div>`
          : "";
      const isMock = state.runtime === "mock";
      const runtime = state.runtime
        ? `<div class="wdimtm-meta">via ${escapeHtml(state.runtime)}${
            state.lensId ? ` · ${escapeHtml(state.lensId)}` : ""
          }</div>`
        : "";
      // The demo notice sits ABOVE the answer: a reader must not take sample
      // output for a real explanation and only find out in the footer.
      const demoBanner = isMock
        ? `<div class="wdimtm-demo-banner" role="status">
            <div class="wdimtm-demo-banner-title">${escapeHtml(
              tr("mockDemoTitle", "Sample answer — not a real explanation")
            )}</div>
            <div class="wdimtm-demo-banner-body">${escapeHtml(
              tr(
                "mockDemoNote",
                "The mock runtime produces placeholder text. Add your own AI access to explain this selection for real."
              )
            )}</div>
            <div class="wdimtm-actions">
              <button type="button" class="wdimtm-btn" data-action="options">${escapeHtml(
                tr("configureAi", "Configure AI access")
              )}</button>
            </div>
          </div>`
        : "";
      const rememberNote = state.remembered
        ? `<div class="wdimtm-toast">${escapeHtml(tr("remembered", "Saved to local memory."))}</div>`
        : "";
      const toolbar =
        state.kind === "ok"
          ? `<div class="wdimtm-actions wdimtm-toolbar">
              <button type="button" class="wdimtm-btn" data-action="discuss">${escapeHtml(
                tr("discussFurther", "Discuss further")
              )}</button>
              <button type="button" class="wdimtm-btn wdimtm-btn-ghost" data-action="copy">${escapeHtml(
                tr("copy", "Copy")
              )}</button>
              ${
                researchReady
                  ? `<button type="button" class="wdimtm-btn wdimtm-btn-ghost" data-action="research" title="${escapeAttr(
                      tr(
                        "researchHint",
                        "Runs in WDIMTM Cloud and keeps going after you close this page."
                      )
                    )}">${escapeHtml(tr("researchThis", "Research this"))}</button>`
                  : ""
              }
            </div>`
          : state.kind === "streaming" || state.kind === "loading"
            ? `<div class="wdimtm-actions wdimtm-toolbar">
              <button type="button" class="wdimtm-btn wdimtm-btn-ghost" data-action="cancel">${escapeHtml(
                tr("cancel", "Cancel")
              )}</button>
            </div>`
            : "";
      body = `
        <div class="wdimtm-popover-body">
          ${demoBanner}
          <div class="wdimtm-answer">${formatAnswer(state.explanation || "")}</div>
          ${rememberNote}
          ${memBlock}
          ${follow}
          ${toolbar}
          ${runtime}
        </div>`;
    } else if (state.kind === "research") {
      body = renderResearchBody(state.job);
    } else if (state.kind === "error") {
      body = `
        <div class="wdimtm-popover-body">
          <div class="wdimtm-error">${escapeHtml(state.message)}</div>
          <div class="wdimtm-actions">${errorActions(state.code)}</div>
        </div>`;
    }

    pop.innerHTML = header + body;
    pop.querySelectorAll("[data-action]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = el.getAttribute("data-action");
        if (action === "close") {
          abortStream();
          dismissAll();
        }
        if (action === "retry") runExplain("explain");
        if (action === "options") {
          try {
            chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }).catch(() => {});
          } catch {
            /* ignore */
          }
        }
        if (action === "followup") {
          onFollowup(
            el.getAttribute("data-intent") || "",
            el.getAttribute("data-followup") || "",
            el.getAttribute("data-question") || ""
          );
        }
        if (action === "discuss") {
          escalateToChat({ seedFromExplain: true });
        }
        if (action === "top-up" && topUpUrl) {
          window.open(topUpUrl, "_blank", "noopener,noreferrer");
        }
        if (action === "mem-accept") acceptMemorySuggestion();
        if (action === "mem-dismiss") dismissMemorySuggestion();
        if (action === "copy") copyAnswer();
        if (action === "research") startResearchJob();
        if (action === "research-cancel") cancelResearch();
        if (action === "cancel") {
          abortStream();
          dismissAll();
        }
      });
    });
  }

  /** Compact explain → expanded page chat (same surface language). */
  function escalateToChat(opts = {}) {
    abortStream();
    hidePopover();
    hideBubble();
    openChatPanel({
      seedFromExplain: opts.seedFromExplain !== false,
      escalate: true,
      fromSelection: true,
    });
  }

  /**
   * What the user can actually do about this failure (#18, #41).
   *
   * Running out of credits is not the same kind of problem as a wrong key or a
   * dropped connection, and offering "Retry" for all three teaches people that
   * the buttons mean nothing.
   *
   * @param {string} [code] from classifyRuntimeError
   */
  function errorActions(code) {
    const btn = (action, key, fallback, primary = false) =>
      `<button type="button" class="wdimtm-btn${
        primary ? "" : " wdimtm-btn-ghost"
      }" data-action="${action}">${escapeHtml(tr(key, fallback))}</button>`;

    if (code === "quota") {
      // Two real ways out, and neither of them is retrying the same request.
      return (
        (topUpUrl ? btn("top-up", "topUp", "Top up credits", true) : "") +
        btn("options", "useOwnKey", "Use my own API key", !topUpUrl) +
        btn("retry", "retry", "Retry")
      );
    }
    if (code === "unauthorized" || code === "missing_key" || code === "forbidden") {
      return (
        btn("options", "openSettings", "Open settings", true) +
        btn("retry", "retry", "Retry")
      );
    }
    return btn("retry", "retry", "Retry", true) + btn("options", "settings", "Settings");
  }

  /**
   * A research job is a durable object, so the popover shows its state rather
   * than pretending to be a request that is still in flight.
   * @param {any} job
   */
  function renderResearchBody(job) {
    const state = job?.state || "queued";
    const done = state === "succeeded";
    const stopped = state === "failed" || state === "canceled";

    const header = `<div class="wdimtm-meta">${escapeHtml(
      tr("researchTitle", "Research job")
    )} · ${escapeHtml(researchStateLabel(state))}</div>`;

    const goal = job?.goal
      ? `<div class="wdimtm-answer"><strong>${escapeHtml(job.goal)}</strong></div>`
      : "";

    const steps = Array.isArray(job?.steps) && job.steps.length
      ? `<ul class="wdimtm-research-steps">${job.steps
          .slice(-6)
          .map((s) => `<li>${escapeHtml(s.label || "")}</li>`)
          .join("")}</ul>`
      : "";

    let main = "";
    if (done) {
      const result = job.result || {};
      const sources = Array.isArray(result.sources) ? result.sources : [];
      main = `
        <div class="wdimtm-answer">${formatAnswer(result.detail || result.summary || "")}</div>
        ${
          sources.length
            ? `<div class="wdimtm-research-sources">
                 <div class="wdimtm-meta">${escapeHtml(tr("sources", "Sources"))}</div>
                 <ol>${sources
                   .map(
                     (s) =>
                       `<li><a href="${escapeAttr(s.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(
                         s.title || s.url
                       )}</a></li>`
                   )
                   .join("")}</ol>
               </div>`
            : ""
        }`;
    } else if (stopped) {
      main = `<div class="wdimtm-error">${escapeHtml(
        job?.error?.message || tr("researchStopped", "Research stopped.")
      )}</div>`;
    } else {
      main = `
        <div class="wdimtm-loading">
          <span class="wdimtm-spinner" aria-hidden="true"></span>
          <span>${escapeHtml(
            tr("researchRunning", "Researching… you can close this page; the job keeps running.")
          )}</span>
        </div>`;
    }

    const actions = done || stopped
      ? `<button type="button" class="wdimtm-btn wdimtm-btn-ghost" data-action="copy">${escapeHtml(
          tr("copy", "Copy")
        )}</button>`
      : `<button type="button" class="wdimtm-btn wdimtm-btn-ghost" data-action="research-cancel">${escapeHtml(
          tr("cancel", "Cancel")
        )}</button>`;

    return `
      <div class="wdimtm-popover-body">
        ${header}
        ${goal}
        ${main}
        ${steps}
        <div class="wdimtm-actions wdimtm-toolbar">${actions}</div>
      </div>`;
  }

  /** @param {string} state */
  function researchStateLabel(state) {
    const key = `researchState_${state}`;
    return tr(key, state);
  }

  function showResearch(job) {
    researchJob = job;
    if (job?.result?.detail || job?.result?.summary) {
      lastExplanation = job.result.detail || job.result.summary;
    }
    const rect = pending?.rect || lastRequest?._rect;
    if (rect) showPopover(rect, { kind: "research", job });
  }

  function stopResearchPolling() {
    if (researchPollTimer) {
      window.clearTimeout(researchPollTimer);
      researchPollTimer = 0;
    }
  }

  /**
   * Explain → Research. The selection, page context and lens the user is
   * already looking at become the job's input; the service worker adds the
   * personal context.
   */
  async function startResearchJob() {
    const request = lastRequest;
    if (!request?.selection) return;
    stopResearchPolling();
    const rect = pending?.rect || lastRequest?._rect;
    if (rect) {
      showPopover(rect, {
        kind: "research",
        job: { state: "queued", goal: tr("researchStarting", "Starting research…") },
      });
    }

    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.RESEARCH_START,
        payload: {
          selection: request.selection,
          page: request.page,
          lens: request.lens,
          mode: activeLensId === "opportunities" ? "opportunity" : "research",
        },
      });
      if (!res?.ok) throw new Error(res?.error || "Could not start research.");
      showResearch(res.data);
      pollResearch();
    } catch (err) {
      if (rect) {
        showPopover(rect, {
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  function pollResearch() {
    stopResearchPolling();
    const id = researchJob?.id;
    if (!id) return;
    researchPollTimer = window.setTimeout(async () => {
      try {
        const res = await chrome.runtime.sendMessage({
          type: MSG.RESEARCH_GET,
          payload: { id },
        });
        if (!res?.ok) return;
        const job = res.data;
        // Only repaint while this job is still the one on screen.
        if (researchJob?.id !== job.id) return;
        showResearch(job);
        if (!["succeeded", "failed", "canceled"].includes(job.state)) pollResearch();
      } catch {
        /* popover closed or extension reloaded */
      }
    }, 2500);
  }

  async function cancelResearch() {
    const id = researchJob?.id;
    stopResearchPolling();
    if (!id) return;
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.RESEARCH_CANCEL,
        payload: { id },
      });
      if (res?.ok) showResearch(res.data);
    } catch {
      /* ignore */
    }
  }

  async function copyAnswer() {
    const text = lastExplanation || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const btn = qs(POPOVER_ID)?.querySelector('[data-action="copy"]');
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = tr("copied", "Copied");
        window.setTimeout(() => {
          if (btn.isConnected) btn.textContent = prev;
        }, 1200);
      }
    } catch {
      /* clipboard may be blocked */
    }
  }

  /**
   * @param {unknown} raw
   * @returns {Array<{id:string,label:string,intent:string,question?:string}>}
   */
  function normalizeFollowUpList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item, i) => {
        if (typeof item === "string") {
          const intent = intentFromLabel(item);
          return {
            id: `fu-${i}`,
            label: item,
            intent,
            question: intent === "probe" ? item : undefined,
          };
        }
        if (item && typeof item === "object") {
          const label = String(item.label || item.id || "Action");
          const intent = String(item.intent || intentFromLabel(label));
          return {
            id: String(item.id || `fu-${i}`),
            label,
            intent,
            question:
              item.question != null
                ? String(item.question)
                : intent === "probe"
                  ? label
                  : undefined,
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  function intentFromLabel(label) {
    const l = String(label).toLowerCase();
    if (l.includes("remember") || l.includes("记住")) return "remember";
    if (l.includes("discuss") || l.includes("对话") || l.includes("chat") || l.includes("深入"))
      return "discuss";
    if (l.includes("summar") || l.includes("总结") || l.includes("摘要")) return "summarize";
    if (l.includes("verify") || l.includes("核实") || l.includes("核验") || l.includes("靠谱"))
      return "verify";
    if (l.includes("why") || l.includes("重要") || l.includes("matter")) return "why";
    if (l.includes("simpl") || l.includes("简单")) return "simplify";
    if (l.includes("opportunit") || l.includes("机会")) return "opportunities";
    if (l.includes("research") || l.includes("研究")) return "research";
    if (l.includes("more") || l.includes("展开") || l.includes("更深")) return "more";
    if (
      l.includes("?") ||
      l.includes("？") ||
      /^(what|how|why|when|where|who|is |are |can |does )/i.test(l) ||
      /^(什么|怎么|为何|如何|哪些|有没有|能否)/.test(l)
    ) {
      return "probe";
    }
    return "probe";
  }

  async function onFollowup(intent, label, question) {
    const i = intent || intentFromLabel(label);
    if (i === "remember") {
      await rememberLast();
      return;
    }
    if (i === "discuss") {
      escalateToChat({ seedFromExplain: true });
      return;
    }
    if (i === "summarize") {
      runExplain("summarize");
      return;
    }
    if (i === "opportunities") {
      sessionLensPick = "opportunities";
      activeLensId = "opportunities";
      runExplain("explain");
      return;
    }
    if (i === "simplify") {
      runExplain("simplify");
      return;
    }
    if (i === "research") {
      runExplain("more");
      return;
    }
    if (i === "probe" || i === "ask") {
      runExplain("probe", {
        followUpQuestion: question || label || "",
      });
      return;
    }
    if (i === "more" || i === "why" || i === "verify" || i === "research" || i === "opportunity") {
      // normalizeMode maps why → why_it_matters in the adapter
      runExplain(i === "why" ? "why_it_matters" : i);
    }
  }

  // ── Page chat panel (escalation from popover) ───────────────

  /** @type {{
   *  messages: Array<{role:string, content:string, webSearch?: object}>,
   *  selection: string,
   *  page: {url:string, title:string, context?:string},
   *  lensId: string,
   *  seedExplanation?: string,
   *  history?: Array<{id:string, selection:string, explanation:string, lensId?:string}>,
   * } | null} */
  let chatState = null;
  let chatBusy = false;
  /** @type {chrome.runtime.Port | null} */
  let activeChatPort = null;
  /** Collapsed floating FAB; thread stays loaded. */
  let chatCollapsed = false;
  /** Images staged for the next turn (upload / paste / drop). */
  let composerAttachments = [];
  /** Transient composer message — attachment rejected, too many, … */
  let composerNotice = "";
    function imageHelpers() {
    return WdimtmImages || null;
  }

  function maxAttachments() {
    return imageHelpers()?.MAX_ATTACHMENTS || 4;
  }

  /** @param {string} text */
  function setComposerNotice(text) {
    composerNotice = text || "";
    renderChatPanel();
  }

  function clearComposerAttachments() {
    composerAttachments = [];
    composerNotice = "";
  }

  /**
   * @param {Iterable<File>} files
   * @param {'upload' | 'paste' | 'drop'} source
   */
  async function addAttachmentFiles(files, source) {
    const img = imageHelpers();
    if (!img) return;
    const list = Array.from(files || []);
    if (!list.length) return;

    const room = maxAttachments() - composerAttachments.length;
    if (room <= 0) {
      setComposerNotice(
        tr("attachTooMany", "Up to {n} images per message.").replace(
          "{n}",
          String(maxAttachments())
        )
      );
      return;
    }

    let added = 0;
    let lastError = "";
    for (const file of list.slice(0, room)) {
      try {
        composerAttachments.push(await img.fileToAttachment(file, source));
        added += 1;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (added && list.length > room) {
      composerNotice = tr("attachTooMany", "Up to {n} images per message.").replace(
        "{n}",
        String(maxAttachments())
      );
    } else if (!added) {
      composerNotice =
        lastError || tr("attachFailed", "That image could not be attached.");
    } else {
      composerNotice = "";
    }
    renderChatPanel({ focusInput: true });
  }

  /** @param {string} id */
  function removeAttachment(id) {
    composerAttachments = composerAttachments.filter((a) => a.id !== id);
    renderChatPanel({ focusInput: true });
  }

  /**
   * The panel re-renders on every turn, so thumbnails use the small preview
   * rather than the model-sized payload. A resumed thread has only the preview.
   * @param {Array<{ id: string, name: string, dataUrl?: string, previewUrl?: string }>} [attachments]
   */
  function renderMessageAttachments(attachments) {
    if (!attachments?.length) return "";
    const items = attachments
      .map((a) => {
        const src = a.previewUrl || a.dataUrl;
        return src
          ? `<img class="wdimtm-chat-attachment" src="${escapeAttr(
              src
            )}" alt="${escapeAttr(a.name || "image")}" />`
          : `<span class="wdimtm-chat-attachment-stub">${escapeHtml(
              a.name || "image"
            )}</span>`;
      })
      .join("");
    return `<div class="wdimtm-chat-attachments">${items}</div>`;
  }

  /** Staged attachments above the input, each removable. */
  function renderComposerAttachments() {
    if (!composerAttachments.length) return "";
    const items = composerAttachments
      .map(
        (a) => `<span class="wdimtm-chat-attach-item">
          <img src="${escapeAttr(a.previewUrl || a.dataUrl)}" alt="${escapeAttr(
            a.name || "image"
          )}" />
          <button
            type="button"
            data-chat-action="remove-attachment"
            data-attachment-id="${escapeAttr(a.id)}"
            aria-label="${escapeAttr(tr("attachRemove", "Remove image"))}"
            title="${escapeAttr(tr("attachRemove", "Remove image"))}"
          >×</button>
        </span>`
      )
      .join("");
    return `<div class="wdimtm-chat-attach-strip">${items}</div>`;
  }

  /**
   * A system screenshot (⌘⇧4 / PrtSc) arrives as a clipboard image, so pasting
   * into the composer is the screenshot path.
   *
   * Chrome fires `paste` only at an editable target, so this can only be a
   * paste into our own textarea — which is why the panel focuses it on open.
   * Clipboard events are composed, so it reaches the document even though the
   * textarea lives in a shadow root. A page's own field pasting into itself is
   * left alone.
   *
   * @param {ClipboardEvent} e
   */
  function onDocumentPaste(e) {
    if (!chatState || chatBusy) return;
    const panel = qs(CHAT_ID);
    if (!panel || panel.hidden || chatCollapsed) return;
    if (!isOwnComposer(e.composedPath?.()[0] ?? e.target)) return;
    const files = imageHelpers()?.imageFilesFrom(e.clipboardData) || [];
    if (!files.length) return;
    e.preventDefault();
    addAttachmentFiles(files, "paste");
  }

  /** @param {EventTarget | null} target */
  function isOwnComposer(target) {
    return (
      target instanceof HTMLTextAreaElement &&
      target.classList.contains("wdimtm-chat-input")
    );
  }
  /** Composer text carried across the innerHTML rebuilds in renderChatPanel. */
  let chatDraft = "";
  /**
   * The composer is `disabled` while a turn streams, and disabled elements drop
   * focus — so a focus snapshot alone cannot survive a turn. Track the intent
   * instead and hand focus back once the reply lands.
   */
  let chatWantsFocus = false;
  /** Scroll position + stuck-to-bottom flag captured before each re-render. */
  let chatScroll = { top: 0, atBottom: true };

  /** Distance from the bottom that still counts as "following the stream". */
  const CHAT_STICK_PX = 48;

  /**
   * The panel lives in a shadow root, so document.activeElement is only ever the
   * host element. Ask the shadow root itself — note uiRoot() is the inner div,
   * which has no activeElement at all.
   */
  function chatShadowActiveElement() {
    try {
      return ensureRoot()?.activeElement || null;
    } catch {
      return null;
    }
  }

  function captureChatScroll(panel) {
    const scroller = panel.querySelector("#wdimtm-chat-messages");
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    chatScroll = { top: scroller.scrollTop, atBottom: distance <= CHAT_STICK_PX };
  }

  /**
   * Follow the conversation only when the reader was already at the bottom.
   * Scrolled up to re-read something → stay put.
   */
  function restoreChatScroll(scroller) {
    if (chatScroll.atBottom) scroller.scrollTop = scroller.scrollHeight;
    else scroller.scrollTop = chatScroll.top;
  }

  function isChatPanelVisible() {
    const panel = qs(CHAT_ID);
    return Boolean(panel && !panel.hidden);
  }

  /**
   * Floating popup does not reflow the host page. Only toggles collapsed class
   * and clears any legacy inset styles from older rail builds.
   */
  function syncChatPageLayout() {
    const panel = qs(CHAT_ID);
    releaseChatPageInset();
    if (!panel || panel.hidden) {
      if (panel) {
        panel.style.removeProperty("width");
        panel.style.removeProperty("height");
        panel.classList.remove("wdimtm-chat--collapsed");
      }
      return;
    }
    panel.classList.toggle("wdimtm-chat--collapsed", chatCollapsed);
    panel.style.removeProperty("width");
    panel.style.removeProperty("height");
  }

  function releaseChatPageInset() {
    const html = document.documentElement;
    html.removeAttribute("data-wdimtm-chat-open");
    html.style.removeProperty("--wdimtm-chat-inset");
    html.style.removeProperty("margin-right");
    html.style.removeProperty("width");
    html.style.removeProperty("max-width");
    const styleEl = document.getElementById("wdimtm-chat-inset-style");
    if (styleEl) styleEl.remove();
  }

  function setChatCollapsed(collapsed) {
    chatCollapsed = Boolean(collapsed);
    const panel = qs(CHAT_ID);
    if (panel && !panel.hidden) {
      panel.classList.toggle("wdimtm-chat--collapsed", chatCollapsed);
      const tab = panel.querySelector(".wdimtm-chat-collapsed-tab");
      if (tab) {
        tab.classList.toggle("is-busy", chatBusy);
        tab.setAttribute("aria-label", tr("chatExpand", "Expand chat"));
      }
      const collapseBtn = panel.querySelector('[data-chat-action="collapse"]');
      if (collapseBtn) {
        collapseBtn.setAttribute("aria-expanded", chatCollapsed ? "false" : "true");
      }
    }
    syncChatPageLayout();
  }

  async function openChatPanel(opts = {}) {
    if (isSiteDisabled()) return;
    const root = uiRoot();
    if (!root) return;

    // Capture selection first — before hideBubble / UI teardown can clear pending.
    // Bubble click uses preventDefault so the live selection is often still present;
    // pending always holds the selection the bubble was shown for.
    const live = getSelectionPayload();
    const snapPending = pending;
    const activeSelection = String(
      (live && live.selection) || snapPending?.selection || ""
    ).trim();
    const activeContext =
      (live && live.context) ||
      snapPending?.context ||
      lastRequest?.page?.context ||
      "";

    hidePopover();
    hideBubble();

    // Fallbacks only when user opened chat without a current selection (e.g. re-open).
    const selection =
      activeSelection ||
      lastRequest?.selection ||
      "";
    const context = activeSelection
      ? activeContext
      : activeContext || lastRequest?.page?.context || "";
    const page = {
      url: location.href,
      title: document.title || "",
      context: context || undefined,
    };

    // Threads are keyed by selection, so opening chat for a second selection
    // no longer overwrites the conversation held by the first one.
    let session = null;
    /** @type {Array<{id:string, selection:string, messageCount:number, lensId?:string}>} */
    let threads = [];
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.CHAT_LOAD,
        payload: { url: page.url, selection },
      });
      if (res?.ok && res.data) {
        session = res.data.thread || null;
        threads = Array.isArray(res.data.threads) ? res.data.threads : [];
      }
    } catch {
      /* ignore */
    }

    // Only seed the last explain into chat when it was about this same selection.
    const selectionMatchesLast =
      Boolean(selection) &&
      Boolean(lastRequest?.selection) &&
      selection === lastRequest.selection;
    const seedFromExplain =
      opts.seedFromExplain && lastExplanation && selectionMatchesLast
        ? lastExplanation
        : undefined;
    const seedExplanation =
      seedFromExplain ||
      (session?.selection && session.selection === selection
        ? session.seedExplanation
        : undefined);

    /** @type {Array<{id:string, selection:string, explanation:string, lensId?:string}>} */
    let history = [];
    try {
      const hRes = await chrome.runtime.sendMessage({
        type: MSG.HISTORY_LOAD,
        payload: { url: page.url },
      });
      if (hRes?.ok && Array.isArray(hRes.data)) history = hRes.data;
    } catch {
      /* ignore */
    }

    // The thread already matches this selection (the store keyed it that way),
    // so resuming is safe whenever one exists and the caller didn't force a reset.
    const resumeSession = Boolean(session?.messages?.length) && !opts.forceNew;

    if (resumeSession) {
      chatState = {
        messages: session.messages,
        selection: session.selection || selection,
        page: {
          url: page.url,
          title: page.title,
          context: context || session.page?.context,
        },
        lensId: session.lensId || activeLensId,
        seedExplanation: seedExplanation || session.seedExplanation,
        history,
        threads,
      };
    } else {
      /** @type {Array<{role:string, content:string}>} */
      const messages = [];
      if (seedExplanation) {
        messages.push({
          role: "assistant",
          content: seedExplanation,
        });
      }
      chatState = {
        messages,
        selection: selection || session?.selection || "",
        page,
        lensId: activeLensId,
        seedExplanation,
        history,
        threads,
      };
    }

    // Unified surface: always open expanded floating chat (not collapsed FAB).
    chatCollapsed = false;
    chatDraft = "";
    chatScroll = { top: 0, atBottom: true };
    renderChatPanel();
    focusChatInput();
    // Only write when there is something to keep — an empty open must never
    // overwrite a thread the user still has stored.
    if (chatState.messages.length) await persistChat();
  }

  /**
   * Switch the panel to another thread on this page without losing the current one.
   * @param {string} selection
   */
  async function switchChatThread(selection) {
    if (!chatState) return;
    await persistChat();
    let thread = null;
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.CHAT_THREAD_LOAD,
        payload: { url: chatState.page?.url || location.href, selection },
      });
      if (res?.ok) thread = res.data;
    } catch {
      /* ignore */
    }
    if (!thread) return;
    chatState = {
      ...chatState,
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      selection: thread.selection || selection,
      lensId: thread.lensId || chatState.lensId,
      seedExplanation: thread.seedExplanation,
    };
    chatScroll = { top: 0, atBottom: true };
    renderChatPanel();
    focusChatInput();
  }

  /** Put the caret in the composer without yanking the page's scroll position. */
  function focusChatInput() {
    chatWantsFocus = true;
    const panel = qs(CHAT_ID);
    if (!panel || panel.hidden || chatCollapsed) return;
    const input = panel.querySelector(".wdimtm-chat-input");
    if (input instanceof HTMLTextAreaElement && !input.disabled) {
      input.focus({ preventScroll: true });
      input.selectionStart = input.selectionEnd = input.value.length;
    }
  }

  /**
   * Re-focus after a re-render, but never steal focus from another control the
   * user is currently using.
   * @param {boolean} hadFocus
   */
  function shouldRestoreChatFocus(hadFocus) {
    if (chatBusy || chatCollapsed) return false;
    if (hadFocus) return true;
    if (!chatWantsFocus) return false;
    const active = chatShadowActiveElement();
    return !active || active.classList?.contains("wdimtm-chat-input") === true;
  }

  function closeChatPanel() {
    abortChatStream();
    // Keep whatever the user typed but stop reclaiming focus once closed.
    persistChat();
    chatWantsFocus = false;
    chatDraft = "";
    chatBusy = false;
    chatCollapsed = false;
    clearComposerAttachments();
    chatDraft = "";
    const panel = qs(CHAT_ID);
    if (panel) {
      panel.hidden = true;
      panel.classList.remove("wdimtm-chat--collapsed");
      panel.style.removeProperty("width");
    }
    releaseChatPageInset();
  }

  /** @param {{ focusInput?: boolean }} [opts] */
  function renderChatPanel(opts = {}) {
    const root = uiRoot();
    if (!root || !chatState) return;
    applyTheme();

    let panel = qs(CHAT_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = CHAT_ID;
      panel.className = "wdimtm-chat wdimtm-surface";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", tr("chatTitle", "Page chat"));
      root.appendChild(panel);
    }
    panel.className = chatCollapsed
      ? "wdimtm-chat wdimtm-surface wdimtm-chat--collapsed"
      : "wdimtm-chat wdimtm-surface";
    panel.hidden = false;
    panel.style.pointerEvents = "auto";

    // Snapshot before innerHTML is replaced: a re-render must not yank the
    // reader to the bottom, nor drop the caret out of the composer.
    captureChatScroll(panel);
    const hadFocus = panel.querySelector(".wdimtm-chat-input") === chatShadowActiveElement();

    const selPreview = (chatState.selection || "").slice(0, 220);
    const msgsHtml = (chatState.messages || [])
      .map((m, i, arr) => {
        const isLastAssistant = i === arr.length - 1 && m.role === "assistant";
        const emptyStreaming =
          chatBusy && isLastAssistant && !String(m.content || "").trim();
        if (emptyStreaming) {
          return `<div class="wdimtm-chat-msg assistant muted" data-chat-streaming="1">${escapeHtml(
            tr("streaming", "Streaming…")
          )}</div>`;
        }
        const cls = m.role === "user" ? "wdimtm-chat-msg user" : "wdimtm-chat-msg assistant";
        const streamAttr =
          chatBusy && isLastAssistant ? ' data-chat-streaming="1"' : "";
        const meta =
          m.role === "assistant" && m.webSearch
            ? `<div class="wdimtm-chat-search-meta">${escapeHtml(
                formatChatSearchMeta(m.webSearch)
              )}</div>`
            : "";
        // Assistant replies use markdown; user messages stay plain (escaped) for safety.
        const body =
          m.role === "assistant"
            ? `<div class="wdimtm-answer">${formatAnswer(m.content || "")}</div>`
            : `<div class="wdimtm-chat-plain">${escapeHtml(m.content || "").replace(
                /\n/g,
                "<br>"
              )}</div>`;
        // Only questions are labelled — an unlabelled block is the answer.
        const role =
          m.role === "user"
            ? `<span class="wdimtm-chat-role">${escapeHtml(tr("chatRoleYou", "You"))}</span>`
            : "";
        return `<div class="${cls}"${streamAttr}>${role}${renderMessageAttachments(
          m.attachments
        )}${body}${meta}</div>`;
      })
      .join("");

    // Saved conversations come first — they restore full threads. Past one-shot
    // explanations fill in below, minus any that already have a thread.
    const currentSel = String(chatState.selection || "").trim();
    const threads = (chatState.threads || []).filter((t) => (t.messageCount || 0) > 0);
    const threadSels = new Set(threads.map((t) => String(t.selection || "").trim()));
    const history = (chatState.history || []).filter(
      (h) => !threadSels.has(String(h.selection || "").trim())
    );

    const clip = (s, n) =>
      `${escapeHtml(String(s || "").slice(0, n))}${String(s || "").length > n ? "…" : ""}`;

    const threadItems = threads
      .slice(0, 6)
      .map((t) => {
        const active = String(t.selection || "").trim() === currentSel;
        return `<button type="button" class="wdimtm-chat-history-item${
          active ? " is-active" : ""
        }" data-chat-action="use-thread" data-thread-sel="${escapeAttr(
          t.selection || ""
        )}"${active ? ' aria-current="true"' : ""}>
            <span class="wdimtm-chat-history-sel">${clip(t.selection, 60)}</span>
            <span class="wdimtm-chat-history-count">${t.messageCount}</span>
          </button>`;
      })
      .join("");

    const historyItems = history
      .slice(0, 5)
      .map(
        (h, idx) =>
          `<button type="button" class="wdimtm-chat-history-item is-explain" data-chat-action="use-history" data-history-idx="${idx}">
            <span class="wdimtm-chat-history-sel">${clip(h.selection, 60)}</span>
          </button>`
      )
      .join("");

    const historyHtml =
      threadItems || historyItems
        ? `<div class="wdimtm-chat-history">
          <div class="wdimtm-chat-history-label">${escapeHtml(
            tr("chatHistory", "On this page")
          )}</div>
          ${threadItems}${historyItems}
        </div>`
        : "";

    const suggestions = [
      {
        id: "sum",
        label: tr("chatSuggestSummarize", "Summarize selection"),
        action: "suggest-summarize",
      },
      {
        id: "page",
        label: tr("chatSuggestPage", "Summarize page (bounded)"),
        action: "suggest-page",
      },
      {
        id: "why",
        label: tr("chatSuggestWhy", "Why does this matter?"),
        action: "suggest-why",
      },
      {
        id: "sanity",
        label: tr("chatSuggestSanity", "Does this hold up?"),
        action: "suggest-sanity",
      },
    ];
    const suggestHtml = `<div class="wdimtm-chat-suggestions">
      ${suggestions
        .map(
          (s) =>
            `<button type="button" class="wdimtm-chip" data-chat-action="${escapeAttr(
              s.action
            )}" ${chatBusy ? "disabled" : ""}>${escapeHtml(s.label)}</button>`
        )
        .join("")}
    </div>`;

    panel.innerHTML = `
      <button type="button" class="wdimtm-chat-collapsed-tab${chatBusy ? " is-busy" : ""}" data-chat-action="expand" aria-label="${escapeAttr(
        tr("chatExpand", "Expand chat")
      )}" title="${escapeAttr(tr("chatExpand", "Expand chat"))}">
        <span class="wdimtm-mark">?</span>
        <span class="wdimtm-chat-collapsed-label">${escapeHtml(tr("chatTitle", "Page chat"))}</span>
        ${chatBusy ? `<span class="wdimtm-chat-collapsed-dot" aria-hidden="true"></span>` : ""}
      </button>
      <div class="wdimtm-chat-expanded">
        <div class="wdimtm-chat-header">
          <div class="wdimtm-chat-title">
            <span class="wdimtm-mark">?</span>
            <span>${escapeHtml(tr("chatTitle", "Page chat"))}</span>
          </div>
          <div class="wdimtm-chat-header-actions">
            <button type="button" class="wdimtm-btn wdimtm-btn-ghost wdimtm-btn-tiny" data-chat-action="clear">${escapeHtml(
              tr("chatClear", "Clear thread")
            )}</button>
            <button
              type="button"
              class="wdimtm-icon-btn wdimtm-chat-min-btn"
              data-chat-action="collapse"
              aria-expanded="true"
              aria-label="${escapeAttr(tr("chatCollapse", "Minimize"))}"
              title="${escapeAttr(tr("chatCollapse", "Minimize"))}"
            >─</button>
            <button type="button" class="wdimtm-icon-btn" data-chat-action="close" aria-label="${escapeAttr(
              tr("chatClose", "Close chat")
            )}" title="${escapeAttr(tr("chatClose", "Close chat"))}">×</button>
          </div>
        </div>
        <div class="wdimtm-chat-selection">
          <div class="wdimtm-chat-selection-label">${escapeHtml(
            tr("chatSelection", "Selection")
          )}</div>
          <div class="wdimtm-chat-selection-body">${escapeHtml(
            selPreview || "—"
          )}${chatState.selection && chatState.selection.length > 220 ? "…" : ""}</div>
        </div>
        ${historyHtml}
        ${suggestHtml}
        <div class="wdimtm-chat-messages" id="wdimtm-chat-messages">
          ${
            msgsHtml ||
            `<div class="wdimtm-chat-empty">${escapeHtml(
              tr("chatEmpty", "Continue from the explanation. Ask anything about this selection.")
            )}</div>`
          }
        </div>
        <form class="wdimtm-chat-composer" data-chat-action="form">
          ${renderComposerAttachments()}
          ${
            composerNotice
              ? `<div class="wdimtm-chat-composer-notice">${escapeHtml(composerNotice)}</div>`
              : ""
          }
          <textarea
            class="wdimtm-chat-input"
            rows="2"
            placeholder="${escapeAttr(tr("chatPlaceholder", "Ask a follow-up…"))}"
            ${chatBusy ? "disabled" : ""}
          ></textarea>
          <div class="wdimtm-chat-composer-actions">
            <button
              type="button"
              class="wdimtm-icon-btn"
              data-chat-action="attach"
              aria-label="${escapeAttr(tr("attachImage", "Attach image"))}"
              title="${escapeAttr(tr("attachImage", "Attach image"))}"
              ${chatBusy ? "disabled" : ""}
            >${ICON_IMAGE}</button>
            <input
              type="file"
              class="wdimtm-chat-file"
              data-chat-action="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
            />
            <span class="wdimtm-chat-attach-hint">${escapeHtml(
              tr("attachHint", "Paste or drop a screenshot here")
            )}</span>
            <span class="wdimtm-chat-composer-spacer"></span>
            ${
              chatBusy
                ? // Cancel is only worth offering now that it actually stops the
                  // request rather than just hiding it (#18).
                  `<button type="button" class="wdimtm-btn wdimtm-btn-ghost" data-chat-action="stop">${escapeHtml(
                    tr("stop", "Stop")
                  )}</button>`
                : `<button type="submit" class="wdimtm-btn">${escapeHtml(
                    tr("chatSend", "Send")
                  )}</button>`
            }
          </div>
        </form>
      </div>
    `;

    panel.classList.toggle("wdimtm-chat--collapsed", chatCollapsed);

    panel.querySelector('[data-chat-action="stop"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      abortChatStream();
      setLastAssistantContent(tr("chatStopped", "Stopped."));
      chatBusy = false;
      renderChatPanel();
    });

    panel.querySelector('[data-chat-action="close"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      closeChatPanel();
    });
    panel.querySelector('[data-chat-action="collapse"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      setChatCollapsed(true);
    });
    panel.querySelector('[data-chat-action="expand"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      setChatCollapsed(false);
    });
    panel.querySelector('[data-chat-action="clear"]')?.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!chatState) return;
      abortChatStream();
      chatBusy = false;
      clearComposerAttachments();
      chatState.messages = [];
      chatState.seedExplanation = undefined;
      // Drop the stored thread outright — persisting an empty one would leave a
      // zero-turn entry sitting in the page's thread list.
      try {
        await chrome.runtime.sendMessage({
          type: MSG.CHAT_THREAD_CLEAR,
          payload: {
            url: chatState.page?.url || location.href,
            selection: chatState.selection,
          },
        });
      } catch {
        /* ignore */
      }
      chatState.threads = (chatState.threads || []).filter(
        (t) => String(t.selection || "").trim() !== String(chatState.selection || "").trim()
      );
      renderChatPanel();
      focusChatInput();
    });
    panel.querySelectorAll('[data-chat-action="use-thread"]').forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const sel = btn.getAttribute("data-thread-sel") || "";
        if (!sel || sel === currentSel) return;
        await switchChatThread(sel);
      });
    });
    panel.querySelectorAll('[data-chat-action="use-history"]').forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const idx = Number(btn.getAttribute("data-history-idx") || "-1");
        // Index into the filtered list rendered above, not the raw store.
        const item = history[idx];
        if (!item || !chatState) return;
        // Keep the thread we are leaving before rebinding to another selection.
        await persistChat();
        chatState = {
          ...chatState,
          selection: item.selection || chatState.selection,
          lensId: item.lensId || chatState.lensId,
          seedExplanation: item.explanation || "",
          messages: [{ role: "assistant", content: item.explanation || "" }],
        };
        renderChatPanel();
        focusChatInput();
        await persistChat();
      });
    });
    panel.querySelector('[data-chat-action="suggest-summarize"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      sendChatMessage(tr("chatSuggestSummarize", "Summarize selection"));
    });
    panel.querySelector('[data-chat-action="suggest-page"]')?.addEventListener("click", async (e) => {
      e.preventDefault();
      await summarizeBoundedPageIntoChat();
    });
    panel.querySelector('[data-chat-action="suggest-why"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      sendChatMessage(tr("chatSuggestWhy", "Why does this matter?"));
    });
    panel.querySelector('[data-chat-action="suggest-sanity"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      sendChatMessage(tr("chatSuggestSanity", "Does this hold up?"));
    });

    panel
      .querySelectorAll('[data-chat-action="remove-attachment"]')
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          removeAttachment(btn.getAttribute("data-attachment-id") || "");
        });
      });

    const fileInput = panel.querySelector('[data-chat-action="file"]');
    panel.querySelector('[data-chat-action="attach"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      if (fileInput instanceof HTMLInputElement) fileInput.click();
    });
    fileInput?.addEventListener("change", async () => {
      if (!(fileInput instanceof HTMLInputElement) || !fileInput.files?.length) return;
      const files = Array.from(fileInput.files);
      // Reset first so picking the same file twice still fires `change`.
      fileInput.value = "";
      await addAttachmentFiles(files, "upload");
    });
    const form = panel.querySelector('[data-chat-action="form"]');
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await submitChatComposer(panel);
    });
    form?.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      form.classList.add("is-dropping");
    });
    form?.addEventListener("dragleave", () => form.classList.remove("is-dropping"));
    form?.addEventListener("drop", async (e) => {
      const img = imageHelpers();
      const files = img?.imageFilesFrom(e.dataTransfer) || [];
      form.classList.remove("is-dropping");
      if (!files.length) return;
      e.preventDefault();
      await addAttachmentFiles(files, "drop");
    });

    const input = panel.querySelector(".wdimtm-chat-input");
    if (input instanceof HTMLTextAreaElement) {
      input.value = chatDraft;
      input.addEventListener("input", () => {
        chatDraft = input.value;
      });
      // Enter sends; Shift/Cmd/Ctrl+Enter keeps the newline. IME composition
      // must never submit — Enter there is confirming candidates, not sending.
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.stopPropagation();
        form?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      });
      if (opts.focusInput || shouldRestoreChatFocus(false)) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }

    const scroller = panel.querySelector("#wdimtm-chat-messages");
    if (scroller) restoreChatScroll(scroller);
    if (shouldRestoreChatFocus(hadFocus)) focusChatInput();

    // Reserve right-hand page space so the rail does not cover content.
    syncChatPageLayout();
  }

  async function summarizeBoundedPageIntoChat() {
    if (!chatState || chatBusy) return;
    const pageText = extractBoundedPageText();
    const prevSelection = chatState.selection;
    const prevContext = chatState.page?.context;
    chatState.selection = pageText.slice(0, 800) || prevSelection;
    if (chatState.page) chatState.page.context = pageText;
    await sendChatMessage(tr("chatSuggestPage", "Summarize page (bounded)"));
    // Restore primary selection focus for later turns (keep page context).
    if (prevSelection) chatState.selection = prevSelection;
    if (chatState.page && prevContext) chatState.page.context = prevContext;
  }

  function extractBoundedPageText() {
    const main =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.body;
    const text = normalizeWhitespace(main?.innerText || main?.textContent || "");
    return truncate(text, MAX_CONTEXT);
  }

  /** @param {HTMLElement} panel */
  async function submitChatComposer(panel) {
    const input = panel.querySelector(".wdimtm-chat-input");
    const text = (input instanceof HTMLTextAreaElement ? input.value : chatDraft).trim();
    // An image on its own is a valid question — text is not required.
    if ((!text && !composerAttachments.length) || chatBusy) return;
    const attachments = composerAttachments;
    clearComposerAttachments();
    chatDraft = "";
    if (input instanceof HTMLTextAreaElement) input.value = "";
    await sendChatMessage(text, attachments);
  }

  /**
   * @param {string} userText
   * @param {Array<object>} [attachments]
   */
  async function sendChatMessage(userText, attachments) {
    if (!chatState || chatBusy) return;
    chatState.messages.push({
      role: "user",
      content: userText,
      ...(attachments?.length ? { attachments } : {}),
    });
    chatBusy = true;
    // Placeholder assistant bubble for streaming; non-stream fills it on completion.
    chatState.messages.push({ role: "assistant", content: "" });
    // A new turn always follows the stream, even if the reader had scrolled up.
    chatScroll = { top: 0, atBottom: true };
    renderChatPanel();
    // Persist the question before the request — closing the tab mid-stream used
    // to lose the whole turn.
    await persistChat();

    if (streamEnabled) {
      sendChatStreaming();
    } else {
      await sendChatOnce();
    }
  }

  function chatPayload() {
    // Exclude empty trailing assistant placeholder from the model request.
    const msgs = (chatState?.messages || []).filter(
      (m, i, arr) =>
        !(
          i === arr.length - 1 &&
          m.role === "assistant" &&
          !String(m.content || "").trim()
        )
    );
    return {
      selection: chatState?.selection || "",
      page: chatState?.page,
      lens: { id: chatState?.lensId || activeLensId },
      // Attachments ride along on every turn that has them; the background
      // trims older images to a thread-wide budget before the request goes out.
      messages: msgs,
    };
  }

  function setLastAssistantContent(text, webSearch) {
    if (!chatState?.messages?.length) return;
    const last = chatState.messages[chatState.messages.length - 1];
    if (last?.role === "assistant") {
      last.content = text;
      if (webSearch !== undefined) last.webSearch = webSearch;
    } else {
      chatState.messages.push({
        role: "assistant",
        content: text,
        ...(webSearch ? { webSearch } : {}),
      });
    }
  }

  /** @param {object | undefined} meta */
  function formatChatSearchMeta(meta) {
    if (!meta) return "";
    const st = meta.status || (meta.used ? "ok" : meta.error ? "failed" : "not_configured");
    if (st === "ok" || meta.used) {
      return tr("chatSearchOk", "Web search: {provider} · {n} hits")
        .replace("{provider}", meta.provider || "web")
        .replace("{n}", String(meta.resultCount ?? 0));
    }
    if (st === "failed") {
      return tr("chatSearchFailed", "Web search failed: {error}").replace(
        "{error}",
        meta.humanError || meta.error || "unknown"
      );
    }
    if (st === "empty") {
      return tr("chatSearchEmpty", "Web search: no results");
    }
    return tr("chatSearchOff", "Web search: off (Options → Web search)");
  }

  /** Update the last assistant bubble without rebuilding the composer (keeps focus). */
  function patchChatStreamingBubble(text) {
    setLastAssistantContent(text);
    const panel = qs(CHAT_ID);
    if (!panel) return;
    const scroller = panel.querySelector("#wdimtm-chat-messages");
    if (!scroller) return;
    let bubble = scroller.querySelector("[data-chat-streaming='1']");
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "wdimtm-chat-msg assistant";
      bubble.setAttribute("data-chat-streaming", "1");
      scroller.appendChild(bubble);
    }
    bubble.classList.remove("muted");
    bubble.innerHTML = `<div class="wdimtm-answer">${formatAnswer(text || "")}</div>`;
    // No auto-scroll on stream chunks — keep the user's scroll position.
    const tab = panel.querySelector(".wdimtm-chat-collapsed-tab");
    if (tab) tab.classList.toggle("is-busy", chatBusy);
  }

  /** True when the page still has a stale content script after extension reload. */
  function isExtensionContextDead(err) {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return true;
    const msg = err instanceof Error ? err.message : String(err || "");
    return /extension context invalidated/i.test(msg);
  }

  function formatChatError(err) {
    if (isExtensionContextDead(err)) {
      return tr(
        "extContextInvalid",
        "Extension was reloaded — refresh this page, then open chat again."
      );
    }
    const msg = err instanceof Error ? err.message : String(err || "Chat failed.");
    return msg.startsWith("Error:") ? msg : `Error: ${msg}`;
  }

  async function sendChatOnce() {
    try {
      if (isExtensionContextDead()) {
        throw new Error("Extension context invalidated.");
      }
      const res = await chrome.runtime.sendMessage({
        type: "wdimtm:chat",
        payload: chatPayload(),
      });
      if (!res?.ok) throw new Error(res?.error || "Chat failed.");
      setLastAssistantContent(
        res.data.reply || res.data.explanation || "",
        res.data.webSearch
      );
      await persistChat();
    } catch (err) {
      setLastAssistantContent(formatChatError(err));
    } finally {
      chatBusy = false;
      renderChatPanel();
    }
  }

  function sendChatStreaming() {
    abortChatStream();
    if (isExtensionContextDead()) {
      setLastAssistantContent(formatChatError(new Error("Extension context invalidated.")));
      chatBusy = false;
      renderChatPanel();
      return;
    }
    let port;
    try {
      port = chrome.runtime.connect({ name: "wdimtm-chat" });
    } catch (err) {
      // Context dead: don't fall through to sendMessage (same failure, worse UX).
      if (isExtensionContextDead(err)) {
        setLastAssistantContent(formatChatError(err));
        chatBusy = false;
        renderChatPanel();
        return;
      }
      // Port unavailable for other reasons — one-shot still works.
      sendChatOnce();
      return;
    }
    activeChatPort = port;

    /** @param {string} text @param {any} [webSearch] */
    const settle = (text, webSearch) => {
      activeChatPort = null;
      setLastAssistantContent(text, webSearch);
      chatBusy = false;
      persistChat();
      renderChatPanel();
    };

    consumePortStream(port, {
      request: { type: "wdimtm:chat", payload: chatPayload() },
      onChunk: (acc) => patchChatStreamingBubble(acc),
      onDone: (data, acc) => settle(data?.reply || data?.explanation || acc, data?.webSearch),
      onPartial: (acc) => settle(acc),
      onError: (err) => {
        activeChatPort = null;
        setLastAssistantContent(formatChatError(err));
        chatBusy = false;
        renderChatPanel();
      },
      onClosed: () => {
        if (activeChatPort === port) activeChatPort = null;
      },
      // The user stopped waiting; do not overwrite whatever they moved on to.
      isActive: () => chatBusy,
    });
  }

  function abortChatStream() {
    if (activeChatPort) {
      try {
        activeChatPort.disconnect();
      } catch {
        /* ignore */
      }
      activeChatPort = null;
    }
  }

  async function persistChat() {
    if (!chatState) return;
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.CHAT_SAVE,
        payload: {
          url: chatState.page?.url || location.href,
          session: {
            messages: chatState.messages,
            selection: chatState.selection,
            page: chatState.page,
            lensId: chatState.lensId,
            seedExplanation: chatState.seedExplanation,
          },
        },
      });
      if (!res?.ok) throw new Error(res?.error || "chat-save returned not-ok");
    } catch (err) {
      // Silent failure here is what made "history isn't saving" impossible to
      // diagnose from the page. Keep it non-fatal, but leave a trace.
      if (!isExtensionContextDead(err)) {
        console.warn("[wdimtm] could not persist chat thread:", err);
      }
    }
  }

  async function acceptMemorySuggestion() {
    const sug = lastMemorySuggestion;
    const rect = pending?.rect || lastRequest?._rect;
    if (!sug) return;
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.MEMORY_ADD,
        payload: {
          type: sug.type || "interest",
          text: sug.content,
          source: "suggested",
        },
      });
      if (!res?.ok) throw new Error(res?.error || "Could not save memory.");
      lastMemorySuggestion = null;
      if (rect) {
        showPopover(rect, {
          kind: "ok",
          explanation: lastExplanation || "Remembered.",
          followUps: lastFollowUps,
          memorySuggestion: null,
          runtime: "memory",
          lensId: activeLensId,
          remembered: true,
        });
      }
    } catch (err) {
      if (rect) {
        showPopover(rect, {
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  function dismissMemorySuggestion() {
    lastMemorySuggestion = null;
    const rect = pending?.rect || lastRequest?._rect;
    if (!rect) return;
    showPopover(rect, {
      kind: "ok",
      explanation: lastExplanation,
      followUps: lastFollowUps,
      memorySuggestion: null,
      runtime: lastRequest ? undefined : "mock",
      lensId: activeLensId,
    });
  }

  async function rememberLast() {
    if (!pending && !lastRequest) return;
    const text =
      (lastRequest?.selection || pending?.selection || "").slice(0, 500) +
      (lastExplanation
        ? `\n\nNote: ${lastExplanation.replace(/\s+/g, " ").slice(0, 280)}`
        : "");
    const rect = pending?.rect || lastRequest?._rect;
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.MEMORY_ADD,
        payload: {
          type: "note",
          text: `From page “${document.title}”: ${text}`,
          source: "explicit",
        },
      });
      if (!res?.ok) throw new Error(res?.error || "Could not save memory.");
      lastMemorySuggestion = null;
      if (rect) {
        showPopover(rect, {
          kind: "ok",
          explanation: lastExplanation || "Remembered.",
          followUps: lastFollowUps,
          runtime: "memory",
          lensId: activeLensId,
          remembered: true,
        });
      }
    } catch (err) {
      if (rect) {
        showPopover(rect, {
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  function positionPopover(rect) {
    const pop = qs(POPOVER_ID);
    if (!pop || pop.hidden) return;
    const gap = 10;
    const pw = Math.min(400, window.innerWidth - 16);
    pop.style.width = `${pw}px`;
    const ph = pop.offsetHeight || 200;
    let top = rect.bottom + gap;
    let left = rect.left + rect.width / 2 - pw / 2;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - gap;
    if (top < 8) top = 8;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
  }

  function hidePopover() {
    const pop = qs(POPOVER_ID);
    if (pop) pop.hidden = true;
  }

  function dismissAll() {
    hideBubble();
    hidePopover();
    // Stop watching, not stop working: the job continues in the cloud and is
    // still listed in options.
    stopResearchPolling();
    researchJob = null;
  }

  function onGlobalKeydown(e) {
    if (e.key === "Escape") {
      if (isPopoverOpen() || (qs(BUBBLE_ID) && !qs(BUBBLE_ID).hidden)) {
        e.stopPropagation();
        abortStream();
        dismissAll();
      }
      return;
    }

    // Alt+Shift+W — force explain even if another extension stole the bubble UI.
    // (W for "What does it mean to me?")
    if (
      (e.altKey || e.metaKey) &&
      e.shiftKey &&
      (e.key === "w" || e.key === "W" || e.code === "KeyW")
    ) {
      // The shortcut forces past other extensions, never past the user. It used
      // to skip this check, so a denied site still answered when asked by key.
      if (isSiteDisabled()) return;
      const payload = getSelectionPayload() || pending;
      if (!payload) return;
      e.preventDefault();
      e.stopPropagation();
      pending = typeof payload.rect !== "undefined" ? payload : pending;
      if (!pending) return;
      // If we only have a stale pending, refresh from live selection when possible.
      const live = getSelectionPayload();
      if (live) pending = live;
      runExplain("explain");
    }
  }

  function onGlobalMouseDown(e) {
    const t = e.target;
    if (!(t instanceof Node)) return;
    // Clicks inside our host/shadow are ours.
    if (host && (t === host || host.contains(t))) return;
    // Composed path for shadow retargeting
    if (typeof e.composedPath === "function") {
      const path = e.composedPath();
      if (path.some((n) => n === host || (n instanceof Node && shadow?.contains(n)))) {
        return;
      }
    }
    if (isPopoverOpen()) {
      abortStream();
      hidePopover();
    }
  }

  function abortStream() {
    if (activePort) {
      try {
        activePort.disconnect();
      } catch {
        /* ignore */
      }
      activePort = null;
    }
  }

  /**
   * @param {string} [mode]
   * @param {{ followUpQuestion?: string }} [opts]
   */
  function buildRequest(mode, opts = {}) {
    // Refresh selection if still available; else reuse pending.
    const live = getSelectionPayload();
    if (live) pending = live;
    if (!pending) return null;
    const { selection, context, rect } = pending;
    const lensId = resolveLensForRequest(selection);
    /** @type {Record<string, unknown>} */
    const req = {
      selection,
      page: {
        url: location.href,
        title: document.title || "",
        context: context || undefined,
      },
      lens: { id: lensId },
      mode: mode || "explain",
      _rect: rect,
    };
    if (opts.followUpQuestion) {
      req.followUpQuestion = String(opts.followUpQuestion).slice(0, 400);
    }
    return req;
  }

  function recordExplainHistory(request, explanation) {
    if (!request?.selection || !explanation) return;
    chrome.runtime
      .sendMessage({
        type: "wdimtm:history-append",
        payload: {
          url: request.page?.url || location.href,
          entry: {
            selection: request.selection,
            explanation,
            lensId: request.lens?.id || activeLensId,
            mode: request.mode || "explain",
          },
        },
      })
      .catch(() => {});
  }

  /**
   * @param {string} [mode]
   * @param {{ followUpQuestion?: string }} [opts]
   */
  function runExplain(mode, opts = {}) {
    // Backstop. Every caller today is reached through UI that already checked,
    // but "asking the model about this page" is the one thing a denied site must
    // never do, so the guard belongs at the single point they all pass through.
    if (isSiteDisabled()) return;
    const request = buildRequest(mode, opts);
    if (!request) return;
    // Summarize-page uses broader bounded page text.
    if (mode === "summarize-page") {
      const pageText = extractBoundedPageText();
      request.selection = pageText.slice(0, 800) || request.selection;
      request.page.context = pageText;
      request.mode = "summarize-page";
    }
    lastRequest = request;
    const rect = request._rect;

    const loadingMsg =
      mode === "more"
        ? tr("loadingMore", "Going deeper…")
        : mode === "probe"
          ? tr("loadingMore", "Going deeper…")
          : mode === "simplify"
            ? tr("loadingSimplify", "Simplifying…")
            : mode === "summarize" || mode === "summarize-page"
              ? tr("summarize", "Summarize") + "…"
              : mode === "why"
                ? tr("loadingWhy", "Why it matters…")
                : mode === "verify"
                  ? tr("loadingVerify", "Checking claims…")
                  : tr("loadingExplain", "Understanding selection…");

    showPopover(rect, { kind: "loading", message: loadingMsg });

    if (streamEnabled) explainStreaming(request, rect);
    else explainOnce(request, rect);
  }

  async function explainOnce(request, rect) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: MSG.EXPLAIN,
        payload: {
          selection: request.selection,
          followUpQuestion: request.followUpQuestion,
          page: request.page,
          lens: request.lens,
          mode: request.mode,
        },
      });
      if (!res?.ok) {
        const err = new Error(res?.error || "Explain failed.");
        // The background already classified this; keep the code so the popover
        // can offer the right way out instead of a generic Retry.
        err.code = res?.code || "";
        throw err;
      }
      lastExplanation = res.data.explanation;
      lastFollowUps = normalizeFollowUpList(res.data.followUps);
      lastMemorySuggestion = res.data.memorySuggestion || null;
      recordExplainHistory(request, res.data.explanation);
      showPopover(rect, {
        kind: "ok",
        explanation: res.data.explanation,
        followUps: lastFollowUps,
        memorySuggestion: lastMemorySuggestion,
        runtime: res.data.runtime,
        lensId: activeLensId,
      });
      positionPopover(rect);
    } catch (err) {
      showPopover(rect, {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof Error ? err.code || "" : "",
      });
    }
  }

  function explainStreaming(request, rect) {
    abortStream();
    let port;
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.id) {
        throw new Error("Extension context invalidated.");
      }
      port = chrome.runtime.connect({ name: "wdimtm-explain" });
    } catch (err) {
      showPopover(rect, {
        kind: "error",
        message: tr(
          "extContextInvalid",
          "Extension was reloaded — refresh this page, then open chat again."
        ),
      });
      return;
    }
    activePort = port;

    /** @param {string} explanation @param {any} [data] */
    const settle = (explanation, data) => {
      activePort = null;
      lastExplanation = explanation;
      lastFollowUps = normalizeFollowUpList(data?.followUps);
      lastMemorySuggestion = data?.memorySuggestion || null;
      recordExplainHistory(request, lastExplanation);
      showPopover(rect, {
        kind: "ok",
        explanation: lastExplanation,
        followUps: lastFollowUps,
        memorySuggestion: lastMemorySuggestion,
        runtime: data?.runtime,
        lensId: activeLensId,
      });
      positionPopover(rect);
    };

    consumePortStream(port, {
      request: {
        type: MSG.EXPLAIN,
        payload: {
          selection: request.selection,
          page: request.page,
          lens: request.lens,
          mode: request.mode,
          followUpQuestion: request.followUpQuestion,
        },
      },
      onChunk: (acc) => {
        // Hide model trailers while they stream in.
        const visible = hideStreamingTrailers(acc);
        lastExplanation = visible;
        showPopover(rect, {
          kind: "streaming",
          explanation: visible,
          lensId: activeLensId,
        });
        positionPopover(rect);
      },
      onDone: (data, acc) => settle(data?.explanation || acc, data),
      // A half-streamed explanation is worth keeping, exactly as a half-streamed
      // chat reply always was.
      onPartial: (acc) => settle(hideStreamingTrailers(acc)),
      onError: (err) => {
        activePort = null;
        showPopover(rect, {
          kind: "error",
          message: err.message || "Explain failed.",
          code: err.code || "",
        });
      },
      onClosed: () => {
        if (activePort === port) activePort = null;
      },
      failureMessage: tr(
        "extContextInvalid",
        "Extension was reloaded — refresh this page, then open chat again."
      ),
    });
  }

  function escapeHtml(s) {
    const md = WdimtmMarkdown;
    if (md?.escapeHtml) return md.escapeHtml(s);
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  /** Markdown → HTML for explain popover + chat assistant bubbles. */
  function formatAnswer(text) {
    const md = WdimtmMarkdown;
    if (md?.formatMarkdown) return md.formatMarkdown(text);
    // Fallback if markdown.global.js failed to load
    const escaped = escapeHtml(text || "").replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>");
    return `<p>${escaped}</p>`;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
