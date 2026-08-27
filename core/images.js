/**
 * Image attachments for page chat — uploads and pasted screenshots.
 *
 * Pure logic only (no DOM, no chrome APIs) so the background worker and the
 * unit tests can share it. The content script has its own DOM-side helpers in
 * `content/images.global.js`; the limits below are mirrored there and must stay
 * in sync.
 *
 * @typedef {Object} ImageAttachment
 * @property {string} id
 * @property {string} name
 * @property {string} mimeType
 * @property {string} [dataUrl]   // base64 data URL; stripped before persisting
 * @property {string} [previewUrl] // small thumbnail for the UI; never sent to the model
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [bytes]
 * @property {'upload' | 'paste' | 'drop'} [source]
 */

/** Attachments allowed on a single chat turn. */
export const MAX_ATTACHMENTS = 4;
/** Longest edge after downscaling — enough detail for charts, cheap in tokens. */
export const MAX_IMAGE_EDGE = 1568;
/** Per-image ceiling after compression. */
export const MAX_IMAGE_BYTES = 1_500_000;
/** Ceiling for one turn — keeps the request body inside provider limits. */
export const MAX_TOTAL_BYTES = 4_000_000;
/** Thumbnails are kept across reloads, so they must stay small. */
export const MAX_PREVIEW_BYTES = 64_000;

export const SUPPORTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

/** @param {string} type */
export function isSupportedImageType(type) {
  return SUPPORTED_IMAGE_TYPES.includes(String(type || "").toLowerCase());
}

/**
 * Decoded byte size of a base64 data URL, without decoding it.
 * @param {string} dataUrl
 */
export function dataUrlBytes(dataUrl) {
  const str = String(dataUrl || "");
  const comma = str.indexOf(",");
  if (comma < 0) return 0;
  const b64 = str.slice(comma + 1).replace(/\s/g, "");
  if (!b64) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Parse `data:image/png;base64,…` and reject anything else — a chat attachment
 * must never carry an http(s) URL the model would be asked to fetch.
 * @param {string} dataUrl
 * @returns {{ mimeType: string, bytes: number } | null}
 */
export function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(String(dataUrl || ""));
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  if (!isSupportedImageType(mimeType)) return null;
  return { mimeType, bytes: dataUrlBytes(dataUrl) };
}

let idCounter = 0;

/** @param {string} [prefix] */
export function newAttachmentId(prefix = "img") {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/**
 * Normalize one untrusted attachment. Returns null when it cannot be used.
 * @param {unknown} raw
 * @returns {ImageAttachment | null}
 */
export function normalizeAttachment(raw) {
  if (!raw || typeof raw !== "object") return null;
  const item = /** @type {Record<string, unknown>} */ (raw);
  const dataUrl = typeof item.dataUrl === "string" ? item.dataUrl : "";
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) return null;
  if (parsed.bytes > MAX_IMAGE_BYTES) return null;

  // A preview is UI-only, but it is still an untrusted data URL that ends up in
  // an <img src> — validate it the same way and drop it if it is oversized.
  const rawPreview = typeof item.previewUrl === "string" ? item.previewUrl : "";
  const preview = parseImageDataUrl(rawPreview);
  const previewUrl =
    preview && preview.bytes <= MAX_PREVIEW_BYTES ? rawPreview : undefined;

  return {
    id: String(item.id || newAttachmentId()),
    name: String(item.name || "image").slice(0, 120),
    mimeType: parsed.mimeType,
    dataUrl,
    previewUrl,
    width: Number(item.width) > 0 ? Math.round(Number(item.width)) : undefined,
    height: Number(item.height) > 0 ? Math.round(Number(item.height)) : undefined,
    bytes: parsed.bytes,
    source: /** @type {ImageAttachment['source']} */ (
      ["upload", "paste", "drop"].includes(String(item.source))
        ? String(item.source)
        : "upload"
    ),
  };
}

/**
 * Cap an attachment list by count and total size. Oversized tails are dropped
 * rather than truncated so the model never receives half an image.
 * @param {unknown} list
 * @returns {ImageAttachment[]}
 */
