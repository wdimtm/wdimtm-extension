import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { applyPageTheme, resolveTheme, watchSystemTheme } from "../../extension/lib/page-theme.js";

/** @param {boolean} prefersDark */
function installDom(prefersDark) {
  const listeners = [];
  const root = {
    attrs: {},
    style: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
  };
  globalThis.document = { documentElement: root };
  globalThis.window = {
    matchMedia: () => ({
      matches: prefersDark,
      addEventListener: (_t, fn) => listeners.push(fn),
      removeEventListener: () => {},
    }),
  };
  return { root, fire: () => listeners.forEach((fn) => fn()) };
}

describe("resolveTheme", () => {
  beforeEach(() => installDom(false));

  it("honours an explicit choice over the system", () => {
    installDom(true);
    assert.equal(resolveTheme("light"), "light", "explicit light beats a dark OS");
    installDom(false);
    assert.equal(resolveTheme("dark"), "dark", "explicit dark beats a light OS");
  });

  it("follows the system when set to system", () => {
    installDom(true);
    assert.equal(resolveTheme("system"), "dark");
    installDom(false);
    assert.equal(resolveTheme("system"), "light");
  });

  it("treats a missing preference as system", () => {
    installDom(true);
    assert.equal(resolveTheme(""), "dark");
    assert.equal(resolveTheme(undefined), "dark");
  });
});

describe("applyPageTheme", () => {
  it("sets both the attribute and color-scheme", () => {
    const { root } = installDom(false);
    applyPageTheme("dark");
    assert.equal(root.attrs["data-theme"], "dark");
    // Without color-scheme the form controls and scrollbars stay light on a
    // dark page.
    assert.equal(root.style.colorScheme, "dark");
  });
});

describe("watchSystemTheme", () => {
  it("re-applies on an OS change while the preference is system", () => {
    const { root, fire } = installDom(true);
    applyPageTheme("light");
    assert.equal(root.attrs["data-theme"], "light");

    watchSystemTheme(() => "system");
    fire();
    assert.equal(root.attrs["data-theme"], "dark", "system preference follows the OS");
  });

  it("leaves an explicit choice alone when the OS flips", () => {
    const { root, fire } = installDom(true);
    applyPageTheme("light");
    watchSystemTheme(() => "light");
    fire();
    assert.equal(root.attrs["data-theme"], "light", "an explicit choice is not overridden");
  });
});
