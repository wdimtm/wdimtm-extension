/**
 * Uploads the Chrome Web Store zip, and optionally submits the draft for review.
 *
 * Credentials stay in the environment. Nothing in this file is a secret, which
 * is why it ships with the public tree: the refresh token is what can publish.
 *
 *   npm run store:upload                 # package, then upload a draft
 *   npm run store:upload -- --submit     # package, upload, and submit for review
 *   npm run store:publish                # submit the draft already uploaded
 *
 * The API rejects a second upload of the same manifest version, so publish does
 * not build or upload again. The item itself must already exist; the dashboard
 * is still where the listing and the privacy tab are filled in.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

export const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Env var names, in the order a missing-credentials error lists them. */
export const CREDENTIALS = [
  ["clientId", "CWS_CLIENT_ID"],
  ["clientSecret", "CWS_CLIENT_SECRET"],
  ["refreshToken", "CWS_REFRESH_TOKEN"],
  ["publisherId", "CWS_PUBLISHER_ID"],
  ["extensionId", "CWS_EXTENSION_ID"],
];

const PENDING = new Set(["IN_PROGRESS", "UPLOAD_IN_PROGRESS"]);

const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

export function readConfig(env) {
  const config = {};
  const missing = [];
  for (const [key, name] of CREDENTIALS) {
    const value = typeof env[name] === "string" ? env[name].trim() : "";
    if (!value) missing.push(name);
    else config[key] = value;
  }
  if (missing.length) {
    const error = new Error(
      `Missing ${missing.join(", ")}. Set them in the environment; this script does not read credentials from the repo.`
    );
    error.missing = missing;
    return { ok: false, error, missing };
  }
  for (const label of ["publisherId", "extensionId"]) {
    if (/[/?#]/.test(config[label])) {
      const error = new Error(`${label} contains a character that cannot go in the API path.`);
      error.missing = [];
      return { ok: false, error, missing: [] };
    }
  }
  return { ok: true, config };
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  const submit = args.includes("--submit");
  const submitOnly = args.includes("--submit-only");
  if (submit && submitOnly) {
    throw new Error("Pass either --submit or --submit-only, not both.");
  }
  return { submit, submitOnly };
}

export function resourceName(publisherId, extensionId) {
  return `publishers/${publisherId}/items/${extensionId}`;
}

export function uploadUrl(name) {
  return `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`;
}

export function statusUrl(name) {
  return `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`;
}

export function publishUrl(name) {
  return `https://chromewebstore.googleapis.com/v2/${name}:publish`;
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function redact(text, secrets) {
  let out = String(text);
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function apiError(what, status, body, secrets = []) {
  const detail = redact(
    body?.error?.message || body?.error_description || body?.raw || "",
    secrets
  );
  const suffix = detail ? `: ${detail}` : "";
  return new Error(`Chrome Web Store ${what} failed (${status})${suffix}`);
}

function uploadState(body) {
  return body?.uploadState || body?.lastAsyncUploadState || "";
}

function assertVersion(body, expectedVersion) {
  if (!expectedVersion || !body?.crxVersion) return;
  if (body.crxVersion !== expectedVersion) {
    throw new Error(
      `Store accepted version ${body.crxVersion}, but this package is ${expectedVersion}.`
    );
  }
}

async function accessToken(config, fetchImpl) {
  const secrets = [config.clientSecret, config.refreshToken];
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const body = await readBody(response);
  if (!response.ok || !body.access_token) {
    throw apiError("token", response.status, body, secrets);
  }
  return body.access_token;
}

async function waitUntilUploaded({
  url,
  headers,
  fetchImpl,
  sleep,
  maxPolls,
  pollIntervalMs,
  secrets,
}) {
  let last = {};
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    await sleep(pollIntervalMs);
    const response = await fetchImpl(url, { method: "GET", headers });
    const body = await readBody(response);
    if (!response.ok) throw apiError("status", response.status, body, secrets);
    last = body;
    const state = uploadState(body);
    if (state === "SUCCEEDED") return body;
    if (PENDING.has(state)) continue;
    throw new Error(`Upload ${state || "did not finish"}.`);
  }
  throw new Error(
    `Upload still ${uploadState(last) || "in progress"} after ${maxPolls} checks.`
  );
}

async function putZip({
  config,
  zip,
  expectedVersion,
  token,
  fetchImpl,
  sleep,
  maxPolls,
  pollIntervalMs,
  secrets,
}) {
  const name = resourceName(config.publisherId, config.extensionId);
  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetchImpl(uploadUrl(name), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: zip,
  });
  const body = await readBody(response);
  if (!response.ok) throw apiError("upload", response.status, body, secrets);

  let uploaded = body;
  const state = uploadState(body);
  if (PENDING.has(state)) {
    uploaded = await waitUntilUploaded({
      url: statusUrl(name),
      headers,
      fetchImpl,
      sleep,
      maxPolls,
      pollIntervalMs,
      secrets,
    });
  } else if (state !== "SUCCEEDED") {
    throw new Error(`Upload ${state || "failed"}.`);
  }
  assertVersion(body.crxVersion ? body : uploaded, expectedVersion);
  return { itemId: body.itemId || uploaded.itemId || config.extensionId, crxVersion: body.crxVersion };
}

async function submitDraft({ config, token, fetchImpl, secrets }) {
  const response = await fetchImpl(publishUrl(resourceName(config.publisherId, config.extensionId)), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const body = await readBody(response);
  if (!response.ok) throw apiError("publish", response.status, body, secrets);
  return body;
}

async function defaultPackageZip(repoRoot) {
  try {
    await exec(process.execPath, [path.join(repoRoot, "scripts/package.mjs")], { cwd: repoRoot });
  } catch (error) {
    const stderr = error.stderr?.toString?.() || "";
    throw new Error(stderr.trim() || "npm run package failed.");
  }
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  return {
    version: pkg.version,
    zipPath: path.join(repoRoot, "dist-package", `wdimtm-${pkg.version}.zip`),
  };
}

/**
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(root: string) => Promise<{ version: string, zipPath: string }>} [options.packageZip]
 * @param {typeof readFile} [options.readFileImpl]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export async function run({
  argv = process.argv,
  env = process.env,
  fetchImpl = globalThis.fetch,
  packageZip = defaultPackageZip,
  readFileImpl = readFile,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  repoRoot = root,
  maxPolls = 8,
  pollIntervalMs = 2000,
} = {}) {
  const { submit, submitOnly } = parseArgs(argv);
  const loaded = readConfig(env);
  if (!loaded.ok) throw loaded.error;

  const token = await accessToken(loaded.config, fetchImpl);
  const secrets = [token, loaded.config.clientSecret, loaded.config.refreshToken];
  if (submitOnly) {
    const published = await submitDraft({
      config: loaded.config,
      token,
      fetchImpl,
      secrets,
    });
    return {
      uploaded: false,
      submitted: true,
      itemId: published.itemId || loaded.config.extensionId,
      state: published.state || "",
    };
  }

  const packed = await packageZip(repoRoot);
  const zip = await readFileImpl(packed.zipPath);
  const uploaded = await putZip({
    config: loaded.config,
    zip,
    expectedVersion: packed.version,
    token,
    fetchImpl,
    sleep,
    maxPolls,
    pollIntervalMs,
    secrets,
  });

  if (!submit) {
    return {
      uploaded: true,
      submitted: false,
      version: packed.version,
      itemId: uploaded.itemId,
    };
  }

  const published = await submitDraft({ config: loaded.config, token, fetchImpl, secrets });
  return {
    uploaded: true,
    submitted: true,
    version: packed.version,
    itemId: published.itemId || uploaded.itemId,
    state: published.state || "",
  };
}

export function formatResult(result) {
  if (result.uploaded && result.submitted) {
    return `Uploaded ${result.version} and submitted ${result.itemId} for review (${result.state}).`;
  }
  if (result.submitted) {
    return `Submitted ${result.itemId} for review (${result.state}). This sends the draft already uploaded; it does not build a new zip.`;
  }
  return `Uploaded ${result.version} as a draft (${result.itemId}).\nSubmit it with npm run store:publish.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await run();
    console.log(formatResult(result));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
