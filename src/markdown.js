/**
 * Markdown to HTML, for assignment handouts.
 *
 * An assignment page names a `.md` file, `handout.js` fetches it, and this
 * module turns it into markup. Writing a problem statement is then writing
 * prose rather than nesting `<ol>` and `<li>` by hand.
 *
 * Nothing here touches the DOM or the network: a string goes in and a string
 * comes out, which is what lets `node --test` cover the whole parser.
 *
 * ## Escaping
 *
 * Every run of text passes through `escape_html` before any inline rule sees
 * it, so the inline patterns match against text where `<` is already `&lt;`.
 * A handout containing `<script>` renders as visible characters. The public
 * entry point then scans its own output and asserts that every tag it emitted
 * is one of `TAGS_ALLOWED`, which is the proof that nothing in the source
 * became markup.
 *
 * ## The supported subset
 *
 * ATX headings (`#` through `######`), paragraphs, ordered and unordered
 * lists (nested by indentation), fenced code blocks, blockquotes, horizontal
 * rules, pipe tables with an alignment row, `code`, `**bold**`, `*italic*`,
 * `[links](url)`, `![images](src)`, and hard line breaks.
 *
 * Deliberately absent, because a handout does not need them and each one
 * costs a class of surprises: reference links (`[x][1]`), setext headings
 * (underlined with `===`), indented code blocks (four spaces means list
 * nesting here, nothing else), autolinks (`<https://x>`), HTML blocks, and
 * lazy paragraph continuation inside a list item. Unknown syntax is never an
 * error; markdown has none. It renders as the literal text it is.
 */

import { assert, assert_string } from "./assert.js";
import {
  MARKDOWN_BYTES_MAX,
  MARKDOWN_CODE_SPAN_COUNT_MAX,
  MARKDOWN_INFO_CHARS_MAX,
  MARKDOWN_LINE_COUNT_MAX,
  MARKDOWN_LIST_DEPTH_MAX,
  MARKDOWN_TABLE_COLUMN_COUNT_MAX,
  MARKDOWN_TAG_COUNT_MAX,
} from "./constants.js";
import { escape_html } from "./html.js";

/**
 * Every tag this module is allowed to emit. The postcondition in
 * `render_markdown` checks the finished string against this set, so a bug in
 * any rule below announces itself rather than shipping an unexpected tag to
 * the page.
 */
const TAGS_ALLOWED = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "pre", "code",
  "blockquote", "hr", "a", "img", "strong", "em", "br", "table", "thead",
  "tbody", "tr", "th", "td",
]);

/** Schemes a link or image may carry. Anything else renders as plain text. */
const SCHEMES_ALLOWED = new Set(["http:", "https:", "mailto:"]);

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

