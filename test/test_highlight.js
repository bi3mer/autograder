/**
 * The highlighter, which is pure and therefore entirely testable here.
 *
 * One property matters more than any colour: the tokens must reproduce the
 * source exactly. The highlighted copy is drawn behind the textarea, so a
 * dropped or duplicated character slides every colour after it off the text a
 * student is looking at, and the caret ends up over the wrong glyph. Half of
 * these tests are that property; the rest are the cases where a naive scanner
 * eats the rest of the file.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../src/assert.js";
import { HIGHLIGHT_BYTES_MAX } from "../src/constants.js";
import { highlight_html, tokenize_python } from "../src/highlight.js";

/** The kinds a source scans to, in order, ignoring the plain runs between. */
function kinds(source) {
  return tokenize_python(source)
    .filter((token) => token.kind !== "plain")
    .map((token) => `${token.kind}:${token.text}`);
}

test("the tokens reproduce the source, character for character", () => {
  const sources = [
    "x = 1\n",
    "def main():\n    print('hi')\n",
    "# just a comment",
    "s = 'unterminated\nnext = 2",
    '"""\ndocstring\n"""\n',
    "\t\tif x >= 3.5e-2 and y:  # note\n",
    "@decorator\ndef f(a, *b, **c): pass\n",
    "",
    "\n\n\n",
    "é = 'unicode ✓'",
  ];
  for (const source of sources) {
    const joined = tokenize_python(source).map((token) => token.text).join("");
    assert.equal(joined, source, JSON.stringify(source));
  }
});

test("keywords, builtins, and the name after def are told apart", () => {
  assert.deepEqual(
    kinds("def main():"),
    ["keyword:def", "def:main"],
    "the parens and the colon are punctuation, and stay plain",
  );
  assert.deepEqual(kinds("if x:"), ["keyword:if"]);
  assert.deepEqual(kinds("print(x)"), ["builtin:print"]);
  assert.deepEqual(kinds("class Dog:"), ["keyword:class", "def:Dog"]);
  // A name that merely contains a keyword is a name.
  assert.deepEqual(kinds("iffy = 1"), ["op:=", "number:1"]);
  assert.deepEqual(kinds("printer = 2"), ["op:=", "number:2"]);
});

test("a comment runs to the end of its line and no further", () => {
  assert.deepEqual(
    kinds("x = 1  # set x\ny = 2"),
    ["op:=", "number:1", "comment:# set x", "op:=", "number:2"],
  );
});

test("a quote inside a comment does not open a string", () => {
  assert.deepEqual(kinds("# it's fine\nx = 1"), ["comment:# it's fine", "op:=", "number:1"]);
});

test("an unterminated string stops at the newline, so one quote is not the whole file", () => {
  const scanned = kinds("s = 'oops\nprint(s)");
  assert.deepEqual(scanned, ["op:=", "string:'oops", "builtin:print"]);
});

test("a triple-quoted string spans lines, and an unterminated one runs to the end", () => {
  assert.deepEqual(kinds('"""a\nb"""'), ['string:"""a\nb"""']);
  assert.deepEqual(kinds('x = """a\nb'), ["op:=", 'string:"""a\nb']);
});

test("an escaped quote does not close the string", () => {
  assert.deepEqual(kinds("'it\\'s'"), ["string:'it\\'s'"]);
  assert.deepEqual(kinds('"a\\\\"'), ['string:"a\\\\"']);
});

test("a prefixed string is one token, not a name beside a string", () => {
  assert.deepEqual(kinds('f"{x}"'), ['string:f"{x}"']);
  assert.deepEqual(kinds("rb'raw'"), ["string:rb'raw'"]);
  assert.deepEqual(kinds('f"""a\nb"""'), ['string:f"""a\nb"""']);
  // `format` is a builtin, not a string prefix, even beside a quote.
  assert.deepEqual(kinds('format("x")'), ["builtin:format", 'string:"x"']);
});

test("numbers cover the forms a first-year program writes", () => {
  assert.deepEqual(kinds("0x1f"), ["number:0x1f"]);
  assert.deepEqual(kinds("1_000"), ["number:1_000"]);
  assert.deepEqual(kinds("3.14"), ["number:3.14"]);
  assert.deepEqual(kinds(".5"), ["number:.5"]);
  assert.deepEqual(kinds("2e-3"), ["number:2e-3"]);
  // A number cannot start inside a name, or `x2` becomes `x` and `2`.
  assert.deepEqual(kinds("x2 = 1"), ["op:=", "number:1"]);
});

test("a decorator is only one where a decorator can appear", () => {
  assert.deepEqual(kinds("@staticmethod"), ["decorator:@staticmethod"]);
  assert.deepEqual(kinds("  @wraps"), ["decorator:@wraps"]);
  // Matrix multiplication, not a decorator on b.
  assert.deepEqual(kinds("a @ b"), ["op:@"]);
});

test("the markup escapes the source rather than rendering it", () => {
  const html = highlight_html("x = '<script>alert(1)</script>'");
  assert.ok(!html.includes("<script>"), html);
  assert.match(html, /&lt;script&gt;/);
  // The comparison is an operator token, so the escaping is inside the span.
  assert.match(highlight_html("a < b & c"), /a <span class="tok-op">&lt;<\/span> b /);
  assert.match(highlight_html("d = {'k': 1}  # a & b"), /# a &amp; b/);
});

test("the markup wraps each coloured token and leaves plain text alone", () => {
  const html = highlight_html("if x:\n");
  assert.match(html, /<span class="tok-keyword">if<\/span>/);
  assert.ok(html.includes(" x:"), html);
});

test("stripping the markup gives the source back, which is what keeps the layers aligned", () => {
  const source = "def add(a, b):\n    # sum\n    return a + b  # done\n";
  const text = highlight_html(source).replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  // The one deliberate difference: a trailing newline is doubled so the empty
  // last line has a line box in the <pre> the way it does in the textarea.
  assert.equal(text, source + "\n");
});

test("a buffer past the highlight ceiling is escaped rather than scanned", () => {
  const huge = "x\n".repeat(HIGHLIGHT_BYTES_MAX);
  const html = highlight_html(huge);
  assert.ok(!html.includes("<span"), "no tokens above the ceiling");
  assert.ok(html.length >= huge.length);
  assert.throws(() => tokenize_python(huge), AssertionError);
});

test("the scanner rejects what it cannot scan", () => {
  assert.throws(() => tokenize_python(null), AssertionError);
  assert.throws(() => highlight_html(42), /must be a string/);
});
