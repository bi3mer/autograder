/**
 * What the Copy button hands a student.
 *
 * `grader.js` is page glue and most of it needs a DOM, but `submission_text`
 * is a pure function from a summary and a source file to one paste, and it is
 * the piece a wrong answer costs points for: a docstring that does not open
 * on line 1, or does not close before the code, is the exact mistake the
 * button exists to prevent.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../src/assert.js";
import { SOURCE_BYTES_MAX } from "../src/constants.js";
import { submission_text } from "../src/grader.js";

const SUMMARY = [
  "w4-i1.py — Autograder Summary",
  "Score: 30 / 40",
  "",
  "- Compiles without syntax errors: OK",
  "- flake8: 5 / 5",
].join("\n");

const SOURCE = 'text = input("Enter a string: ")\nprint(text)\n';

test("the summary opens the file as a docstring, with the code below it", () => {
  const paste = submission_text(SUMMARY, SOURCE);
  const lines = paste.split("\n");
  assert.equal(lines[0], '"""', "line 1 is the opening quote, so the docstring is first");
  assert.equal(lines[1], "w4-i1.py — Autograder Summary");
  const close = lines.indexOf('"""', 1);
  assert.equal(lines[close + 1], "", "exactly one blank line between the docstring and the code");
  assert.equal(lines[close + 2], 'text = input("Enter a string: ")');
});

test("the docstring ends with blank lines for the prompts a student asked an AI", () => {
  const lines = submission_text(SUMMARY, SOURCE).split("\n");
  const close = lines.indexOf('"""', 1);
  assert.deepEqual(lines.slice(close - 4, close), [
    "AI prompts, one per line (write none if you asked none):",
    "-",
    "-",
    "-",
  ]);
  assert.equal(lines[close - 5], "", "a blank line separates them from the rubric rows");
  assert.ok(
    !lines.some((line) => line !== line.trimEnd()),
    "no line carries trailing whitespace a student would have to delete",
  );
});

test("the code is kept verbatim, and the paste ends with one newline", () => {
  const paste = submission_text(SUMMARY, SOURCE);
  assert.ok(paste.endsWith('print(text)\n'));
  assert.ok(paste.includes(SOURCE.trimEnd()), "the graded source survives unchanged");
});

test("blank lines around the source do not drift the code away from the docstring", () => {
  const paste = submission_text(SUMMARY, `\n  \n${SOURCE}\n\n\n`);
  assert.equal(paste, submission_text(SUMMARY, SOURCE));
});

test("a docstring in the student's own code does not close ours early", () => {
  const paste = submission_text(SUMMARY, '"""a helper."""\nprint(1)\n');
  const first_close = paste.indexOf('"""', 3);
  assert.ok(first_close < paste.indexOf('"""a helper'), "ours closes before theirs opens");
});

test("an empty source still produces a valid docstring", () => {
  const paste = submission_text(SUMMARY, "");
  assert.ok(paste.startsWith(`"""\n${SUMMARY}\n\nAI prompts`));
  assert.ok(paste.endsWith('-\n"""\n\n\n'));
});

test("a triple quote in the summary is a config bug, not a broken paste", () => {
  assert.throws(
    () => submission_text('Score: """ / 40', SOURCE),
    AssertionError,
  );
});

test("a summary ending in a backslash would escape the closing quote", () => {
  assert.throws(() => submission_text("Score: 30 / 40\\", SOURCE), AssertionError);
});

test("a non-string summary or source is rejected at the boundary", () => {
  assert.throws(() => submission_text(null, SOURCE), AssertionError);
  assert.throws(() => submission_text(SUMMARY, 42), AssertionError);
});

test("a source at the grader's ceiling still assembles, docstring and all", () => {
  // `accept_file` turns away a source LONGER than the ceiling, so one exactly
  // at it is graded, and the paste built around it is necessarily larger.
  const paste = submission_text(SUMMARY, "#".repeat(SOURCE_BYTES_MAX));
  assert.ok(paste.length > SOURCE_BYTES_MAX, "the docstring pushes it over the source bound");
  assert.ok(paste.startsWith('"""\n'));
  assert.ok(paste.endsWith("#\n"));
});
