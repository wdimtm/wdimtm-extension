import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPTIONS_STRINGS, ot, applyOptionsI18n } from "../../extension/lib/options-i18n.js";

describe("options i18n", () => {
  it("has matching key sets for en and zh_CN", () => {
    const enKeys = Object.keys(OPTIONS_STRINGS.en).sort();
    const zhKeys = Object.keys(OPTIONS_STRINGS.zh_CN).sort();
    assert.deepEqual(enKeys, zhKeys);
    assert.ok(enKeys.length > 50);
  });

  it("ot falls back to English", () => {
    assert.equal(ot("saveSettings", "en"), "Save settings");
    assert.equal(ot("saveSettings", "zh_CN"), "保存设置");
    assert.equal(ot("nonexistent_key_xyz", "zh_CN"), "nonexistent_key_xyz");
  });

  it("applyOptionsI18n updates data-i18n nodes", () => {
    // Minimal DOM shim
    const store = new Map();
    globalThis.document = {
      documentElement: { lang: "en" },
      title: "",
      querySelectorAll(sel) {
        if (sel === "[data-i18n]") {
          return [
            {
              getAttribute: (k) => (k === "data-i18n" ? "saveSettings" : null),
              set textContent(v) {
                store.set("saveSettings", v);
              },
              get textContent() {
                return store.get("saveSettings");
              },
            },
          ];
        }
        if (sel === "[data-i18n-html]") return [];
        if (sel === "[data-i18n-placeholder]") return [];
        if (sel === "[data-i18n-option]") return [];
        return [];
      },
    };
    applyOptionsI18n("zh_CN");
    assert.equal(document.title, "WDIMTM 设置");
    assert.equal(store.get("saveSettings"), "保存设置");
    assert.equal(document.documentElement.lang, "zh-CN");
  });
});
