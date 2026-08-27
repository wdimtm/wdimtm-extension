import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import {
  listZipEntries,
  looksLikeZip,
  readZipEntryText,
} from "../../core/memory-import/zip.js";
import { collectJsonEntries } from "../../core/memory-import/collect.js";

/**
 * Hand-assembles a ZIP so the tests pin the byte layout rather than whatever a
 * zip library happens to emit. CRC fields are left zero — the reader does not
 * verify them, and saying so here is better than implying it does.
 *
 * @param {Array<{ name: string, content: string, store?: boolean, flags?: number,
 *                 localExtra?: number, method?: number }>} files
 * @param {{ comment?: string }} [opts]
 */
function buildZip(files, opts = {}) {
  const enc = new TextEncoder();
  /** @type {Uint8Array[]} */
  const chunks = [];
  /** @type {Array<{ name: Uint8Array, method: number, flags: number, comp: Uint8Array, rawLength: number, offset: number }>} */
  const meta = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const raw = enc.encode(file.content);
    const store = file.store === true;
    const method = file.method ?? (store ? 0 : 8);
    const comp = store || method === 0 ? raw : new Uint8Array(deflateRawSync(Buffer.from(raw)));
    // A local extra field whose length differs from the central one is the
    // classic way a naive reader lands on the wrong data offset.
    const localExtra = new Uint8Array(file.localExtra || 0);

    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(6, file.flags || 0, true);
    view.setUint16(8, method, true);
    view.setUint32(18, comp.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, localExtra.length, true);

    meta.push({ name, method, flags: file.flags || 0, comp, rawLength: raw.length, offset });
    chunks.push(header, name, localExtra, comp);
    offset += header.length + name.length + localExtra.length + comp.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const entry of meta) {
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(8, entry.flags, true);
    view.setUint16(10, entry.method, true);
    view.setUint32(20, entry.comp.length, true);
    view.setUint32(24, entry.rawLength, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint32(42, entry.offset, true);
    chunks.push(header, entry.name);
    centralSize += header.length + entry.name.length;
  }

  const comment = enc.encode(opts.comment || "");
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, meta.length, true);
  view.setUint16(10, meta.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, comment.length, true);
  chunks.push(eocd, comment);

  return new Blob(chunks, { type: "application/zip" });
}

/** @param {Blob} blob @param {string} name */
function asFile(blob, name) {
  return new File([blob], name, { type: blob.type });
}

describe("looksLikeZip", () => {
  it("recognizes an archive by extension or type", () => {
    assert.equal(looksLikeZip({ name: "export.zip" }), true);
    assert.equal(looksLikeZip({ name: "EXPORT.ZIP" }), true);
    assert.equal(looksLikeZip({ name: "x", type: "application/zip" }), true);
    assert.equal(looksLikeZip({ name: "conversations.json" }), false);
  });
});

describe("listZipEntries", () => {
  it("reads names and sizes from the central directory", async () => {
    const zip = buildZip([
      { name: "conversations.json", content: '[{"a":1}]' },
      { name: "user.json", content: "{}" },
    ]);
    const entries = await listZipEntries(zip);
    assert.deepEqual(
      entries.map((e) => e.name),
      ["conversations.json", "user.json"]
    );
    assert.equal(entries[0].uncompressedSize, 9);
  });

  it("finds the record past a trailing archive comment", async () => {
    const zip = buildZip([{ name: "a.json", content: "[]" }], {
      comment: "x".repeat(300),
    });
    const entries = await listZipEntries(zip);
    assert.equal(entries.length, 1);
  });

  it("rejects something that is not a zip", async () => {
    await assert.rejects(
      () => listZipEntries(new Blob(["not a zip at all"])),
      /not a zip|truncated/i
    );
  });

  it("flags an encrypted entry instead of returning garbage", async () => {
    const zip = buildZip([{ name: "a.json", content: "[]", flags: 0x1 }]);
    const [entry] = await listZipEntries(zip);
    assert.equal(entry.encrypted, true);
    await assert.rejects(() => readZipEntryText(zip, entry), /encrypted/i);
  });
});

