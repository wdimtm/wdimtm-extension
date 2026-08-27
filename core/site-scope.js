/**
 * Where WDIMTM is allowed to act — hostname normalization and the denylist.
 *
 * This used to exist three times: `isHostDenied()` in extension/lib/settings.js,
 * an inlined copy inside the content script's `isSiteDisabled()`, and
 * `normalizeHost()` in domain-lenses.js, whose comment claimed to mirror the
 * denylist while quietly disagreeing with it — it stripped `www.` and the port,
 * the other two compared verbatim. So pasting `www.example.com` from the address
 * bar left every other subdomain active. One definition, one behaviour.
 *
 * Host-free by design (see core/README.md): the options page, the popup, the
 * content script and Cloud all have to answer "does WDIMTM run here?" the same
 * way, and only one of them has a `chrome`.
 */

/**
 * A bare, comparable hostname: no scheme, no `www.`, no port, no path, lowercase.
 *
 * `www.` goes because it is a prefix of the site, not a different site — nobody
 * who denies `www.example.com` means to leave `blog.example.com` running.
 *
 * @param {unknown} value
 * @returns {string} bare hostname, or "" if there is nothing usable
 */
export function normalizeHost(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

/**
 * Whether `hostname` is covered by an entry, exactly or as a subdomain.
 *
 * The match is on a dot boundary, never a raw suffix: `notexample.com` must not
 * be caught by an `example.com` entry.
 *
 * @param {string} hostname
 * @param {Array<unknown>} [denylist]
 * @returns {boolean}
 */
export function isHostDenied(hostname, denylist = []) {
  const host = normalizeHost(hostname);
  if (!host) return false;
  return (denylist || []).some((entry) => {
    const denied = normalizeHost(entry);
    if (!denied) return false;
    return host === denied || host.endsWith(`.${denied}`);
  });
}

/**
 * Add a hostname to the denylist, returning a new list.
 *
 * A host the list already covers is not appended — a parent entry is the
 * stronger rule, and a redundant line would only be confusing to read back in
 * the options textarea.
 *
 * @param {Array<unknown>} denylist
 * @param {string} hostname
 * @returns {string[]}
 */
export function addDeniedHost(denylist, hostname) {
  const list = (denylist || []).map((e) => String(e ?? "")).filter(Boolean);
  const host = normalizeHost(hostname);
  if (!host || isHostDenied(host, list)) return list;
  return [...list, host];
}

/**
 * Remove whatever was denying a hostname, returning a new list.
 *
 * Every covering entry goes, parents included. Dropping only the exact match
 * would leave the site denied by `example.com` after the user switched it back
 * on for `blog.example.com` — a toggle that does not stick is worse than none.
 *
 * @param {Array<unknown>} denylist
 * @param {string} hostname
 * @returns {string[]}
 */
export function removeDeniedHost(denylist, hostname) {
  const list = (denylist || []).map((e) => String(e ?? "")).filter(Boolean);
  const host = normalizeHost(hostname);
  if (!host) return list;
  return list.filter((entry) => !isHostDenied(host, [entry]));
}
