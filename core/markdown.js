/**
 * Lightweight Markdown → safe HTML for popover + page chat.
 * Subset tuned for model answers (no HTML passthrough).
 *
 * No imports — also loadable as a content-script global.
 */

/**
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} href
 * @returns {string | null}
 */
function safeHttpUrl(href) {
  const h = String(href || "").trim();
  if (!/^https?:\/\//i.test(h)) return null;
  // Block javascript: etc. after decode tricks
  try {
    const u = new URL(h);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Inline markdown on already-escaped text (except we re-insert anchors).
 * Input must be HTML-escaped plain text (no tags).
 * @param {string} escaped
 * @returns {string}
 */
export function formatInlineMarkdown(escaped) {
  let s = escaped;

  // Images ![alt](url) — render as linked alt text (no remote img loads)
  s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, alt, url) => {
    const safe = safeHttpUrl(url);
    if (!safe) return escapeHtml(alt || url);
    const label = alt || safe;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Markdown links [text](url) — allow one level of nested () in the URL
  s = s.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, (_, label, url) => {
    const safe = safeHttpUrl(String(url || "").trim());
    if (!safe) return label;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Autolink bare URLs (avoid matching inside href="...")
  s = s.replace(/(^|[\s(>])(https?:\/\/[^\s<]+)/g, (full, pre, url) => {
    const trimmed = url.replace(/[),.;:!?]+$/, "");
    const trail = url.slice(trimmed.length);
    const safe = safeHttpUrl(trimmed);
    if (!safe) return full;
    return `${pre}<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
      trimmed
    )}</a>${trail}`;
  });

  // Bold **text** or __text__
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic *text* or _text_ (avoid matching mid-word underscores heavily)
  s = s.replace(/(^|[\s(>])\*(?!\s)(.+?)(?<!\s)\*([\s).,!?:;]|$)/g, "$1<em>$2</em>$3");
  s = s.replace(/(^|[\s(>])_(?!\s)(.+?)(?<!\s)_([\s).,!?:;]|$)/g, "$1<em>$2</em>$3");

  // Inline code `code`
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Strikethrough ~~text~~
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");

  return s;
}

/**
 * GFM table separator row: | --- | :---: | ---: |
 * Requires pipes / ≥2 columns so bare `---` still counts as an hr.
 * @param {string} line
 */
export function isMarkdownTableSeparator(line) {
  const s = String(line || "").trim();
  if (!s.includes("-") || !s.includes("|")) return false;
  // Must look like cells of only dashes/colons/spaces/pipes
  if (!/^[\s|:-]+$/.test(s)) return false;
  const cells = splitMarkdownTableRow(s);
  if (cells.length < 2) return false;
  return cells.every((c) => {
    const t = c.replace(/\s/g, "");
    return t === "" || /^:?-{1,}:?$/.test(t);
  });
}

/**
 * @param {string} line
 * @returns {string[]}
 */
export function splitMarkdownTableRow(line) {
  let s = String(line || "").trim();
  if (!s) return [];
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/**
 * @param {string} line
 */
function isMarkdownTableRowLine(line) {
  const s = String(line || "").trim();
  if (!s.includes("|")) return false;
  if (isMarkdownTableSeparator(s)) return false;
  // Avoid treating pure emphasis lines as tables
  return splitMarkdownTableRow(s).length >= 2;
}

/**
 * @param {string[]} header
 * @param {string[][]} rows
 * @returns {string}
 */
function renderMarkdownTable(header, rows) {
  const th = header
    .map((c) => `<th>${formatInlineMarkdown(escapeHtml(c))}</th>`)
    .join("");
  const body = rows
    .map((row) => {
      // Pad / trim to header length for stable columns
      const cells = header.map((_, i) => row[i] ?? "");
      return `<tr>${cells
        .map((c) => `<td>${formatInlineMarkdown(escapeHtml(c))}</td>`)
        .join("")}</tr>`;
    })
    .join("");
  return `<div class="wdimtm-table-wrap"><table class="wdimtm-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/**
 * Convert Markdown to HTML. Always escapes raw HTML from the model.
 * @param {string} text
 * @returns {string}
 */
export function formatMarkdown(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return "";

  /** @type {string[]} */
  const codeBlocks = [];
  // Extract fenced code blocks first (```lang?\n...\n```)
  let src = raw.replace(/```([a-zA-Z0-9_+-]*)[ \t]*\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = codeBlocks.length;
    const body = escapeHtml(code.replace(/\n$/, ""));
    const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
    codeBlocks.push(
      `<pre class="wdimtm-pre"${langAttr}><code class="wdimtm-code-block">${body}</code></pre>`
    );
    return `\n\n%%WDIMTM_CODE_${i}%%\n\n`;
  });

  // Also support indented-style single-line fence leftovers: ```code```
  src = src.replace(/```([^\n`]+)```/g, (_, code) => {
    const i = codeBlocks.length;
    codeBlocks.push(
      `<pre class="wdimtm-pre"><code class="wdimtm-code-block">${escapeHtml(code)}</code></pre>`
    );
    return `\n\n%%WDIMTM_CODE_${i}%%\n\n`;
  });

  const lines = src.split("\n");
  /** @type {string[]} */
  const out = [];
  /** @type {"ul" | "ol" | null} */
  let listType = null;
  /** @type {string[]} */
  let listItems = [];
  /** @type {string[]} */
  let para = [];
  let inBlockquote = false;
  /** @type {string[]} */
  let quoteLines = [];

  const flushList = () => {
    if (!listType || !listItems.length) {
      listType = null;
      listItems = [];
      return;
    }
    const tag = listType;
    out.push(`<${tag}>${listItems.join("")}</${tag}>`);
    listType = null;
    listItems = [];
  };

  const flushPara = () => {
    if (!para.length) return;
    const body = formatInlineMarkdown(escapeHtml(para.join("\n"))).replace(/\n/g, "<br>");
    out.push(`<p>${body}</p>`);
    para = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) {
      inBlockquote = false;
      return;
    }
    const inner = formatInlineMarkdown(escapeHtml(quoteLines.join("\n"))).replace(/\n/g, "<br>");
    out.push(`<blockquote class="wdimtm-quote">${inner}</blockquote>`);
    quoteLines = [];
    inBlockquote = false;
  };

  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const codeMatch = line.match(/^%%WDIMTM_CODE_(\d+)%%$/);
    if (codeMatch) {
      flushAll();
      out.push(codeBlocks[Number(codeMatch[1])] || "");
      continue;
    }

    // GFM table: header + separator + body rows
    if (
      isMarkdownTableRowLine(line) &&
      i + 1 < lines.length &&
      isMarkdownTableSeparator(lines[i + 1])
    ) {
      flushAll();
      const header = splitMarkdownTableRow(line);
      i += 2; // skip separator
      /** @type {string[][]} */
      const rows = [];
      while (i < lines.length && isMarkdownTableRowLine(lines[i])) {
        rows.push(splitMarkdownTableRow(lines[i]));
        i += 1;
      }
      i -= 1; // outer for-loop will advance
      out.push(renderMarkdownTable(header, rows));
      continue;
    }

    // Horizontal rule (not a table separator)
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) && !isMarkdownTableSeparator(line)) {
      flushAll();
      out.push('<hr class="wdimtm-hr" />');
      continue;
    }

    // Headings
    const h = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (h) {
      flushAll();
      const level = h[1].length;
      out.push(`<h${level} class="wdimtm-h">${formatInlineMarkdown(escapeHtml(h[2]))}</h${level}>`);
      continue;
    }

    // Blockquote
    const q = line.match(/^\s{0,3}>\s?(.*)$/);
    if (q) {
      flushPara();
      flushList();
      inBlockquote = true;
      quoteLines.push(q[1]);
      continue;
    }
    if (inBlockquote) {
      flushQuote();
    }

    // Unordered list
    const ul = line.match(/^\s{0,3}[-*+]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(`<li>${formatInlineMarkdown(escapeHtml(ul[1]))}</li>`);
      continue;
    }

    // Ordered list
    const ol = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
    if (ol) {
      flushPara();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(`<li>${formatInlineMarkdown(escapeHtml(ol[1]))}</li>`);
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      flushAll();
      continue;
    }

    // Continuation of paragraph
    if (listType) flushList();
    para.push(line);
  }

  flushAll();

  // Restore any leftover placeholders (shouldn't happen)
  let html = out.join("");
  html = html.replace(/%%WDIMTM_CODE_(\d+)%%/g, (_, i) => codeBlocks[Number(i)] || "");

  return html || `<p>${formatInlineMarkdown(escapeHtml(raw))}</p>`;
}
