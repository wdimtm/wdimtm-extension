import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import {
  createCloudAuthProvider,
  createCloudSyncProvider,
} from "../../core/auth/cloud.js";
import { mergeLastWriteWins, createLocalAuthProvider } from "../../core/auth/local.js";
import { buildUserDataSnapshot } from "../../extension/lib/auth/index.js";

describe("auth/sync", () => {
  it("mergeLastWriteWins prefers newer updatedAt", () => {
    const a = { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", profileText: "old" };
    const b = { version: 1, updatedAt: "2026-06-01T00:00:00.000Z", profileText: "new" };
    assert.equal(mergeLastWriteWins(a, b).profileText, "new");
    assert.equal(mergeLastWriteWins(b, a).profileText, "new");
  });

  it("local auth cannot sign in", async () => {
    const auth = createLocalAuthProvider();
    assert.equal(await auth.getSession(), null);
    await assert.rejects(() => auth.signIn(), /Local mode/);
  });

  it("buildUserDataSnapshot strips API keys", () => {
    const snap = buildUserDataSnapshot(
      {
        profileText: "eng",
        apiKey: "sk-secret",
        customLenses: [],
        defaultLensId: "general",
      },
      [{ id: "1", text: "m" }]
    );
    assert.equal(snap.profileText, "eng");
    assert.equal(snap.memories.length, 1);
    assert.equal(snap.preferences.apiKey, undefined);
    assert.ok(!JSON.stringify(snap).includes("sk-secret"));
  });

  it("buildUserDataSnapshot keeps the cloud endpoint but never the cloud token", () => {
    const snap = buildUserDataSnapshot(
      {
        cloudBaseUrl: "https://cloud.example",
        cloudAccessToken: "cloud-secret",
        defaultLensId: "general",
      },
      []
    );
    assert.equal(snap.preferences.cloudBaseUrl, "https://cloud.example");
    assert.ok(!JSON.stringify(snap).includes("cloud-secret"));
  });
});

describe("cloud sync provider (#51)", () => {
  it("refuses to sync when the cloud is not configured", async () => {
    const provider = createCloudSyncProvider({ baseUrl: "", accessToken: "" });
    assert.equal(await provider.pull(), null);
    await assert.rejects(
      () => provider.push({ version: 1, updatedAt: new Date().toISOString() }),
      /not configured/i
    );
  });

  it("pulls, pushes and merges last-write-wins", async () => {
    /** @type {any} */
    let stored = { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", profileText: "cloud" };
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      if (req.method === "POST") {
        stored = JSON.parse(Buffer.concat(chunks).toString("utf8")).snapshot;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, updatedAt: stored.updatedAt }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ snapshot: stored }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const provider = createCloudSyncProvider({
        baseUrl: `http://127.0.0.1:${port}`,
        accessToken: "tok",
      });
      const remote = await provider.pull();
      assert.equal(remote.profileText, "cloud");

      const local = { version: 1, updatedAt: "2026-07-01T00:00:00.000Z", profileText: "local" };
      assert.equal(provider.merge(local, remote).profileText, "local");

      await provider.push(local);
      assert.equal(stored.profileText, "local");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("migrates local memories up without deleting the cloud copy", async () => {
    /** @type {any} */
    let stored = null;
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      if (req.method === "POST") {
        stored = JSON.parse(Buffer.concat(chunks).toString("utf8")).snapshot;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (!stored) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no snapshot" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ snapshot: stored }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const provider = createCloudSyncProvider({
        baseUrl: `http://127.0.0.1:${port}`,
        accessToken: "tok",
      });
      const local = {
        version: 1,
        updatedAt: "2026-08-01T00:00:00.000Z",
        memories: [{ id: "m1" }, { id: "m2" }],
      };
      const first = await provider.migrateLocalToCloud(local);
      assert.equal(first.action, "uploaded");
      assert.equal(stored.memories.length, 2);

      // Second run must not clobber a cloud copy that is already newer.
      stored = { version: 1, updatedAt: "2026-09-01T00:00:00.000Z", memories: [{ id: "m9" }] };
      const second = await provider.migrateLocalToCloud(local);
      assert.equal(second.action, "kept_cloud");
      assert.equal(stored.memories[0].id, "m9");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("cloud auth provider (#51 Google sign-in)", () => {
  function fakes({ googleToken = "ya29.fake" } = {}) {
    /** @type {any} */
    let stored = null;
    return {
      calls: [],
      config: { baseUrl: "https://cloud.test", accessToken: "" },
      getGoogleToken: async ({ interactive } = {}) => {
        if (!googleToken) throw new Error("User cancelled Google sign-in.");
        return { token: googleToken, interactive };
      },
      persist: async (session) => {
        stored = session;
      },
      read: async () => stored,
    };
  }

  it("exchanges the Google token for a WDIMTM session and persists it", async () => {
    const f = fakes();
    const provider = createCloudAuthProvider({
      config: f.config,
      getGoogleToken: f.getGoogleToken,
      persistSession: f.persist,
      readSession: f.read,
      exchange: async (config, googleAccessToken) => {
        f.calls.push({ config, googleAccessToken });
        return {
          accessToken: "wdimtm-session-token",
          expiresAt: "2026-12-01T00:00:00.000Z",
          user: { id: "usr_1", email: "user@example.com" },
          plan: "cloud",
        };
      },
    });

    const session = await provider.signIn();
    assert.equal(session.userId, "usr_1");
    assert.equal(session.email, "user@example.com");
    assert.equal(session.provider, "google");
    assert.equal(session.accessToken, "wdimtm-session-token");
    assert.equal(f.calls[0].googleAccessToken, "ya29.fake");

    const restored = await provider.getSession();
    assert.equal(restored.email, "user@example.com");
  });

  it("refuses to sign in when the cloud endpoint is not configured", async () => {
    const f = fakes();
    const provider = createCloudAuthProvider({
      config: { baseUrl: "" },
      getGoogleToken: f.getGoogleToken,
      persistSession: f.persist,
      readSession: f.read,
      exchange: async () => {
        throw new Error("should not be called");
      },
    });
    await assert.rejects(() => provider.signIn(), /not configured/i);
  });

  it("surfaces a cancelled Google prompt as a plain message", async () => {
    const f = fakes({ googleToken: "" });
    const provider = createCloudAuthProvider({
      config: f.config,
      getGoogleToken: f.getGoogleToken,
      persistSession: f.persist,
      readSession: f.read,
      exchange: async () => ({}),
    });
    await assert.rejects(() => provider.signIn(), /cancel/i);
  });

  it("signs out locally even when the server call fails", async () => {
    const f = fakes();
    await f.persist({ userId: "u", accessToken: "t" });
    const provider = createCloudAuthProvider({
      config: f.config,
      getGoogleToken: f.getGoogleToken,
      persistSession: f.persist,
      readSession: f.read,
      exchange: async () => ({}),
      revoke: async () => {
        throw new Error("network down");
      },
    });
    await provider.signOut();
    assert.equal(await provider.getSession(), null);
  });
});
