import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_TOTAL_BYTES,
  attachmentsWithData,
  dataUrlBytes,
  describeAttachments,
  hasImageAttachments,
  isSupportedImageType,
  normalizeAttachment,
  parseImageDataUrl,
  sanitizeAttachments,
  sanitizeThreadAttachments,
  stripAttachmentPayloads,
  toChatContent,
  toProviderMessages,
} from "../../core/images.js";
import { buildChatSystemPrompt } from "../../extension/lib/chat.js";

/** 1x1 transparent PNG. */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** @param {number} bytes */
function dataUrlOfSize(bytes) {
  const b64Length = Math.ceil(bytes / 3) * 4;
  return `data:image/jpeg;base64,${"A".repeat(b64Length)}`;
}

function attachment(overrides = {}) {
  return { id: "a1", name: "shot.png", dataUrl: TINY_PNG, source: "upload", ...overrides };
}

describe("image data URLs", () => {
  it("accepts supported image types only", () => {
    assert.equal(isSupportedImageType("image/png"), true);
    assert.equal(isSupportedImageType("IMAGE/JPEG"), true);
    assert.equal(isSupportedImageType("image/svg+xml"), false);
    assert.equal(isSupportedImageType("application/pdf"), false);
  });

  it("parses base64 image data URLs and rejects anything else", () => {
    assert.equal(parseImageDataUrl(TINY_PNG)?.mimeType, "image/png");
    assert.equal(parseImageDataUrl("https://example.com/cat.png"), null);
    assert.equal(parseImageDataUrl("data:text/html;base64,PHNjcmlwdD4="), null);
    // SVG can carry script — never accept it as an attachment.
    assert.equal(parseImageDataUrl("data:image/svg+xml;base64,PHN2Zz4="), null);
  });

  it("estimates decoded size without decoding", () => {
    assert.equal(dataUrlBytes("data:image/png;base64,AAAA"), 3);
    assert.equal(dataUrlBytes("data:image/png;base64,AAA="), 2);
    assert.equal(dataUrlBytes("data:image/png;base64,AA=="), 1);
    assert.equal(dataUrlBytes(""), 0);
  });
});

describe("attachment normalization", () => {
  it("keeps a well-formed attachment and fills in metadata", () => {
    const item = normalizeAttachment(attachment({ width: 20, height: 10 }));
    assert.equal(item?.mimeType, "image/png");
    assert.equal(item?.width, 20);
    assert.equal(item?.source, "upload");
    assert.ok(item?.bytes > 0);
  });

  it("drops attachments without a usable payload", () => {
    assert.equal(normalizeAttachment(null), null);
    assert.equal(normalizeAttachment({ dataUrl: "" }), null);
    assert.equal(normalizeAttachment({ dataUrl: "https://example.com/a.png" }), null);
  });

  it("drops a single image over the per-image ceiling", () => {
    const tooBig = attachment({ dataUrl: dataUrlOfSize(MAX_IMAGE_BYTES + 1000) });
    assert.equal(normalizeAttachment(tooBig), null);
  });

  it("falls back to a safe source label", () => {
    assert.equal(normalizeAttachment(attachment({ source: "evil" }))?.source, "upload");
    assert.equal(normalizeAttachment(attachment({ source: "paste" }))?.source, "paste");
  });
});

describe("sanitizeAttachments", () => {
  it("caps the number of images per turn", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 3 }, (_, i) =>
      attachment({ id: `a${i}` })
    );
    assert.equal(sanitizeAttachments(many).length, MAX_ATTACHMENTS);
  });

  it("returns an empty list for non-arrays", () => {
    assert.deepEqual(sanitizeAttachments(undefined), []);
    assert.deepEqual(sanitizeAttachments("nope"), []);
  });

  it("skips images that would push the turn past the total budget", () => {
    const half = Math.floor(MAX_TOTAL_BYTES * 0.6);
    const list = [
      attachment({ id: "a", dataUrl: dataUrlOfSize(Math.min(half, MAX_IMAGE_BYTES)) }),
      attachment({ id: "b", dataUrl: dataUrlOfSize(Math.min(half, MAX_IMAGE_BYTES)) }),
      attachment({ id: "c", dataUrl: dataUrlOfSize(Math.min(half, MAX_IMAGE_BYTES)) }),
    ];
    const total = sanitizeAttachments(list).reduce((sum, a) => sum + (a.bytes || 0), 0);
    assert.ok(total <= MAX_TOTAL_BYTES);
  });
});

describe("previews", () => {
  it("keeps a small, well-formed preview", () => {
    const item = normalizeAttachment(attachment({ previewUrl: TINY_PNG }));
    assert.equal(item?.previewUrl, TINY_PNG);
  });

  it("drops a preview that is not an image data URL", () => {
    const item = normalizeAttachment(
      attachment({ previewUrl: "javascript:alert(1)" })
    );
    assert.equal(item?.previewUrl, undefined);
  });

  it("drops an oversized preview", () => {
    const item = normalizeAttachment(
      attachment({ previewUrl: dataUrlOfSize(MAX_PREVIEW_BYTES + 5000) })
    );
    assert.equal(item?.previewUrl, undefined);
  });

  it("never sends the preview to the model", () => {
    const content = toChatContent("hi", [
      normalizeAttachment(attachment({ previewUrl: TINY_PNG })),
    ]);
    assert.equal(content.length, 2);
    assert.equal(content[1].image_url.url, TINY_PNG);
  });
});

