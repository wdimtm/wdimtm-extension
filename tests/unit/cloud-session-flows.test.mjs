/**
 * Account and research flows for each kind of Cloud base URL (#167 review).
 *
 * resolveCloudConfig treats a blank or whitespace-only base URL as the
 * production Cloud, and a custom one as a self-hosted backend. This drives the
 * service worker's real onMessage listener with a fake `chrome` and a fake
 * Cloud, and checks that sign-in, status, research, export, sign-out and delete
 * all reach the Cloud the settings point at, and nowhere else.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { MSG } from "../../core/messages.js";

function storageArea() {
  /** @type {Record<string, unknown>} */
  let data = {};
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === "string") return keys in data ? { [keys]: data[keys] } : {};
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
      }
      const out = { ...keys };
      for (const k of Object.keys(keys)) if (k in data) out[k] = data[k];
      return out;
    },
    async set(patch) {
      data = { ...data, ...patch };
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k];
    },
    async clear() {
      data = {};
    },
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const JOB = { id: "job_1", state: "queued", mode: "research", goal: "g" };

/** @type {{ method: string, url: string }[]} */
let requests = [];

/** The fake Cloud: answers the paths the extension calls, on any origin. */
async function fakeCloud(url, init = {}) {
  const href = String(url);
  const method = init.method || "GET";
  requests.push({ method, url: href });
  const path = new URL(href).pathname;
  if (path === "/v1/auth/google") {
    return jsonResponse(200, { accessToken: "tok_1", user: { id: "u_1", email: "a@example.com" } });
  }
  if (path === "/v1/auth/signout") return jsonResponse(200, {});
  if (path === "/v1/me") return jsonResponse(200, { plan: "cloud", planLabel: "WDIMTM Cloud", quota: {} });
  if (path === "/v1/memory") return method === "GET" ? jsonResponse(404, {}) : jsonResponse(200, { ok: true });
  if (path === "/v1/research") return jsonResponse(202, { job: JOB });
  if (path === "/v1/jobs/job_1") return jsonResponse(200, { job: JOB });
  if (path === "/v1/jobs/job_1/cancel") return jsonResponse(200, { job: { ...JOB, state: "canceled" } });
  if (path === "/v1/account/export") return jsonResponse(200, { user: { id: "u_1" } });
  if (path === "/v1/account/delete") return jsonResponse(200, { deleted: true });
  return jsonResponse(404, { error: `no fake for ${method} ${path}` });
}

/** @type {(msg: unknown) => Promise<any>} */
let send;

before(async () => {
  /** @type {Function | null} */
  let onMessage = null;
  const noop = { addListener() {} };
  globalThis.chrome = {
    storage: { sync: storageArea(), local: storageArea(), session: storageArea() },
    runtime: {
      onMessage: { addListener: (fn) => (onMessage = fn) },
      onConnect: noop,
      onInstalled: noop,
      getURL: (p) => `chrome-extension://test/${p}`,
      getManifest: () => ({ oauth2: { client_id: "client-123.apps.googleusercontent.com" } }),
      openOptionsPage: async () => {},
    },
    identity: {
      getRedirectURL: (p) => `https://test.chromiumapp.org/${p}`,
      launchWebAuthFlow: async () => "https://test.chromiumapp.org/google#access_token=ya29.fake",
      removeCachedAuthToken: async () => {},
      clearAllCachedAuthTokens: async () => {},
    },
    tabs: { create: async () => ({}) },
  };
  globalThis.fetch = fakeCloud;

  await import("../../extension/background/service-worker.js");
  const listener = onMessage;
  send = (type, payload) =>
    new Promise((resolve) => listener(payload === undefined ? { type } : { type, payload }, {}, resolve));
});

const CASES = [
  { label: "blank", cloudBaseUrl: "", expected: "https://cloud.wdimtm.com" },
  { label: "whitespace", cloudBaseUrl: "   ", expected: "https://cloud.wdimtm.com" },
  { label: "custom", cloudBaseUrl: "https://self.example/", expected: "https://self.example" },
];

describe("Cloud account and research flows by base URL", () => {
  beforeEach(() => {
    requests = [];
    globalThis.chrome.storage.sync = storageArea();
    globalThis.chrome.storage.local = storageArea();
    globalThis.chrome.storage.session = storageArea();
  });

  for (const { label, cloudBaseUrl, expected } of CASES) {
    it(`${label} base URL reaches ${expected} for every flow`, async () => {
      await globalThis.chrome.storage.sync.set({
        runtime: "wdimtm-cloud",
        accountMode: "cloud",
        cloudBaseUrl,
      });

      const signIn = await send(MSG.ACCOUNT_SIGN_IN);
      assert.equal(signIn.ok, true, signIn.error);
      assert.equal(signIn.data.email, "a@example.com");
      assert.equal(signIn.data.migration, "uploaded");

      const status = await send(MSG.ACCOUNT_STATUS);
      assert.equal(status.ok, true, status.error);
      assert.equal(status.data.cloudReady, true);
      assert.equal(status.data.session?.email, "a@example.com");
      assert.equal(status.data.account?.plan, "cloud");

      const settings = await send(MSG.GET_SETTINGS);
      assert.equal(settings.data.researchReady, true);

      const started = await send(MSG.RESEARCH_START, {
        selection: "Sovereign AI budgets are rising",
        page: { url: "https://example.com/a", title: "A" },
      });
      assert.equal(started.ok, true, started.error);
      assert.equal(started.data.id, "job_1");
      assert.equal((await send(MSG.RESEARCH_GET, { id: "job_1" })).ok, true);
      assert.equal((await send(MSG.RESEARCH_CANCEL, { id: "job_1" })).data.state, "canceled");

      const exported = await send(MSG.ACCOUNT_EXPORT);
      assert.equal(exported.ok, true, exported.error);

      assert.equal((await send(MSG.ACCOUNT_SIGN_OUT)).ok, true);
      assert.equal((await send(MSG.ACCOUNT_STATUS)).data.session, null);
      assert.equal((await send(MSG.ACCOUNT_EXPORT)).ok, false, "export needs a session");

      assert.equal((await send(MSG.ACCOUNT_SIGN_IN)).ok, true);
      const deleted = await send(MSG.ACCOUNT_DELETE);
      assert.equal(deleted.ok, true, deleted.error);
      const after = await send(MSG.ACCOUNT_STATUS);
      assert.equal(after.data.accountMode, "local");
      assert.equal(after.data.session, null);

      const paths = requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);
      for (const path of [
        "POST /v1/auth/google",
        "GET /v1/me",
        "POST /v1/research",
        "GET /v1/jobs/job_1",
        "POST /v1/jobs/job_1/cancel",
        "GET /v1/account/export",
        "POST /v1/auth/signout",
        "POST /v1/account/delete",
      ]) {
        assert.ok(paths.includes(path), `${path} was not called (${paths.join(", ")})`);
      }
      for (const r of requests) {
        assert.equal(new URL(r.url).origin, expected, `${r.method} ${r.url}`);
      }
    });
  }
});
