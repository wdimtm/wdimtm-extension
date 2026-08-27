/**
 * Theme for the extension's own pages (options, import).
 *
 * The content script has applied the theme setting to the in-page popover since
 * it shipped, but the settings and import pages hardcoded a light palette — so
 * someone who chose Dark got a dark popover and a page that flashed white at
 * them. This mirrors the content script's resolution so both surfaces agree.
 */

/**
 * @param {string} pref  'system' | 'dark' | 'light'
 * @returns {'dark' | 'light'}
 */
export function resolveTheme(pref) {
  let mode = pref || "system";
  if (mode === "system") {
    mode = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }
  return mode === "light" ? "light" : "dark";
}

/**
 * @param {string} pref
 * @param {Document} [doc]
 */
export function applyPageTheme(pref, doc = document) {
  const mode = resolveTheme(pref);
  doc.documentElement.setAttribute("data-theme", mode);
  // Tells the browser which palette to use for form controls and scrollbars;
  // without it a dark page still gets light-styled selects and checkboxes.
  doc.documentElement.style.colorScheme = mode;
  return mode;
}

/**
 * Re-apply when the OS flips, but only while the user is on "system" — an
 * explicit Dark or Light choice should not be overridden by the OS.
 *
 * @param {() => string} getPref
 * @param {Document} [doc]
 */
export function watchSystemTheme(getPref, doc = document) {
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mq) return () => {};
  const onChange = () => {
    if ((getPref() || "system") === "system") applyPageTheme("system", doc);
  };
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}
