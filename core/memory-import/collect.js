/**
 * The single seam every input path converges on (#49).
 *
 *   a .zip        ─┐
 *   a folder      ─┼─► collectJsonEntries() ─► [{ name, text }] ─► parseExport()
 *   picked files  ─┤
 *   a drop        ─┘
 *
 * Below this line nothing knows how the bytes arrived, and the classification
 * that follows is unchanged: each entry is sniffed and routed by what it turns
 * out to be, never by what the user said it was.
 */

import { listZipEntries, looksLikeZip, readZipEntryText } from "./zip.js";

/**
 * @typedef {Object} JsonEntry
 * @property {string} name
 * @property {string} text
 *
 * @typedef {Object} CollectResult
 * @property {JsonEntry[]} entries   Sorted by name, so batching stays deterministic.
 * @property {string[]} skipped      Non-JSON, reported rather than silently dropped.
 * @property {string[]} failed       JSON we could not read, with the reason.
 */

/** @param {string} name */
function isJsonName(name) {
  return name.toLowerCase().endsWith(".json");
}

/**
 * Archive housekeeping, not user data.
 * @param {string} name
 */
function isArchiveNoise(name) {
  const base = name.split("/").pop() || "";
  return name.startsWith("__MACOSX/") || base.startsWith("._") || base === ".DS_Store";
}

/**
 * @param {File[]} files
 * @returns {Promise<CollectResult>}
 */
export async function collectJsonEntries(files) {
  /** @type {JsonEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const skipped = [];
  /** @type {string[]} */
  const failed = [];

  for (const file of files) {
    if (looksLikeZip(file)) {
      await collectFromZip(file, entries, skipped, failed);
      continue;
    }

    // A directory pick hands over every file in the export — 619 of them for a
    // real ChatGPT archive, 412MB of which is attachments. Filtering by name
    // first means those bytes are never read: File objects are lazy.
    const name = file.webkitRelativePath || file.name;
    if (isArchiveNoise(name)) continue;
    if (!isJsonName(name)) {
      skipped.push(name);
      continue;
    }

    try {
      entries.push({ name, text: await file.text() });
    } catch (err) {
      failed.push(`${name}: ${describe(err)}`);
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, skipped, failed };
}

/**
 * @param {File} file
 * @param {JsonEntry[]} entries
 * @param {string[]} skipped
 * @param {string[]} failed
 */
async function collectFromZip(file, entries, skipped, failed) {
  /** @type {import('./zip.js').ZipEntry[]} */
  let zipEntries;
  try {
    zipEntries = await listZipEntries(file);
  } catch (err) {
    failed.push(`${file.name}: ${describe(err)}`);
    return;
  }

  for (const entry of zipEntries) {
    if (isArchiveNoise(entry.name)) continue;
    // Directory markers are zero-length names ending in a slash.
    if (entry.name.endsWith("/")) continue;
    if (!isJsonName(entry.name)) {
      skipped.push(entry.name);
      continue;
    }

    try {
      entries.push({ name: entry.name, text: await readZipEntryText(file, entry) });
    } catch (err) {
      failed.push(`${entry.name}: ${describe(err)}`);
    }
  }
}

/** @param {unknown} err */
function describe(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Flatten a drop into plain files.
 *
 * A dropped folder arrives as a directory entry rather than a file, so it has
 * to be walked. Dropping the zip straight from Downloads is the common case and
 * needs none of this.
 *
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<File[]>}
 */
export async function filesFromDrop(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  const roots = items
    .filter((item) => item.kind === "file")
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null));

  if (!roots.some(Boolean)) return [...(dataTransfer.files || [])];

  /** @type {File[]} */
  const out = [];
  for (const entry of roots) {
    if (entry) await walkEntry(entry, out);
  }
  return out;
}

/**
 * @param {any} entry
 * @param {File[]} out
 */
async function walkEntry(entry, out) {
  if (entry.isFile) {
    out.push(await new Promise((resolve, reject) => entry.file(resolve, reject)));
    return;
  }
  if (!entry.isDirectory) return;

  const reader = entry.createReader();
  // readEntries returns a batch at a time and signals the end with an empty
  // array; a single call would quietly truncate a large export.
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    for (const child of batch) await walkEntry(child, out);
  }
}