const CODE_SPAN_RE = /`([^`\n]+)`/g;
const IMAGE_RE = /!\[([^\]\n]*)\]\(([^)\s]*)\)/g;
const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]*)\)/g;
const BOLD_STAR_RE = /\*\*((?:[^*\n]|\*(?!\*))+)\*\*/g;
const BOLD_UNDERSCORE_RE = /__((?:[^_\n]|_(?!_))+)__/g;
const ITALIC_STAR_RE = /\*([^*\n]+)\*/g;
/** Underscores only outside a word, so `snake_case_name` stays intact. */
const ITALIC_UNDERSCORE_RE = /(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g;
/** Two trailing spaces or a trailing backslash, the two hard-break spellings. */
const HARD_BREAK_RE = /(?: {2,}|\\)\n/g;

/**
 * A code span lifted out of a text run parks as `<0>`, `<1>`, and so on.
 * Escaped text carries no angle bracket at all, which `render_inline` asserts
 * on entry, so a handout cannot forge one of these; and no rule below emits a
 * tag whose name is a number, so the finished markup cannot collide with the
 * pattern either.
 */
const SENTINEL_RE = /<(\d+)>/g;

/** The same pattern without `g`, so `.test` carries no `lastIndex` between calls. */
const SENTINEL_PRESENT_RE = /<\d+>/;

/**
 * Code spans come out before the other inline rules, so that `**` written
 * inside backticks stays literal rather than turning bold.
 */
function extract_code_spans(text, spans) {
  assert(typeof text === "string", "extract_code_spans: text must be a string");
  assert(Array.isArray(spans), "extract_code_spans: spans must be an array");
  return text.replace(CODE_SPAN_RE, (_match, code) => {
    spans.push(code);
    assert(
      spans.length <= MARKDOWN_CODE_SPAN_COUNT_MAX,
      `markdown: more than ${MARKDOWN_CODE_SPAN_COUNT_MAX} code spans in one run`,
    );
    return `<${spans.length - 1}>`;
  });
}

function restore_code_spans(text, spans) {
  assert(typeof text === "string", "restore_code_spans: text must be a string");
  assert(Array.isArray(spans), "restore_code_spans: spans must be an array");
  const restored = text.replace(SENTINEL_RE, (_match, digits) => {
    const index = Number(digits);
    assert(index < spans.length, `restore_code_spans: no code span ${index}`);
    return `<code>${spans[index]}</code>`;
  });
  assert(
    !SENTINEL_PRESENT_RE.test(restored),
    "restore_code_spans: every sentinel must be replaced",
  );
  return restored;
}

/**
 * A relative path, a fragment, or one of `SCHEMES_ALLOWED`. Everything else,
 * `javascript:` and `data:` above all, fails here, and the link renders as the
 * literal text the author typed.
 */
export function is_url_allowed(url) {
  assert(typeof url === "string", "is_url_allowed: url must be a string");
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  const scheme = SCHEME_RE.exec(trimmed);
  if (scheme === null) return true;
  return SCHEMES_ALLOWED.has(scheme[0].toLowerCase());
}

/**
 * Inline rules, applied to already-escaped text. Order carries meaning: code
 * spans first so their contents are inert, images before links because an
 * image's `![` contains a link's `[`, and bold before italic because `**`
 * starts with a `*`.
 */
function render_inline(escaped) {
  assert(typeof escaped === "string", "render_inline: text must be a string");
  assert(!/[<>]/.test(escaped), "render_inline: text must already be escaped");
  const spans = [];
  let text = extract_code_spans(escaped, spans);
  text = text.replace(HARD_BREAK_RE, "<br />\n");
  text = text.replace(IMAGE_RE, (match, alt, src) => (
    is_url_allowed(src) ? `<img src="${src}" alt="${alt}" />` : match
  ));
  text = text.replace(LINK_RE, (match, label, href) => (
    is_url_allowed(href) ? `<a href="${href}">${label}</a>` : match
  ));
  text = text.replace(BOLD_STAR_RE, "<strong>$1</strong>");
  text = text.replace(BOLD_UNDERSCORE_RE, "<strong>$1</strong>");
  text = text.replace(ITALIC_STAR_RE, "<em>$1</em>");
  text = text.replace(ITALIC_UNDERSCORE_RE, "$1<em>$2</em>");
  return restore_code_spans(text, spans);
}

/** The single place raw source becomes inline markup: escape, then format. */
function inline(raw) {
  assert(typeof raw === "string", "inline: raw must be a string");
  return render_inline(escape_html(raw));
}

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/;
const QUOTE_RE = /^ {0,3}>[ ]?(.*)$/;
const BULLET_RE = /^( *)([-*+])([ \t]+)(.*)$/;
const ORDERED_RE = /^( *)(\d{1,9})[.)]([ \t]+)(.*)$/;
const TABLE_DELIM_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const INFO_RE = /^[a-z0-9_+-]+$/i;
const TAG_NAME_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)/g;

/**
 * A leading tab becomes four spaces, because indentation is what nests a list
 * and a tab that counts as one column nests nothing the author can see. Tabs
 * further along the line are content and stay: an assignment whose expected
 * output is tab-separated has to be able to show those tabs in a fence.
 */
function normalize_lines(source) {
  assert(typeof source === "string", "normalize_lines: source must be a string");
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length)));
  assert(
    lines.length <= MARKDOWN_LINE_COUNT_MAX,
    `markdown exceeds ${MARKDOWN_LINE_COUNT_MAX} lines: ${lines.length}`,
  );
  return lines;
}

function leading_spaces(line) {
  assert(typeof line === "string", "leading_spaces: line must be a string");
  const match = /^ */.exec(line);
  return match[0].length;
}

/**
 * A list item's shape: where it starts, whether it is numbered, and how wide
 * its marker is. The width is what a continuation line is dedented by, so a
 * sub-item indented under `1. ` lines up at column zero when it recurses.
 */
function match_item(line) {
  assert(typeof line === "string", "match_item: line must be a string");
  const bullet = BULLET_RE.exec(line);
  if (bullet !== null) {
    return {
      indent: bullet[1].length,
      ordered: false,
      marker_width: bullet[1].length + 1 + bullet[3].length,
      content: bullet[4],
    };
  }
  const ordered = ORDERED_RE.exec(line);
  if (ordered === null) return null;
  return {
    indent: ordered[1].length,
    ordered: true,
    marker_width: ordered[1].length + ordered[2].length + 1 + ordered[3].length,
    content: ordered[4],
  };
}

function render_fence(lines, index, fence, out) {
  const marker = fence[1];
  const info = assert_string(fence[2], "markdown: fence info", MARKDOWN_INFO_CHARS_MAX);
  const body = [];
  let scan = index + 1;
  while (scan < lines.length) {
    const closing = FENCE_RE.exec(lines[scan]);
    const closes = closing !== null
      && closing[1][0] === marker[0]
      && closing[1].length >= marker.length;
    scan += 1;
    if (closes) break;
    body.push(lines[scan - 1]);
  }
  assert(scan > index, "render_fence: the opening fence is always consumed");
  // `io` is the class the hand-written handouts already used for terminal
  // transcripts, so a fence lands on the styling that is already in a1.css.
  const classes = INFO_RE.test(info) ? `io lang-${info.toLowerCase()}` : "io";
  out.push(`<pre class="${classes}">${escape_html(body.join("\n"))}</pre>`);
  return scan;
}

function render_blockquote(lines, index, depth, out) {
  const inner = [];
  let scan = index;
  while (scan < lines.length) {
    const quoted = QUOTE_RE.exec(lines[scan]);
    if (quoted === null) break;
    inner.push(quoted[1]);
    scan += 1;
  }
  assert(inner.length > 0, "render_blockquote: the first line must be quoted");
  out.push(`<blockquote>\n${render_blocks(inner, depth + 1)}\n</blockquote>`);
  return scan;
}

function split_row(line) {
  assert(typeof line === "string", "split_row: line must be a string");
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  const cells = text.split("|").map((cell) => cell.trim());
  assert(
    cells.length <= MARKDOWN_TABLE_COLUMN_COUNT_MAX,
    `markdown: a table row exceeds ${MARKDOWN_TABLE_COLUMN_COUNT_MAX} columns`,
  );
  return cells;
}

/** `:---` is left, `---:` right, `:---:` centre, and a bare `---` sets none. */
function align_attribute(cell) {
  assert(typeof cell === "string", "align_attribute: cell must be a string");
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return ' class="align-center"';
  if (right) return ' class="align-right"';
  if (left) return ' class="align-left"';
  return "";
}

/**
 * The delimiter row is what separates a table from a paragraph that happens
 * to contain a pipe, and its column count must match the header's.
 */
function table_starts_at(lines, index) {
  if (index + 1 >= lines.length) return false;
  if (!lines[index].includes("|")) return false;
  if (!TABLE_DELIM_RE.test(lines[index + 1])) return false;
  return split_row(lines[index]).length === split_row(lines[index + 1]).length;
}

function render_table(lines, index, out) {
  const headers = split_row(lines[index]);
  const aligns = split_row(lines[index + 1]).map(align_attribute);
  const rows = [];
  let scan = index + 2;
  while (scan < lines.length && lines[scan].trim() !== "" && lines[scan].includes("|")) {
    rows.push(split_row(lines[scan]));
    scan += 1;
  }
  const head = headers
    .map((cell, column) => `<th${aligns[column]}>${inline(cell)}</th>`)
    .join("");
  const body = rows.map((row) => {
    const cells = row.map(
      (cell, column) => `<td${aligns[column] ?? ""}>${inline(cell)}</td>`,
    );
    return `<tr>${cells.join("")}</tr>`;
  });
  const tbody = body.length > 0 ? `<tbody>\n${body.join("\n")}\n</tbody>` : "<tbody></tbody>";
  out.push(`<table>\n<thead><tr>${head}</tr></thead>\n${tbody}\n</table>`);
  return scan;
}

/**
 * Where the list that opens at `start` ends: a blank line or a line indented
 * past the marker keeps it going, a same-kind item at the same indent starts
 * the next entry, and anything else closes it.
 */
function list_run_end(lines, start, first) {
  let scan = start + 1;
  while (scan < lines.length) {
    const line = lines[scan];
    if (line.trim() === "") { scan += 1; continue; }
    if (leading_spaces(line) > first.indent) { scan += 1; continue; }
    const item = match_item(line);
    if (item !== null && item.ordered === first.ordered) { scan += 1; continue; }
    break;
  }
  assert(scan > start, "list_run_end: a run holds at least its opening line");
  return scan;
}

function dedent(line, width) {
  assert(Number.isInteger(width) && width >= 0, "dedent: width must be a non-negative integer");
  return line.slice(Math.min(width, leading_spaces(line)));
}

function split_items(run, first) {
  const items = [];
  let current = null;
  let width = first.marker_width;
  for (let index = 0; index < run.length; index++) {
    const line = run[index];
    const item = match_item(line);
    if (item !== null && item.indent <= first.indent) {
      width = item.marker_width;
      current = [item.content];
      items.push(current);
      continue;
    }
    assert(current !== null, "split_items: a run must open with a list item");
    current.push(dedent(line, width));
  }
  assert(items.length > 0, "split_items: a run must hold at least one item");
  return items;
}

/**
 * A one-line entry stays tight (`<li>text</li>`); anything longer recurses,
 * which is what lets an entry carry a paragraph, a fence, or a nested list.
 */
function render_item(body, depth) {
  const filled = body.filter((line) => line.trim() !== "");
  if (filled.length === 1 && match_item(filled[0]) === null) {
    return inline(filled[0].trim());
  }
  return `\n${render_blocks(body, depth + 1)}\n`;
}

function render_list(lines, index, depth, out) {
  const first = match_item(lines[index]);
  assert(first !== null, "render_list: the first line must be a list item");
  const end = list_run_end(lines, index, first);
  const items = split_items(lines.slice(index, end), first);
  const tag = first.ordered ? "ol" : "ul";
  const entries = items.map((body) => `<li>${render_item(body, depth)}</li>`);
  out.push(`<${tag}>\n${entries.join("\n")}\n</${tag}>`);
  return end;
}

/** Runs until a blank line or the opener of any other block. */
function render_paragraph(lines, index, out) {
  const body = [];
  let scan = index;
  while (scan < lines.length) {
    const line = lines[scan];
    if (line.trim() === "") break;
    if (scan > index && starts_block(lines, scan)) break;
    // Only the left side is trimmed: two trailing spaces are a hard break, and
    // trimming both ends would eat the marker before the inline pass sees it.
    body.push(line.trimStart());
    scan += 1;
  }
  assert(body.length > 0, "render_paragraph: a paragraph holds at least one line");
  out.push(`<p>${inline(body.join("\n").trimEnd())}</p>`);
  return scan;
}

function starts_block(lines, index) {
  const line = lines[index];
  return HEADING_RE.test(line)
    || HR_RE.test(line)
    || FENCE_RE.test(line)
    || QUOTE_RE.test(line)
    || match_item(line) !== null
    || table_starts_at(lines, index);
}

/**
 * One block, dispatched on the line's opener. Order matters twice: a fence
 * wins over everything so its contents stay literal, and `---` is a rule
 * before it is a bullet.
 */
function render_block_at(lines, index, depth, out) {
  const line = lines[index];
  if (line.trim() === "") return index + 1;

  const fence = FENCE_RE.exec(line);
  if (fence !== null) return render_fence(lines, index, fence, out);

  const heading = HEADING_RE.exec(line);
  if (heading !== null) {
    const level = heading[1].length;
    out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    return index + 1;
  }

  if (HR_RE.test(line)) {
    out.push("<hr />");
    return index + 1;
  }
  if (QUOTE_RE.test(line)) return render_blockquote(lines, index, depth, out);
  if (table_starts_at(lines, index)) return render_table(lines, index, out);
  if (match_item(line) !== null) return render_list(lines, index, depth, out);
  return render_paragraph(lines, index, out);
}

/**
 * Every handler returns the index it stopped at, and the loop asserts that
 * the index moved. That invariant is what keeps the scan finite: a handler
 * that returned without consuming a line would hang the tab, so it fails here
 * instead.
 */
function render_blocks(lines, depth) {
  assert(Array.isArray(lines), "render_blocks: lines must be an array");
  assert(
    Number.isInteger(depth) && depth >= 0,
    "render_blocks: depth must be a non-negative integer",
  );
  assert(
    depth <= MARKDOWN_LIST_DEPTH_MAX,
    `markdown nests deeper than ${MARKDOWN_LIST_DEPTH_MAX} levels`,
  );
  assert(
    lines.length <= MARKDOWN_LINE_COUNT_MAX,
    `markdown block exceeds ${MARKDOWN_LINE_COUNT_MAX} lines: ${lines.length}`,
  );
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const before = index;
    index = render_block_at(lines, index, depth, out);
    assert(index > before, "render_blocks: every block must consume at least one line");
  }
  return out.join("\n");
}

/**
 * The postcondition that makes the escaping claim checkable: every tag in the
 * finished string was emitted by a rule above, so a tag outside the allowlist
 * means either a bug here or source text that escaped escaping.
 */
function assert_tags_allowed(html) {
  assert(typeof html === "string", "assert_tags_allowed: html must be a string");
  TAG_NAME_RE.lastIndex = 0;
  const tags = html.match(TAG_NAME_RE) ?? [];
  assert(
    tags.length <= MARKDOWN_TAG_COUNT_MAX,
    `markdown emitted more than ${MARKDOWN_TAG_COUNT_MAX} tags: ${tags.length}`,
  );
  for (let index = 0; index < tags.length; index++) {
    const name = tags[index].replace(/^<\/?/, "").toLowerCase();
    assert(TAGS_ALLOWED.has(name), `render_markdown: "${name}" is not an allowed tag`);
  }
}

/** Markdown in, HTML out. The only entry point a caller needs. */
export function render_markdown(text) {
  const source = assert_string(text, "markdown", MARKDOWN_BYTES_MAX);
  const html = render_blocks(normalize_lines(source), 0);
  assert_tags_allowed(html);
  return html;
}
