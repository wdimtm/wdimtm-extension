import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveAnswerLanguage,
  resolveUiLocale,
  answerLanguageInstruction,
  t,
  STRINGS,
} from "../../core/i18n.js";

describe("i18n", () => {
  it("keeps the content-script strings in sync across locales", () => {
    // A missing zh key silently falls back to English mid-sentence, which reads
    // like a bug to the user rather than a translation gap.
    const en = Object.keys(STRINGS.en).sort();
    const zh = Object.keys(STRINGS.zh_CN).sort();
    assert.deepEqual(zh, en);
  });

  it("resolves UI locale", () => {
    assert.equal(resolveUiLocale("zh_CN"), "zh_CN");
    assert.equal(resolveUiLocale("en"), "en");
  });

  it("answer language precedence", () => {
    assert.equal(resolveAnswerLanguage({ answerLanguage: "en" }, "中文内容很多字"), "en");
    assert.equal(
      resolveAnswerLanguage({ answerLanguage: "match-selection" }, "中文内容很多字"),
      "zh_CN"
    );
    assert.equal(
      resolveAnswerLanguage({ answerLanguage: "match-selection" }, "english only text"),
      "en"
    );
    assert.equal(
      resolveAnswerLanguage({ answerLanguage: "auto", uiLocale: "zh_CN" }, "hello"),
      "zh_CN"
    );
  });

  it("provides language instruction and translations", () => {
    assert.ok(answerLanguageInstruction("zh_CN").includes("Chinese"));
    assert.equal(t("retry", "zh_CN"), "重试");
    assert.equal(t("retry", "en"), "Retry");
  });
});
