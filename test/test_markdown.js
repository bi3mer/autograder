/**
 * The markdown parser, which is what turns a handout into the prose a student
 * reads. Two things matter enough to test hard: that the block grammar
 * produces the markup the stylesheet expects, and that nothing an author
 * writes can escape escaping.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../src/assert.js";
import {
  MARKDOWN_BYTES_MAX,
  MARKDOWN_LINE_COUNT_MAX,
  MARKDOWN_LIST_DEPTH_MAX,
  MARKDOWN_TABLE_COLUMN_COUNT_MAX,
} from "../src/constants.js";
import { is_url_allowed, render_markdown } from "../src/markdown.js";

test("headings render at their hash depth", () => {
  assert.equal(render_markdown("# One"), "<h1>One</h1>");
  assert.equal(render_markdown("### Three"), "<h3>Three</h3>");
  assert.equal(render_markdown("###### Six"), "<h6>Six</h6>");
});

test("seven hashes is a paragraph, since there is no h7", () => {
  assert.equal(render_markdown("####### Seven"), "<p>####### Seven</p>");
});

test("a heading's closing hashes are decoration, not content", () => {
  assert.equal(render_markdown("## Output ##"), "<h2>Output</h2>");
});

test("a hash with no space is a paragraph, so #1 stays a number", () => {
  assert.equal(render_markdown("#1 on the list"), "<p>#1 on the list</p>");
});

test("consecutive lines are one paragraph; a blank line starts another", () => {
  assert.equal(render_markdown("one\ntwo"), "<p>one\ntwo</p>");
  assert.equal(render_markdown("one\n\ntwo"), "<p>one</p>\n<p>two</p>");
});

test("a heading interrupts a paragraph without a blank line", () => {
  assert.equal(render_markdown("text\n## Next"), "<p>text</p>\n<h2>Next</h2>");
});

test("empty and blank-only sources render nothing", () => {
  assert.equal(render_markdown(""), "");
  assert.equal(render_markdown("\n\n\n"), "");
  assert.equal(render_markdown("   \n  "), "");
});

test("unordered lists accept all three bullet characters", () => {
  for (const bullet of ["-", "*", "+"]) {
    assert.equal(render_markdown(`${bullet} one`), "<ul>\n<li>one</li>\n</ul>");
  }
});

test("ordered lists accept both the dot and the paren", () => {
  assert.equal(render_markdown("1. one"), "<ol>\n<li>one</li>\n</ol>");
  assert.equal(render_markdown("1) one"), "<ol>\n<li>one</li>\n</ol>");
});

test("a one-line entry stays tight, with no paragraph inside the item", () => {
  assert.equal(
    render_markdown("- one\n- two"),
    "<ul>\n<li>one</li>\n<li>two</li>\n</ul>",
  );
});

test("switching bullet to number ends one list and opens the next", () => {
  const html = render_markdown("- one\n1. two");
  assert.match(html, /<ul>[\s\S]*<\/ul>\n<ol>[\s\S]*<\/ol>/);
});

test("an indented bullet nests inside the entry above it", () => {
  const html = render_markdown("1. outer\n   - inner\n2. after");
  assert.match(html, /<ol>[\s\S]*<li>\n<p>outer<\/p>\n<ul>\n<li>inner<\/li>\n<\/ul>\n<\/li>/);
  assert.match(html, /<li>after<\/li>/);
});

test("nesting past the depth cap fails rather than recursing on", () => {
  const shallow = Array.from({ length: MARKDOWN_LIST_DEPTH_MAX - 1 })
    .map((_unused, level) => `${"  ".repeat(level)}- level ${level}`).join("\n");
  assert.doesNotThrow(() => render_markdown(shallow));
  const deep = Array.from({ length: MARKDOWN_LIST_DEPTH_MAX + 3 })
    .map((_unused, level) => `${"  ".repeat(level)}- level ${level}`).join("\n");
  assert.throws(() => render_markdown(deep), /nests deeper than/);
});

test("a fence becomes a pre carrying the class the stylesheet already has", () => {
  assert.equal(
    render_markdown("```\nPre-tax cost= 30.0\n```"),
    '<pre class="io">Pre-tax cost= 30.0</pre>',
  );
});

test("a fence's info string becomes a language class", () => {
  assert.equal(
    render_markdown("```python\nprint(1)\n```"),
    '<pre class="io lang-python">print(1)</pre>',
  );
});

test("a fence runs to the end of the file when its closer is missing", () => {
  assert.equal(render_markdown("```\nbody"), '<pre class="io">body</pre>');
});

test("markdown inside a fence stays literal", () => {
  assert.equal(
    render_markdown("```\n# not a heading **not bold**\n```"),
    '<pre class="io"># not a heading **not bold**</pre>',
  );
});

test("tildes fence too, and do not close a backtick fence", () => {
  assert.equal(render_markdown("~~~\nbody\n~~~"), '<pre class="io">body</pre>');
  assert.equal(render_markdown("```\n~~~\n```"), '<pre class="io">~~~</pre>');
});

test("three or more dashes, stars, or underscores are a rule", () => {
  for (const source of ["---", "***", "___", "- - -", "-----"]) {
    assert.equal(render_markdown(source), "<hr />", source);
  }
});

test("a rule wins over a bullet, so --- never opens a list", () => {
  assert.equal(render_markdown("---"), "<hr />");
});

test("blockquotes nest their content through the block scanner", () => {
  assert.equal(
    render_markdown("> Round with round(value, 2)."),
    "<blockquote>\n<p>Round with round(value, 2).</p>\n</blockquote>",
  );
  assert.match(render_markdown("> - one\n> - two"), /<blockquote>\n<ul>/);
});

test("a table needs a delimiter row, so a lone pipe stays a paragraph", () => {
  assert.equal(render_markdown("a | b\nc | d"), "<p>a | b\nc | d</p>");
});

test("a pipe table renders a head and a body", () => {
  const html = render_markdown("| A | B |\n| --- | --- |\n| 1 | 2 |");
  assert.match(html, /<thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody>\n<tr><td>1<\/td><td>2<\/td><\/tr>\n<\/tbody>/);
});

test("the delimiter row's colons set each column's alignment", () => {
  const html = render_markdown("| L | C | R |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |");
  assert.match(html, /<th class="align-left">L<\/th>/);
  assert.match(html, /<th class="align-center">C<\/th>/);
  assert.match(html, /<th class="align-right">R<\/th>/);
  assert.match(html, /<td class="align-right">3<\/td>/);
});

test("a header-only table renders an empty body rather than a ragged one", () => {
  assert.match(render_markdown("| A |\n| --- |"), /<tbody><\/tbody>/);
});

test("a table wider than the column cap fails at the boundary", () => {
  const wide = `|${"x|".repeat(MARKDOWN_TABLE_COLUMN_COUNT_MAX + 2)}`;
  assert.throws(() => render_markdown(`${wide}\n${wide.replace(/x/g, "-")}`), /columns/);
});

test("inline code, bold, and italic each wrap their span", () => {
  assert.equal(render_markdown("`x`"), "<p><code>x</code></p>");
  assert.equal(render_markdown("**x**"), "<p><strong>x</strong></p>");
  assert.equal(render_markdown("__x__"), "<p><strong>x</strong></p>");
  assert.equal(render_markdown("*x*"), "<p><em>x</em></p>");
});

test("italics nest inside bold rather than tearing it apart", () => {
  assert.equal(
    render_markdown("**bold with *inner* text**"),
    "<p><strong>bold with <em>inner</em> text</strong></p>",
  );
});

test("an underscore inside a word leaves snake_case alone", () => {
  assert.equal(render_markdown("snake_case_name"), "<p>snake_case_name</p>");
  assert.equal(render_markdown("_real_"), "<p><em>real</em></p>");
});

test("asterisks inside a code span stay literal", () => {
  assert.equal(
    render_markdown("`a ** b` and **real**"),
    "<p><code>a ** b</code> and <strong>real</strong></p>",
  );
});

test("an unpaired backtick is text, not the start of a span", () => {
  assert.equal(render_markdown("a ` b"), "<p>a ` b</p>");
});

test("both hard-break spellings emit a br", () => {
  assert.equal(render_markdown("one  \ntwo"), "<p>one<br />\ntwo</p>");
  assert.equal(render_markdown("one\\\ntwo"), "<p>one<br />\ntwo</p>");
});

test("links and images render with their target", () => {
  assert.equal(
    render_markdown("[docs](https://example.com)"),
    '<p><a href="https://example.com">docs</a></p>',
  );
  assert.equal(
    render_markdown("![alt](diagram.png)"),
    '<p><img src="diagram.png" alt="alt" /></p>',
  );
});

test("relative paths, fragments, and mailto are all reachable targets", () => {
  for (const url of ["../css/a1.css", "#output", "w1p2.html", "mailto:a@b.com"]) {
    assert.ok(is_url_allowed(url), url);
  }
});

test("a javascript: or data: target renders as text and emits no anchor", () => {
  for (const url of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x"]) {
    assert.equal(is_url_allowed(url), false, url);
    const html = render_markdown(`[click](${url})`);
    assert.ok(!html.includes("<a "), html);
    assert.ok(!html.includes("<img"), html);
  }
});

test("an empty target is not a link", () => {
  assert.equal(is_url_allowed(""), false);
  assert.equal(is_url_allowed("   "), false);
});

test("a script tag in the source renders as visible text", () => {
  assert.equal(
    render_markdown("<script>alert(1)</script>"),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
  );
});

test("an attribute break-out attempt inside a link target is escaped", () => {
  const html = render_markdown('![x](y.png" onerror="alert(1))');
  assert.ok(!html.includes("onerror=\""), html);
});

test("angle brackets inside a fence are escaped like everything else", () => {
  assert.equal(
    render_markdown("```\n<b>x</b>\n```"),
    '<pre class="io">&lt;b&gt;x&lt;/b&gt;</pre>',
  );
});

test("text shaped like a code-span sentinel cannot forge one", () => {
  assert.equal(render_markdown("Text <0> and <1>"), "<p>Text &lt;0&gt; and &lt;1&gt;</p>");
});

test("every tag in a rendered handout is one the allowlist names", () => {
  const source = [
    "# H", "", "para with `code` and **bold**", "", "- a", "- b", "", "1. x", "",
    "> quote", "", "```py", "code", "```", "", "| A |", "| --- |", "| 1 |", "",
    "[l](x.html) ![i](y.png)", "", "---",
  ].join("\n");
  const allowed = new Set([
    "h1", "p", "code", "strong", "ul", "li", "ol", "blockquote", "pre", "table",
    "thead", "tbody", "tr", "th", "td", "a", "img", "hr",
  ]);
  const tags = render_markdown(source).match(/<\/?([a-z0-9]+)/g) ?? [];
  assert.ok(tags.length > 0);
  for (const tag of tags) {
    assert.ok(allowed.has(tag.replace(/^<\/?/, "")), tag);
  }
});

test("carriage returns and leading tabs normalise before anything parses", () => {
  assert.equal(render_markdown("one\r\ntwo"), "<p>one\ntwo</p>");
  assert.equal(render_markdown("-\tone"), "<ul>\n<li>one</li>\n</ul>");
  assert.match(render_markdown("- outer\n\t- inner"), /<ul>\n<li>inner<\/li>\n<\/ul>/);
});

test("a tab inside a fence survives, since it is output rather than indent", () => {
  assert.equal(
    render_markdown("```\n    Pre tax\t$3.95\n```"),
    '<pre class="io">    Pre tax\t$3.95</pre>',
  );
});

test("a source past the byte ceiling fails at the boundary", () => {
  assert.throws(
    () => render_markdown("x".repeat(MARKDOWN_BYTES_MAX + 1)),
    (error) => error instanceof AssertionError && /exceeds/.test(error.message),
  );
});

test("a source past the line ceiling fails at the boundary", () => {
  assert.throws(
    () => render_markdown("\n".repeat(MARKDOWN_LINE_COUNT_MAX + 1)),
    /exceeds .* lines/,
  );
});

test("a non-string source fails rather than coercing", () => {
  for (const value of [null, undefined, 42, {}, ["#"]]) {
    assert.throws(() => render_markdown(value), AssertionError);
  }
});

test("rendering is stable across calls, so no regex keeps state", () => {
  const source = "`a` and `b`\n\n`c`";
  const first = render_markdown(source);
  assert.equal(render_markdown(source), first);
  assert.equal(render_markdown(source), first);
});
