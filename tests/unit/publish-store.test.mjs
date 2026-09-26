import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CREDENTIALS,
  formatResult,
  parseArgs,
  publishUrl,
  readConfig,
  resourceName,
  run,
  statusUrl,
  TOKEN_URL,
  uploadUrl,
} from "../../scripts/publish-store.mjs";

const env = {
  CWS_CLIENT_ID: "client",
  CWS_CLIENT_SECRET: "secret-value",
  CWS_REFRESH_TOKEN: "refresh-value",
  CWS_PUBLISHER_ID: "pub-1",
  CWS_EXTENSION_ID: "ext-1",
};

const name = resourceName(env.CWS_PUBLISHER_ID, env.CWS_EXTENSION_ID);

function jsonResponse(status, body) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    },
  };
}

/**
 * @param {Record<string, { status?: number, body: object } | ((call: { url: string, init: RequestInit }) => { status?: number, body: object })>} routes
 */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    const route = routes[call.url];
    const result = typeof route === "function" ? route(call) : route;
    if (!result) throw new Error(`unexpected ${call.url}`);
    return jsonResponse(result.status ?? 200, result.body);
  };
  return { fetchImpl, calls };
}

function tokenThen(routes) {
  return fakeFetch({
    [TOKEN_URL]: { body: { access_token: "ya29-access", expires_in: 3600 } },
    ...routes,
  });
}

function harness(fetchImpl, argv, packageZip) {
  const reads = [];
  return run({
    argv: ["node", "publish-store.mjs", ...argv],
    env,
    fetchImpl,
    packageZip:
      packageZip ||
      (async () => {
        return { version: "0.5.1", zipPath: "wdimtm-0.5.1.zip" };
      }),
    readFileImpl: async (file) => {
      reads.push(file);
      return Buffer.from("zip-bytes");
    },
    sleep: async () => {},
    maxPolls: 3,
    pollIntervalMs: 0,
  }).then((result) => ({ result, reads }));
}

describe("store publish credentials", () => {
  it("names every missing variable and ignores blank values", () => {
    const loaded = readConfig({ CWS_CLIENT_ID: "  ", CWS_EXTENSION_ID: "ext" });
    assert.equal(loaded.ok, false);
    assert.deepEqual(
      loaded.missing,
      CREDENTIALS.map(([, name]) => name).filter((name) => name !== "CWS_EXTENSION_ID")
    );
    assert.equal(loaded.error.message.includes("ext"), false);
  });

  it("refuses an id that would change the request path", () => {
    const loaded = readConfig({ ...env, CWS_EXTENSION_ID: "ext/other" });
    assert.equal(loaded.ok, false);
    assert.match(loaded.error.message, /extensionId/);
  });
});

