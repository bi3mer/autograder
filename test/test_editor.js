/**
 * The editor, minus the DOM.
 *
 * `wire_editor` needs a real textarea and belongs to the browser, the same
 * split `page.js` and `test_page.js` use. What is testable here is the indent
 * arithmetic, which is where a wrong answer is silent: an off-by-one in
 * `indent_selection` moves a student's cursor into the middle of their
 * indentation and they cannot say why.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../src/assert.js";
import {
  break_line, draft_key, gutter_text, indent_selection, line_offset, next_indent,
  stdin_lines_from_text,
} from "../src/editor.js";

test("next_indent keeps the current depth", () => {
  assert.equal(next_indent("x = 1"), "");
  assert.equal(next_indent("    x = 1"), "    ");
  assert.equal(next_indent("        total += 1"), "        ");
});

test("next_indent steps in after a line that opens a block", () => {
  assert.equal(next_indent("if x:"), "    ");
  assert.equal(next_indent("    for i in range(3):"), "        ");
  assert.equal(next_indent("def main():"), "    ");
  assert.equal(next_indent("while True:   "), "    ", "trailing space still opens a block");
});

test("next_indent sees the colon behind a trailing comment", () => {
  assert.equal(next_indent("if x:  # check it"), "    ");
  // A colon inside the comment did not open anything.
  assert.equal(next_indent("x = 1  # set x:"), "");
});

test("Tab on a collapsed cursor inserts one step and moves the caret", () => {
  const edit = indent_selection("ab", 1, 1);
  assert.equal(edit.text, "a    b");
  assert.equal(edit.start, 5);
  assert.equal(edit.end, 5);
  assert.equal(edit.insert, "    ");
});

test("Tab on a selection indents every line it touches", () => {
  const text = "a = 1\nb = 2\nc = 3";
  // The selection starts inside line 1 and ends inside line 2.
  const edit = indent_selection(text, 2, 8);
  assert.equal(edit.text, "    a = 1\n    b = 2\nc = 3");
  assert.equal(edit.from, 0, "the replacement starts at the first line's start");
});

test("Shift+Tab removes one step and never eats more than there is", () => {
  const edit = indent_selection("        deep\n  shallow", 0, 22, true);
  assert.equal(edit.text, "    deep\nshallow");
});

test("Shift+Tab on a line with no indent changes nothing", () => {
  const edit = indent_selection("flat", 0, 4, true);
  assert.equal(edit.text, "flat");
  assert.equal(edit.start, 0);
});

test("a dedent never drags the caret behind its own line", () => {
  const edit = indent_selection("  ab", 1, 1, true);
  assert.equal(edit.text, "ab");
  assert.ok(edit.start >= 0 && edit.start <= edit.text.length);
});

test("Enter opens the next line at the depth the block wants", () => {
  const edit = break_line("if x:", 5, 5);
  assert.equal(edit.text, "if x:\n    ");
  assert.equal(edit.start, 10);

  const flat = break_line("    x = 1", 9, 9);
  assert.equal(flat.text, "    x = 1\n    ");
});

test("Enter over a selection replaces it", () => {
  const edit = break_line("abcdef", 1, 5);
  assert.equal(edit.text, "a\nf");
});

test("line_offset finds where each line starts, and clamps past the end", () => {
  const text = "one\ntwo\nthree";
  assert.equal(line_offset(text, 1), 0);
  assert.equal(line_offset(text, 2), 4);
  assert.equal(line_offset(text, 3), 8);
  // An error can name a line the student has since deleted.
  assert.equal(line_offset(text, 99), text.length);
});

test("the gutter carries one number per line", () => {
  assert.equal(gutter_text("a\nb\nc"), "1\n2\n3");
  assert.equal(gutter_text(""), "1", "an empty editor still shows line 1");
  assert.equal(gutter_text("a\n"), "1\n2", "a trailing newline is a line to come");
});

test("the stdin box is one input per line, minus the newline the student typed", () => {
  assert.deepEqual(stdin_lines_from_text("10\n3\n"), ["10", "3"]);
  assert.deepEqual(stdin_lines_from_text("10\n3"), ["10", "3"]);
  assert.deepEqual(stdin_lines_from_text(""), []);
  assert.deepEqual(stdin_lines_from_text("a\r\nb\r\n"), ["a", "b"], "CRLF is not input");
  assert.deepEqual(stdin_lines_from_text("\n"), [""], "one deliberately empty answer");
});

test("drafts are keyed per page, so two assignments do not overwrite each other", () => {
  const one = draft_key("/cs230/w1p1.html", "w1-1.py");
  const two = draft_key("/cs230/w2p2.html", "w1-1.py");
  assert.notEqual(one, two);
  assert.match(one, /^autograder:draft:/);
});

test("the pure half rejects arguments it cannot work with", () => {
  assert.throws(() => next_indent(null), AssertionError);
  assert.throws(() => indent_selection("abc", 2, 1), /end/);
  assert.throws(() => indent_selection("abc", -1, 1), /start/);
  assert.throws(() => line_offset("abc", 0), /line/);
  assert.throws(() => draft_key("/p", ""), /filename must not be empty/);
});