describe("readZipEntryText", () => {
  it("inflates a deflated entry", async () => {
    const content = JSON.stringify([{ title: "Hello", body: "x".repeat(500) }]);
    const zip = buildZip([{ name: "conversations.json", content }]);
    const [entry] = await listZipEntries(zip);
    assert.equal(entry.method, 8);
    assert.equal(await readZipEntryText(zip, entry), content);
  });

  it("reads a stored entry", async () => {
    const zip = buildZip([{ name: "a.json", content: '{"stored":true}', store: true }]);
    const [entry] = await listZipEntries(zip);
    assert.equal(entry.method, 0);
    assert.equal(await readZipEntryText(zip, entry), '{"stored":true}');
  });

  it("locates data via the local header, whose extra field differs", async () => {
    // The central directory records no extra field here while the local header
    // carries 16 bytes. Trusting the central one lands 16 bytes into the data.
    const zip = buildZip([{ name: "a.json", content: '{"ok":1}', localExtra: 16 }]);
    const [entry] = await listZipEntries(zip);
    assert.equal(await readZipEntryText(zip, entry), '{"ok":1}');
  });

  it("refuses a compression method it does not implement", async () => {
    const zip = buildZip([{ name: "a.json", content: "[]", method: 12, store: true }]);
    const [entry] = await listZipEntries(zip);
    await assert.rejects(() => readZipEntryText(zip, entry), /unsupported/i);
  });

  it("round-trips CJK content", async () => {
    const content = JSON.stringify([{ title: "开发清算机器人可行性" }]);
    const zip = buildZip([{ name: "对话.json", content }]);
    const [entry] = await listZipEntries(zip);
    assert.equal(entry.name, "对话.json");
    assert.equal(await readZipEntryText(zip, entry), content);
  });
});

describe("collectJsonEntries", () => {
  it("pulls only the JSON out of an archive and reports the rest", async () => {
    const zip = buildZip([
      { name: "conversations-000.json", content: "[1]" },
      { name: "chat.html", content: "<html>huge</html>" },
      { name: "file-abc.dat", content: "binary-ish" },
      { name: "memories.json", content: "[2]" },
    ]);
    const { entries, skipped, failed } = await collectJsonEntries([asFile(zip, "export.zip")]);
    assert.deepEqual(
      entries.map((e) => e.name),
      ["conversations-000.json", "memories.json"]
    );
    assert.deepEqual(skipped.sort(), ["chat.html", "file-abc.dat"]);
    assert.deepEqual(failed, []);
  });

  it("sorts entries by name so batching stays deterministic", async () => {
    const zip = buildZip([
      { name: "conversations-002.json", content: "[3]" },
      { name: "conversations-000.json", content: "[1]" },
      { name: "conversations-001.json", content: "[2]" },
    ]);
    const { entries } = await collectJsonEntries([asFile(zip, "export.zip")]);
    assert.deepEqual(
      entries.map((e) => e.text),
      ["[1]", "[2]", "[3]"]
    );
  });

  it("ignores archive housekeeping", async () => {
    const zip = buildZip([
      { name: "__MACOSX/._conversations.json", content: "junk" },
      { name: "conversations.json", content: "[1]" },
      { name: ".DS_Store", content: "junk" },
    ]);
    const { entries, skipped } = await collectJsonEntries([asFile(zip, "export.zip")]);
    assert.deepEqual(
      entries.map((e) => e.name),
      ["conversations.json"]
    );
    assert.ok(!skipped.includes(".DS_Store"), "noise is not reported as a skipped file");
  });

  it("takes plain picked files alongside archives", async () => {
    const zip = buildZip([{ name: "conversations.json", content: "[1]" }]);
    const loose = new File(["[2]"], "memories.json", { type: "application/json" });
    const { entries } = await collectJsonEntries([asFile(zip, "export.zip"), loose]);
    assert.deepEqual(
      entries.map((e) => e.name),
      ["conversations.json", "memories.json"]
    );
  });

  it("keeps a bad archive from sinking the files beside it", async () => {
    const broken = new File(["definitely not a zip"], "broken.zip", { type: "application/zip" });
    const loose = new File(["[1]"], "conversations.json", { type: "application/json" });
    const { entries, failed } = await collectJsonEntries([broken, loose]);
    assert.equal(entries.length, 1);
    assert.equal(failed.length, 1);
    assert.match(failed[0], /broken\.zip/);
  });

  it("uses the relative path when a whole folder was picked", async () => {
    const file = new File(["[1]"], "conversations.json", { type: "application/json" });
    Object.defineProperty(file, "webkitRelativePath", { value: "export/conversations.json" });
    const { entries } = await collectJsonEntries([file]);
    assert.equal(entries[0].name, "export/conversations.json");
  });
});
