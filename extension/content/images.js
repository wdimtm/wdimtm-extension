/**
 * Content-script image helpers — upload, paste, drop.
 *
 * DOM-side counterpart of `core/images.js`: reading files, decoding them and
 * re-encoding through a canvas needs `document`, so it cannot live in core.
 * Limits and validation come from core, so the two halves cannot drift.
 */

import {
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  dataUrlBytes,
  isSupportedImageType,
  newAttachmentId,
} from "../../core/images.js";

export { MAX_ATTACHMENTS };

/** Small originals are kept as-is so pasted screenshot text stays crisp. */
const KEEP_ORIGINAL_BYTES = 400_000;
/** Longest edge of the thumbnail rendered in the panel. */
const PREVIEW_EDGE = 200;

/**
 * @param {Blob | File} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read image."));
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image."));
    img.src = src;
  });
}

/**
 * Draw the image into a JPEG of at most `maxEdge` on its longest side. Alpha
 * is flattened onto white because JPEG has no alpha channel.
 * @param {HTMLImageElement} img
 * @param {number} maxEdge
 * @param {number} quality
 * @returns {{ dataUrl: string, width: number, height: number, mimeType: string }}
 */
function encodeAt(img, maxEdge, quality) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable on this page.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", quality),
    width: w,
    height: h,
    mimeType: "image/jpeg",
  };
}

/**
 * Downscale + re-encode until the payload fits under MAX_IMAGE_BYTES.
 * @param {HTMLImageElement} img
 */
function encodeFitted(img) {
  let maxEdge = MAX_IMAGE_EDGE;
  for (const quality of [0.85, 0.7, 0.55]) {
    const encoded = encodeAt(img, maxEdge, quality);
    if (dataUrlBytes(encoded.dataUrl) <= MAX_IMAGE_BYTES) return encoded;
    // Still too heavy — shrink as well as drop quality on the next pass.
    maxEdge = Math.round(maxEdge * 0.75);
  }
  throw new Error("Image is too large after compression.");
}

/**
 * Thumbnail for the composer strip and the sent-message bubble. The UI
 * re-renders on every turn, so it must not re-serialize a megabyte of base64
 * into the DOM each time.
 * @param {HTMLImageElement} img
 */
function makePreview(img) {
  try {
    return encodeAt(img, PREVIEW_EDGE, 0.7).dataUrl;
  } catch {
    return undefined;
  }
}

/**
 * @param {File | Blob} file
 * @param {'upload' | 'paste' | 'drop'} source
 * @returns {Promise<import("../../core/images.js").ImageAttachment>}
 */
export async function fileToAttachment(file, source) {
  const type = String(file.type || "").toLowerCase();
  if (!isSupportedImageType(type)) {
    throw new Error(`Unsupported image type: ${type || "unknown"}`);
  }
  const original = await blobToDataUrl(file);
  const img = await loadImage(original);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const bytes = dataUrlBytes(original);

  const fitsAsIs =
    Math.max(srcW, srcH) <= MAX_IMAGE_EDGE &&
    bytes <= KEEP_ORIGINAL_BYTES &&
    type !== "image/gif";

  const encoded = fitsAsIs
    ? { dataUrl: original, width: srcW, height: srcH, mimeType: type }
    : encodeFitted(img);

  return {
    id: newAttachmentId(),
    name: String(/** @type {File} */ (file).name || "image").slice(0, 120),
    mimeType: encoded.mimeType,
    dataUrl: encoded.dataUrl,
    previewUrl: makePreview(img),
    width: encoded.width,
    height: encoded.height,
    bytes: dataUrlBytes(encoded.dataUrl),
    source,
  };
}

/**
 * Pull image files out of a clipboard or drag payload.
 * @param {DataTransfer | null | undefined} dt
 * @returns {File[]}
 */
export function imageFilesFrom(dt) {
  if (!dt) return [];
  /** @type {File[]} */
  const files = [];
  if (dt.files?.length) {
    for (const file of Array.from(dt.files)) {
      if (isSupportedImageType(file.type)) files.push(file);
    }
  }
  // A system screenshot often shows up only as a clipboard item, not in files.
  if (!files.length && dt.items?.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && isSupportedImageType(file.type)) files.push(file);
    }
  }
  return files.slice(0, MAX_ATTACHMENTS);
}
