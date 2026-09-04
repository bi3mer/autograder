/**
 * Python syntax highlighting for the editor, with no dependency and no build.
 *
 * The editor is a textarea, and a textarea paints one colour. The way to give
 * it colour without giving up a textarea's undo history, spellcheck-off, and
 * native caret is to draw the same text a second time behind it: a `<pre>`
 * holds the highlighted copy, the textarea sits on top with transparent text,
 * and the two scroll together. That only works while the two agree character
 * for character, so this module escapes through `html.js` and never inserts,
 * drops, or reorders a character of the student's source.
 *
 * The scanner is deliberately small. It is a lexer, not a parser: it knows
 * comments, strings, numbers, keywords, builtins, and the name after `def` or
 * `class`. It does not know scope, so a variable named `list` is coloured like
 * the builtin. That is the price of a hundred lines instead of CodeMirror, and
 * for a first-year assignment it is the wrong colour on a name a student
 * should not be shadowing anyway.
 *
 * A token is `{ kind, text }`, and concatenating every `text` reproduces the
 * input exactly. `tokenize_python` asserts that before returning.
 */

import { assert, assert_string } from "./assert.js";
import { HIGHLIGHT_BYTES_MAX, HIGHLIGHT_TOKEN_COUNT_MAX } from "./constants.js";
import { escape_html } from "./html.js";

/**
 * Reserved words. The soft keywords `match` and `case` are left out on
 * purpose: they are ordinary names outside a match statement, and colouring
 * `case = 3` as a keyword is a worse lie than leaving a match statement plain.
 */
export const PYTHON_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
  "return", "try", "while", "with", "yield",
]);

/**
 * The builtins a first-year course actually reaches for, plus the exceptions a
 * traceback names. A longer list would colour more and teach less.
 */
export const PYTHON_BUILTINS = new Set([
  "abs", "all", "any", "bin", "bool", "chr", "dict", "divmod", "enumerate", "eval",
  "filter", "float", "format", "hex", "input", "int", "isinstance", "len", "list", "map",
  "max", "min", "next", "object", "oct", "open", "ord", "pow", "print", "range", "repr",
  "reversed", "round", "set", "sorted", "str", "sum", "super", "tuple", "type", "zip",
  "self", "Exception", "IndexError", "KeyError", "NameError", "TypeError", "ValueError",
  "ZeroDivisionError",
]);

/** `f`, `rb`, `BR`: the letters that may sit in front of a quote. */
const STRING_PREFIX = /^(?:[bBfFrRuU]|[bB][rR]|[rR][bB]|[fF][rR]|[rR][fF])$/;

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const OPERATOR = /[+\-*/%=<>!&|^~@]/;

function is_identifier_start(character) {
  return IDENTIFIER_START.test(character);
}

/**
 * A string literal, from its opening quote to its close.
 *
 * Two ways out besides the closing quote, and both matter while a student is
 * mid-keystroke: a single-quoted string ends at the newline, because the quote
 * they have not typed yet must not swallow the rest of the file, and a
 * triple-quoted one ends at the end of the text, because that one really does
 * run on.
 */
function scan_string(text, start, quote_length) {
  const quote = text.slice(start, start + quote_length);
  let index = start + quote_length;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (quote_length === 1 && character === "\n") return index;
    if (text.startsWith(quote, index)) return index + quote_length;
    index += 1;
  }
  return text.length;
}

/** A number, including `0x`, `1_000`, `3.14e-2`, and the imaginary `j`. */
function scan_number(text, start) {
  let index = start;
  if (text[index] === "0" && /[xXoObB]/.test(text[index + 1] ?? "")) {
    index += 2;
    while (index < text.length && /[0-9a-fA-F_]/.test(text[index])) index += 1;
    return index;
  }
  while (index < text.length && /[0-9_]/.test(text[index])) index += 1;
  if (text[index] === "." ) {
    index += 1;
    while (index < text.length && /[0-9_]/.test(text[index])) index += 1;
  }
  if (/[eE]/.test(text[index] ?? "") && /[0-9+-]/.test(text[index + 1] ?? "")) {
    index += 2;
    while (index < text.length && /[0-9_]/.test(text[index])) index += 1;
  }
  if (/[jJ]/.test(text[index] ?? "")) index += 1;
  return index;
}

/**
 * Split Python source into `{ kind, text }` tokens.
 *
 * `kind` is one of `"plain"`, `"comment"`, `"string"`, `"number"`, `"keyword"`,
 * `"builtin"`, `"def"` (the name being defined), `"decorator"`, or `"op"`.
 */
