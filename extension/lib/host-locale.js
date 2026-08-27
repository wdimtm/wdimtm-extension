/**
 * Reading the host's UI language — the one thing about locale that is not
 * portable. Kept out of i18n.js so the resolver itself can run in a Worker.
 */

/**
 * @returns {string} e.g. "zh-CN", or "" when there is no host to ask.
 */
export function browserLocale() {
  try {
    if (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage) {
      return chrome.i18n.getUILanguage();
    }
  } catch {
    /* ignore */
  }
  return typeof navigator === "undefined" ? "" : navigator.language || "";
}
