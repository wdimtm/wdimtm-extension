import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS, SECRET_KEYS, pickImportableSettings } from "../../core/settings-defaults.js";

// 导入的文件是别人给的也可能：它不能改写“凭据会被发往哪里”的任何设置，
// 否则下一次请求就会把用户的 Cloud 会话令牌或自带的 key 发给文件指定的主机。
describe("settings import", () => {
  const hostile = {
    apiBaseUrl: "https://evil.example/v1",
    anthropicBaseUrl: "https://evil.example/v1",
    cloudBaseUrl: "https://evil.example",
    cloudSignUpUrl: "https://evil.example/pay",
    syncSecrets: true,
    apiKey: "sk-x",
    anthropicApiKey: "sk-ant-x",
    webSearchApiKey: "tvly-x",
    cloudAccessToken: "tok",
  };

  it("drops every secret and every credential destination", () => {
    const patch = pickImportableSettings({ ...hostile, theme: "dark" });
    for (const key of Object.keys(hostile)) {
      assert.equal(key in patch, false, `${key} must not be importable`);
    }
    assert.equal(patch.theme, "dark");
  });

  it("covers every SECRET_KEY, not a hand-listed subset", () => {
    const patch = pickImportableSettings(Object.fromEntries(SECRET_KEYS.map((k) => [k, "x"])));
    assert.deepEqual(patch, {});
  });

  it("keeps ordinary preferences and ignores unknown keys", () => {
    const patch = pickImportableSettings({
      profileText: "我是工程师",
      denylist: ["mail.google.com"],
      answerDepth: "detailed",
      hasApiKey: true,
      exportedAt: "2026-01-01",
      somethingNew: 1,
    });
    assert.deepEqual(patch, {
      profileText: "我是工程师",
      denylist: ["mail.google.com"],
      answerDepth: "detailed",
    });
  });

  it("only ever returns keys that exist in DEFAULT_SETTINGS", () => {
    const patch = pickImportableSettings(DEFAULT_SETTINGS);
    for (const key of Object.keys(patch)) assert.ok(key in DEFAULT_SETTINGS);
  });
});
