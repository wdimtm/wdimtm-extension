/**
 * Minimal ZIP reader for export archives (#49).
 *
 * Official exports arrive zipped, and a ChatGPT archive is mostly ballast: of
 * 527MB across 619 files, the conversation JSON is 65MB. So this reads the
 * central directory and inflates only the entries the caller asks for, rather
 * than expanding the archive.
 *
 * Everything goes through `Blob.slice()`, which is lazy, so the bytes we skip
 * are never read off disk at all.
 *
 * Deliberately not a general ZIP library: stored and deflated entries, ZIP64
 * sizes, nothing else. Encrypted or otherwise exotic entries are reported as
 * unsupported rather than silently mangled.
 */

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;

const EOCD_MIN_SIZE = 22;
/** A ZIP comment is a 16-bit length, so the record starts within this window. */
const MAX_COMMENT = 0xffff;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Marker meaning "the real value lives in the ZIP64 extra field". */
const ZIP64_MARKER = 0xffffffff;

/**
 * @typedef {Object} ZipEntry
 * @property {string} name
 * @property {number} method
 * @property {number} compressedSize
 * @property {number} uncompressedSize
 * @property {number} localOffset
 * @property {boolean} encrypted
 */

/**
 * A cheap name check, used to route a picked file. The signature is verified
 * when the archive is actually read.
 * @param {{ name?: string, type?: string }} file
 */
export function looksLikeZip(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".zip")) return true;
  return file?.type === "application/zip" || file?.type === "application/x-zip-compressed";
}

/**
 * Read the central directory.
 *
 * @param {Blob} blob
 * @returns {Promise<ZipEntry[]>}
 */
export async function listZipEntries(blob) {
  const eocd = await findEndOfCentralDirectory(blob);
  const view = new DataView(
    await blob.slice(eocd.centralOffset, eocd.centralOffset + eocd.centralSize).arrayBuffer()
  );

  /** @type {ZipEntry[]} */
  const entries = [];
  let cursor = 0;

  for (let i = 0; i < eocd.entryCount; i += 1) {
    if (cursor + 46 > view.byteLength) break;
    if (view.getUint32(cursor, true) !== CENTRAL_SIG) break;

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    let compressedSize = view.getUint32(cursor + 20, true);
    let uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    let localOffset = view.getUint32(cursor + 42, true);

    // Bit 11 promises UTF-8; without it the spec says CP437. Names are decoded
    // as UTF-8 either way, because every archive we care about is UTF-8 and a
    // mis-decoded name only affects which entries match, never their contents.
    const nameStart = cursor + 46;
    const name = new TextDecoder("utf-8").decode(
      new Uint8Array(view.buffer, view.byteOffset + nameStart, nameLength)
    );

    const extra = new DataView(view.buffer, view.byteOffset + nameStart + nameLength, extraLength);
    const zip64 = readZip64Extra(extra, {
      uncompressedSize,
      compressedSize,
      localOffset,
    });
    uncompressedSize = zip64.uncompressedSize;
    compressedSize = zip64.compressedSize;
    localOffset = zip64.localOffset;

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
      // Bit 0 is the classic encryption flag; strong encryption also sets it.
      encrypted: (flags & 0x1) !== 0,
    });

    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Inflate one entry and decode it as UTF-8 text.
 *
 * @param {Blob} blob
 * @param {ZipEntry} entry
 * @returns {Promise<string>}
 */
export async function readZipEntryText(blob, entry) {
  if (entry.encrypted) throw new Error(`Encrypted zip entry: ${entry.name}`);
  if (entry.method !== METHOD_STORE && entry.method !== METHOD_DEFLATE) {
    throw new Error(`Unsupported zip compression (method ${entry.method}): ${entry.name}`);
  }

  // The local header repeats the name and carries its own extra field, whose
  // length routinely differs from the central one — so the data offset has to
  // be computed from the local header, never the central directory's.
  const header = new DataView(
    await blob.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer()
  );
  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;

  const compressed = blob.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === METHOD_STORE) return compressed.text();

  const stream = compressed.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/**
 * @param {Blob} blob
 */
async function findEndOfCentralDirectory(blob) {
  const tailSize = Math.min(blob.size, EOCD_MIN_SIZE + MAX_COMMENT);
  const tailStart = blob.size - tailSize;
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
  const view = new DataView(tail.buffer);

  // Scan backwards: the last match is the real record, since a comment could
  // contain the signature by coincidence.
  let eocdOffset = -1;
  for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Not a zip file, or the archive is truncated.");

  let entryCount = view.getUint16(eocdOffset + 10, true);
  let centralSize = view.getUint32(eocdOffset + 12, true);
  let centralOffset = view.getUint32(eocdOffset + 16, true);

  const needsZip64 =
    entryCount === 0xffff || centralSize === ZIP64_MARKER || centralOffset === ZIP64_MARKER;
  if (needsZip64) {
    const zip64 = await readZip64Eocd(blob, tail, view, eocdOffset, tailStart);
    if (zip64) {
      entryCount = zip64.entryCount;
      centralSize = zip64.centralSize;
      centralOffset = zip64.centralOffset;
    }
  }

  return { entryCount, centralSize, centralOffset };
}

/**
 * @param {Blob} blob
 * @param {Uint8Array} tail
 * @param {DataView} view
 * @param {number} eocdOffset
 * @param {number} tailStart
 */
async function readZip64Eocd(blob, tail, view, eocdOffset, tailStart) {
  const locatorOffset = eocdOffset - 20;
  if (locatorOffset < 0) return null;
  if (view.getUint32(locatorOffset, true) !== EOCD64_LOCATOR_SIG) return null;

  const recordOffset = Number(view.getBigUint64(locatorOffset + 8, true));
  const record = new DataView(await blob.slice(recordOffset, recordOffset + 56).arrayBuffer());
  if (record.getUint32(0, true) !== EOCD64_SIG) return null;

  return {
    entryCount: Number(record.getBigUint64(32, true)),
    centralSize: Number(record.getBigUint64(40, true)),
    centralOffset: Number(record.getBigUint64(48, true)),
  };
}

/**
 * ZIP64 stores oversized values in an extra field, and only the ones that
 * overflowed — so they are read in order, skipping any that fitted.
 *
 * @param {DataView} extra
 * @param {{ uncompressedSize: number, compressedSize: number, localOffset: number }} sizes
 */
function readZip64Extra(extra, sizes) {
  const out = { ...sizes };
  let cursor = 0;

  while (cursor + 4 <= extra.byteLength) {
    const headerId = extra.getUint16(cursor, true);
    const size = extra.getUint16(cursor + 2, true);
    const body = cursor + 4;

    if (headerId === 0x0001) {
      let at = body;
      if (out.uncompressedSize === ZIP64_MARKER && at + 8 <= body + size) {
        out.uncompressedSize = Number(extra.getBigUint64(at, true));
        at += 8;
      }
      if (out.compressedSize === ZIP64_MARKER && at + 8 <= body + size) {
        out.compressedSize = Number(extra.getBigUint64(at, true));
        at += 8;
      }
      if (out.localOffset === ZIP64_MARKER && at + 8 <= body + size) {
        out.localOffset = Number(extra.getBigUint64(at, true));
      }
      break;
    }

    cursor = body + size;
  }

  return out;
}