describe("store publish commands", () => {
  it("fails before packaging or the network when credentials are missing", async () => {
    let packaged = false;
    let fetched = false;
    await assert.rejects(
      () =>
        run({
          argv: ["node", "publish-store.mjs"],
          env: {},
          fetchImpl: async () => {
            fetched = true;
            throw new Error("network");
          },
          packageZip: async () => {
            packaged = true;
            return { version: "0.5.1", zipPath: "x.zip" };
          },
        }),
      (error) => {
        assert.deepEqual(error.missing, CREDENTIALS.map(([, name]) => name));
        return true;
      }
    );
    assert.equal(packaged, false);
    assert.equal(fetched, false);
  });

  it("uploads the zip as a draft and does not publish it", async () => {
    const { fetchImpl, calls } = tokenThen({
      [uploadUrl(name)]: {
        body: { itemId: "ext-1", crxVersion: "0.5.1", uploadState: "SUCCEEDED" },
      },
    });
    const { result, reads } = await harness(fetchImpl, []);
    assert.deepEqual(reads, ["wdimtm-0.5.1.zip"]);
    assert.equal(result.submitted, false);
    assert.equal(result.version, "0.5.1");
    assert.match(formatResult(result), /draft/);

    const upload = calls.find((call) => call.url === uploadUrl(name));
    assert.equal(upload.init.method, "POST");
    assert.equal(upload.init.headers.Authorization, "Bearer ya29-access");
    assert.equal(upload.init.headers["Content-Type"], "application/zip");
    assert.equal(Buffer.from(upload.init.body).toString(), "zip-bytes");
    assert.equal(
      calls.some((call) => call.url === publishUrl(name)),
      false
    );

    const wire = JSON.stringify(calls.filter((call) => call.url !== TOKEN_URL));
    assert.equal(wire.includes("refresh-value"), false);
    assert.equal(wire.includes("secret-value"), false);
  });

  it("sends the refresh token only to the token endpoint", async () => {
    const { fetchImpl, calls } = tokenThen({
      [uploadUrl(name)]: {
        body: { itemId: "ext-1", crxVersion: "0.5.1", uploadState: "SUCCEEDED" },
      },
    });
    await harness(fetchImpl, []);
    const tokenCall = calls.find((call) => call.url === TOKEN_URL);
    const form = new URLSearchParams(tokenCall.init.body);
    assert.equal(form.get("refresh_token"), "refresh-value");
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("client_secret"), "secret-value");
  });

  it("waits out an in-progress upload before stopping", async () => {
    let polls = 0;
    const { fetchImpl, calls } = tokenThen({
      [uploadUrl(name)]: { body: { itemId: "ext-1", uploadState: "IN_PROGRESS" } },
      [statusUrl(name)]: () => {
        polls += 1;
        return {
          body: {
            itemId: "ext-1",
            lastAsyncUploadState: polls < 2 ? "IN_PROGRESS" : "SUCCEEDED",
          },
        };
      },
    });
    const { result } = await harness(fetchImpl, []);
    assert.equal(result.uploaded, true);
    assert.equal(polls, 2);
    assert.equal(
      calls.some((call) => call.url === publishUrl(name)),
      false
    );
  });

  it("does not publish when the upload fails", async () => {
    const { fetchImpl, calls } = tokenThen({
      [uploadUrl(name)]: { body: { uploadState: "FAILED" } },
    });
    await assert.rejects(() => harness(fetchImpl, ["--submit"]), /FAILED/);
    assert.equal(
      calls.some((call) => call.url === publishUrl(name)),
      false
    );
  });

  it("does not publish when the store version disagrees with the package", async () => {
    const { fetchImpl, calls } = tokenThen({
      [uploadUrl(name)]: {
        body: { itemId: "ext-1", crxVersion: "0.5.0", uploadState: "SUCCEEDED" },
      },
    });
    await assert.rejects(() => harness(fetchImpl, ["--submit"]), /0\.5\.0/);
    assert.equal(
      calls.some((call) => call.url === publishUrl(name)),
      false
    );
  });

  it("uploads and submits in one step without asking to skip review", async () => {
    const { fetchImpl, calls } = tokenThen({
      [uploadUrl(name)]: {
        body: { itemId: "ext-1", crxVersion: "0.5.1", uploadState: "SUCCEEDED" },
      },
      [publishUrl(name)]: { body: { itemId: "ext-1", state: "PENDING_REVIEW" } },
    });
    const { result } = await harness(fetchImpl, ["--submit"]);
    assert.equal(result.submitted, true);
    assert.equal(result.state, "PENDING_REVIEW");
    const publish = calls.find((call) => call.url === publishUrl(name));
    assert.equal(publish.init.body, "{}");
    assert.equal(publish.init.body.includes("skipReview"), false);
    assert.match(formatResult(result), /submitted ext-1 for review/);
  });

  it("submits an existing draft without packaging again", async () => {
    let packaged = false;
    const { fetchImpl, calls } = tokenThen({
      [publishUrl(name)]: { body: { itemId: "ext-1", state: "PENDING_REVIEW" } },
    });
    const { result } = await harness(fetchImpl, ["--submit-only"], async () => {
      packaged = true;
      throw new Error("package should not run");
    });
    assert.equal(packaged, false);
    assert.equal(result.uploaded, false);
    assert.equal(result.submitted, true);
    assert.equal(
      calls.some((call) => call.url === uploadUrl(name)),
      false
    );
    assert.match(formatResult(result), /does not build a new zip/);
  });

  it("rejects combining the two submit flags", () => {
    assert.throws(() => parseArgs(["node", "script", "--submit", "--submit-only"]), /not both/);
  });

  it("surfaces the API error without the access token", async () => {
    const { fetchImpl } = tokenThen({
      [uploadUrl(name)]: {
        status: 400,
        body: { error: { message: "Version must be newer. token ya29-access" } },
      },
    });
    await assert.rejects(() => harness(fetchImpl, []), (error) => {
      assert.match(error.message, /Version must be newer/);
      assert.equal(error.message.includes("ya29-access"), false);
      assert.equal(error.message.includes("refresh-value"), false);
      return true;
    });
  });
});
