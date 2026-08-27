/**
 * Bounded page-context extraction for WDIMTM.
 * Never sends the whole DOM — only selection + a semantic neighborhood.
 */

const MAX_SELECTION = 4000;
const MAX_CONTEXT = 2500;
const NEIGHBOR_CHARS = 600;

/**
 * @param {Selection | null} selection
 * @returns {{ selection: string, context: string } | null}
 */
export function extractFromSelection(selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const selectedText = normalizeWhitespace(selection.toString());
  if (!selectedText || selectedText.length < 2) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const context = extractNeighborhood(range, selectedText);

  return {
    selection: truncate(selectedText, MAX_SELECTION),
    context: truncate(context, MAX_CONTEXT),
  };
}

/**
 * Build page metadata for the explain request.
 * @param {string} [context]
 */
export function buildPageContext(context) {
  return {
    url: location.href,
    title: document.title || "",
    context: context || undefined,
  };
}

/**
 * Surrounding text around the selection range.
 * Prefer the nearest block container; fall back to body slice.
 * @param {Range} range
 * @param {string} selectedText
 */
function extractNeighborhood(range, selectedText) {
  const block = nearestBlock(range.commonAncestorContainer);
  if (block) {
    const blockText = normalizeWhitespace(block.innerText || block.textContent || "");
    if (blockText && blockText.length <= MAX_CONTEXT) {
      return blockText;
    }
    if (blockText) {
      return sliceAroundMatch(blockText, selectedText, NEIGHBOR_CHARS);
    }
  }

  const bodyText = normalizeWhitespace(document.body?.innerText || "");
  return sliceAroundMatch(bodyText, selectedText, NEIGHBOR_CHARS);
}

/**
 * @param {Node} node
 * @returns {HTMLElement | null}
 */
function nearestBlock(node) {
  /** @type {Node | null} */
  let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const blockTags = new Set([
    "P",
    "LI",
    "BLOCKQUOTE",
    "PRE",
    "ARTICLE",
    "SECTION",
    "TD",
    "TH",
    "FIGCAPTION",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "DIV",
  ]);

  while (current && current !== document.body) {
    if (
      current instanceof HTMLElement &&
      blockTags.has(current.tagName) &&
      (current.innerText || "").trim().length > 0
    ) {
      // Prefer tighter containers over giant layout divs.
      if (current.tagName === "DIV") {
        const len = (current.innerText || "").length;
        if (len > MAX_CONTEXT * 2) {
          current = current.parentElement;
          continue;
        }
      }
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * @param {string} text
 * @param {string} needle
 * @param {number} radius
 */
function sliceAroundMatch(text, needle, radius) {
  const idx = text.indexOf(needle.slice(0, Math.min(needle.length, 80)));
  if (idx < 0) {
    return truncate(text, radius * 2);
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  let slice = text.slice(start, end);
  if (start > 0) slice = "…" + slice;
  if (end < text.length) slice = slice + "…";
  return slice;
}

/** @param {string} s */
function normalizeWhitespace(s) {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} s
 * @param {number} max
 */
function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