export function tokenize_python(source) {
  const text = assert_string(source, "tokenize_python: source", HIGHLIGHT_BYTES_MAX);
  const tokens = [];
  let index = 0;
  // The word before the one being scanned, so `def main` can colour `main`.
  let previous_word = "";

  function push(kind, end) {
    assert(end > index, "tokenize_python: every token must consume at least one character");
    tokens.push({ kind, text: text.slice(index, end) });
    assert(
      tokens.length <= HIGHLIGHT_TOKEN_COUNT_MAX,
      `tokenize_python: over ${HIGHLIGHT_TOKEN_COUNT_MAX} tokens`,
    );
    index = end;
  }

  while (index < text.length) {
    const character = text[index];

    if (character === "#") {
      const newline = text.indexOf("\n", index);
      push("comment", newline === -1 ? text.length : newline);
      continue;
    }

    if (character === '"' || character === "'") {
      const triple = text.startsWith(character.repeat(3), index) ? 3 : 1;
      push("string", scan_string(text, index, triple));
      previous_word = "";
      continue;
    }

    if (is_identifier_start(character)) {
      let end = index;
      while (end < text.length && IDENTIFIER_PART.test(text[end])) end += 1;
      const word = text.slice(index, end);
      // `f"..."` is one string, not the name `f` beside a string.
      const quote = text[end];
      if ((quote === '"' || quote === "'") && STRING_PREFIX.test(word)) {
        const triple = text.startsWith(quote.repeat(3), end) ? 3 : 1;
        push("string", scan_string(text, end, triple));
        previous_word = "";
        continue;
      }
      let kind = "plain";
      if (PYTHON_KEYWORDS.has(word)) kind = "keyword";
      else if (previous_word === "def" || previous_word === "class") kind = "def";
      else if (PYTHON_BUILTINS.has(word)) kind = "builtin";
      previous_word = word;
      push(kind, end);
      continue;
    }

    if (DIGIT.test(character)
      || (character === "." && DIGIT.test(text[index + 1] ?? ""))) {
      push("number", scan_number(text, index));
      previous_word = "";
      continue;
    }

    // A decorator, but only where one can appear: `@` is otherwise matrix
    // multiplication, and `a @ b` is not a decorator on `b`.
    if (character === "@" && /(^|\n)[ \t]*$/.test(text.slice(0, index))) {
      let end = index + 1;
      while (end < text.length && IDENTIFIER_PART.test(text[end])) end += 1;
      if (end > index + 1) {
        push("decorator", end);
        previous_word = "";
        continue;
      }
    }

    if (OPERATOR.test(character)) {
      push("op", index + 1);
      previous_word = "";
      continue;
    }

    // Everything else — whitespace, brackets, commas, colons — runs together
    // until something interesting starts, so a line is a handful of tokens
    // rather than one per character.
    let end = index + 1;
    while (
      end < text.length
      && !is_identifier_start(text[end])
      && !DIGIT.test(text[end])
      && !OPERATOR.test(text[end])
      && text[end] !== "#"
      && text[end] !== '"'
      && text[end] !== "'"
    ) end += 1;
    if (text.slice(index, end).trim() !== "") previous_word = "";
    push("plain", end);
  }

  assert(
    tokens.map((token) => token.text).join("") === text,
    "tokenize_python: the tokens must reproduce the source exactly",
  );
  return tokens;
}

/**
 * The highlighted copy of the source, as markup for the layer behind the
 * textarea.
 *
 * Two details keep the layers aligned. The trailing newline is doubled,
 * because a `<pre>` ending in a newline renders no line box for the empty last
 * line while the textarea reserves one, and the caret would sit a line below
 * its own colour. And source past `HIGHLIGHT_BYTES_MAX` is escaped without
 * being scanned: colour is worth nothing next to a keystroke that stutters.
 */
export function highlight_html(source) {
  assert(typeof source === "string", "highlight_html: source must be a string");
  const tail = source.endsWith("\n") ? "\n" : "";
  if (source.length > HIGHLIGHT_BYTES_MAX) return escape_html(source) + tail;
  const parts = tokenize_python(source).map((token) => (
    token.kind === "plain"
      ? escape_html(token.text)
      : `<span class="tok-${token.kind}">${escape_html(token.text)}</span>`
  ));
  const html = parts.join("") + tail;
  assert(!/<script/i.test(html), "highlight_html: source must never render as markup");
  return html;
}