export function sanitizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  /** @type {ImageAttachment[]} */
  const out = [];
  let total = 0;
  for (const raw of list) {
    if (out.length >= MAX_ATTACHMENTS) break;
    const item = normalizeAttachment(raw);
    if (!item) continue;
    const bytes = item.bytes || 0;
    if (total + bytes > MAX_TOTAL_BYTES) continue;
    total += bytes;
    out.push(item);
  }
  return out;
}

/**
 * Drop base64 payloads before writing a thread to storage.
 * `chrome.storage.session` has a small quota; a few screenshots would blow it.
 * The stub keeps the bubble rendering as "1 image" after a reload.
 * @param {ImageAttachment[]} [list]
 * @returns {ImageAttachment[]}
 */
export function stripAttachmentPayloads(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    // The thumbnail is small enough to keep, so a resumed thread still shows
    // what was sent — only the model-sized payload is dropped.
    previewUrl: item.previewUrl,
    width: item.width,
    height: item.height,
    bytes: item.bytes,
    source: item.source,
  }));
}

/** @param {ImageAttachment[]} [list] */
export function attachmentsWithData(list) {
  return (Array.isArray(list) ? list : []).filter((i) => Boolean(i?.dataUrl));
}

/**
 * Short human line for runtimes that cannot see images (mock, non-vision models).
 * @param {ImageAttachment[]} [list]
 * @param {boolean} [zh]
 */
export function describeAttachments(list, zh = false) {
  const n = (Array.isArray(list) ? list : []).length;
  if (!n) return "";
  return zh ? `已附带 ${n} 张图片。` : `Attached: ${n} image${n > 1 ? "s" : ""}.`;
}

/**
 * Build the OpenAI-compatible `content` for one user turn.
 * Returns a plain string when there is nothing to attach, so text-only turns
 * keep working against providers that reject the array form.
 * @param {string} text
 * @param {ImageAttachment[]} [attachments]
 * @returns {string | Array<{ type: string, text?: string, image_url?: { url: string } }>}
 */
export function toChatContent(text, attachments) {
  const images = attachmentsWithData(attachments);
  const body = String(text || "");
  if (!images.length) return body;

  /** @type {Array<{ type: string, text?: string, image_url?: { url: string } }>} */
  const content = [];
  if (body.trim()) content.push({ type: "text", text: body });
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: img.dataUrl } });
  }
  return content;
}

/**
 * Map a WDIMTM chat thread onto provider messages, folding attachments into
 * the multimodal content form.
 * @param {Array<{ role: string, content: string, attachments?: ImageAttachment[] }>} messages
 */
export function toProviderMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((m) => {
    if (m.role !== "user") return { role: m.role, content: String(m.content || "") };
    return { role: "user", content: toChatContent(m.content, m.attachments) };
  });
}

/**
 * @param {Array<{ attachments?: ImageAttachment[] }>} messages
 * @returns {boolean}
 */
export function hasImageAttachments(messages) {
  return (Array.isArray(messages) ? messages : []).some(
    (m) => attachmentsWithData(m?.attachments).length > 0
  );
}

/**
 * Sanitize every turn of an inbound thread — the content script is not trusted
 * to have enforced the limits.
 *
 * The size budget is thread-wide and spent newest-first: a long conversation
 * keeps the images the user is currently talking about and silently drops the
 * ones from earlier turns, rather than growing the request without bound.
 *
 * @param {Array<{ role: string, content: string, attachments?: unknown }>} messages
 */
export function sanitizeThreadAttachments(messages) {
  const list = Array.isArray(messages) ? messages : [];
  /** @type {Array<ImageAttachment[]>} */
  const perTurn = new Array(list.length).fill(null);
  let budget = MAX_TOTAL_BYTES;

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const candidates = sanitizeAttachments(list[i]?.attachments);
    /** @type {ImageAttachment[]} */
    const kept = [];
    for (const item of candidates) {
      const bytes = item.bytes || 0;
      if (bytes > budget) continue;
      budget -= bytes;
      kept.push(item);
    }
    perTurn[i] = kept;
  }

  return list.map((m, i) => ({
    ...m,
    attachments: perTurn[i]?.length ? perTurn[i] : undefined,
  }));
}