describe("persistence", () => {
  it("strips base64 payloads but keeps the stub", () => {
    const stripped = stripAttachmentPayloads([
      normalizeAttachment(attachment({ width: 8, height: 8 })),
    ]);
    assert.equal(stripped[0].dataUrl, undefined);
    assert.equal(stripped[0].name, "shot.png");
    assert.equal(stripped[0].width, 8);
  });

  it("keeps the thumbnail so a resumed thread still shows what was sent", () => {
    const stripped = stripAttachmentPayloads([
      normalizeAttachment(attachment({ previewUrl: TINY_PNG })),
    ]);
    assert.equal(stripped[0].previewUrl, TINY_PNG);
    assert.equal(stripped[0].dataUrl, undefined);
  });

  it("ignores stubs when building a request", () => {
    const stubs = stripAttachmentPayloads([normalizeAttachment(attachment())]);
    assert.equal(attachmentsWithData(stubs).length, 0);
    assert.equal(toChatContent("hi", stubs), "hi");
  });
});

describe("provider messages", () => {
  it("leaves text-only turns as plain strings", () => {
    assert.equal(toChatContent("what is this?", []), "what is this?");
  });

  it("folds images into the multimodal content form", () => {
    const content = toChatContent("what is this?", [attachment()]);
    assert.ok(Array.isArray(content));
    assert.deepEqual(content[0], { type: "text", text: "what is this?" });
    assert.equal(content[1].type, "image_url");
    assert.equal(content[1].image_url.url, TINY_PNG);
  });

  it("allows an image-only turn with no text part", () => {
    const content = toChatContent("   ", [attachment()]);
    assert.equal(content.length, 1);
    assert.equal(content[0].type, "image_url");
  });

  it("never attaches images to assistant turns", () => {
    const mapped = toProviderMessages([
      { role: "assistant", content: "earlier reply", attachments: [attachment()] },
      { role: "user", content: "and this?", attachments: [attachment()] },
    ]);
    assert.equal(mapped[0].content, "earlier reply");
    assert.ok(Array.isArray(mapped[1].content));
  });

  it("drops non-message fields the UI carries, such as webSearch meta", () => {
    const mapped = toProviderMessages([
      { role: "assistant", content: "hi", webSearch: { used: true } },
    ]);
    assert.deepEqual(Object.keys(mapped[0]).sort(), ["content", "role"]);
  });

  it("detects whether a thread carries images", () => {
    assert.equal(hasImageAttachments([{ role: "user", content: "hi" }]), false);
    assert.equal(
      hasImageAttachments([{ role: "user", content: "hi", attachments: [attachment()] }]),
      true
    );
  });
});

describe("thread-wide budget", () => {
  it("keeps the newest images and drops older ones when over budget", () => {
    const big = Math.min(MAX_IMAGE_BYTES, Math.floor(MAX_TOTAL_BYTES / 2) + 1000);
    const thread = [
      { role: "user", content: "first", attachments: [attachment({ id: "old", dataUrl: dataUrlOfSize(big) })] },
      { role: "assistant", content: "…" },
      { role: "user", content: "second", attachments: [attachment({ id: "mid", dataUrl: dataUrlOfSize(big) })] },
      { role: "assistant", content: "…" },
      { role: "user", content: "third", attachments: [attachment({ id: "new", dataUrl: dataUrlOfSize(big) })] },
    ];
    const out = sanitizeThreadAttachments(thread);
    assert.ok(out[4].attachments?.length, "newest turn keeps its image");
    assert.equal(out[0].attachments, undefined, "oldest turn is trimmed");
  });

  it("leaves text-only threads untouched", () => {
    const out = sanitizeThreadAttachments([{ role: "user", content: "hi" }]);
    assert.equal(out[0].content, "hi");
    assert.equal(out[0].attachments, undefined);
  });
});

describe("describeAttachments", () => {
  it("counts the images", () => {
    const list = [attachment({ id: "1" }), attachment({ id: "2" })];
    assert.match(describeAttachments(list), /Attached: 2 images\./);
    assert.match(describeAttachments(list, true), /已附带 2 张图片。/);
    assert.match(describeAttachments([attachment()]), /Attached: 1 image\./);
  });

  it("returns nothing for an empty list", () => {
    assert.equal(describeAttachments([]), "");
  });
});

describe("chat system prompt", () => {
  const base = {
    selection: "a chart",
    page: { url: "https://example.com", title: "Example" },
  };

  it("tells the model about attached images only when there are some", () => {
    const withImages = buildChatSystemPrompt({ ...base, hasAttachments: true });
    assert.match(withImages, /attached one or more images/i);
    assert.doesNotMatch(buildChatSystemPrompt(base), /attached one or more images/i);
  });
});
