/**
 * Open a payment provider's checkout page from Settings.
 *
 * The checkout URL only exists after an awaited Cloud call, and by then the
 * click's user activation may be gone, so `window.open` can be blocked
 * without a word. `chrome.tabs.create` is not a popup and needs no
 * activation or permission. Only https URLs are opened.
 */

/**
 * @param {string} url
 * @param {{ create: (props: { url: string, active?: boolean }) => Promise<unknown> }} [tabs]
 * @returns {Promise<boolean>} whether a tab was opened
 */
export async function openCheckoutTab(url, tabs = globalThis.chrome?.tabs) {
  let href;
  try {
    href = new URL(String(url || ""));
  } catch {
    return false;
  }
  if (href.protocol !== "https:" || !tabs?.create) return false;
  try {
    await tabs.create({ url: href.href, active: true });
    return true;
  } catch {
    return false;
  }
}
