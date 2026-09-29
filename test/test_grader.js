/**
 * What the Copy button hands a student, and the grading behind it.
 *
 * `grader.js` is page glue and most of it needs a DOM, but `submission_text`
 * is a pure function from a summary and a source file to one paste, and it is
 * the piece a wrong answer costs points for: a docstring that does not open
 * on line 1, or does not close before the code, is the exact mistake the
 * button exists to prevent. `grade_source` is the grading the page and the
 * terminal share, run here against a fake interpreter as in
 * `test_pyrunner.js`: which rows it builds, and when a gate zeroes the score.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../src/assert.js";
import { SOURCE_BYTES_MAX } from "../src/constants.js";
import { grade_source, submission_text } from "../src/grader.js";
import * as py_runner from "../src/pyrunner.js";

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

/**
 * What the next run of the fake interpreter reports. Clean by default, so a
 * test sets only the failure it is about.
 */
let next_run = {};

/** The one interpreter `grader.js` shares with this file, answered from `next_run`. */
await py_runner.init({
  load_pyodide: async () => ({
    async loadPackage() {},
    pyimport: () => ({ install: async () => {} }),
    async runPythonAsync(source) {
      if (!source.includes('json.dumps({"out"')) return undefined;
      return JSON.stringify({ out: "", err: "", prompts: [], kind: "", line: null, col: null, ...next_run });
    },
  }),
});

const ASSIGNMENT = {
  filename: "t.py",
  cases: [{ name: "one", stdin_lines: [], expected_lines: [] }],
  build_criteria: () => [{
    id: "print",
    name: "Uses print",
    description: "Calls print().",
    points: 10,
    type: "code",
    needles: [["print("]],
  }],
  max_auto_points: 10,
};

test("grade_source scores a clean run row by row, and builds the page's summary", async () => {
  next_run = {};
  const result = await grade_source(ASSIGNMENT, "print(1)\n");
  assert.equal(result.zero_reason, null);
  assert.equal(result.total_points, 10);
  assert.deepEqual(result.rows.map((row) => [row.name, row.score]), [
    ["Compiles without syntax errors", "OK"],
    ["Uses print", "10 / 10"],
  ]);
  assert.equal(
    result.summary,
    "t.py — Autograder Summary\nScore: 10 / 10\n\n- Compiles without syntax errors: OK\n- Uses print: 10 / 10",
  );
  assert.equal(result.submission, submission_text(result.summary, "print(1)\n"));
});

test("grade_source zeroes a syntax error and scores nothing else", async () => {
  next_run = { err: "SYNTAX: invalid syntax (t.py, line 1)", kind: "syntax", line: 1, col: 0 };
  const result = await grade_source(ASSIGNMENT, "print(\n");
  assert.equal(result.zero_reason, "syntax error");
  assert.equal(result.total_points, 0);
  assert.deepEqual(result.rows.map((row) => row.score), ["ZERO"]);
  assert.ok(result.summary.includes("Score: 0 (syntax error — see below)"));
});

test("grade_source zeroes a failed gate, and a throwing gate fails rather than crashing", async () => {
  next_run = {};
  const gated = {
    ...ASSIGNMENT,
    gates: [
      { name: "No imports", check: (source) => ({ pass: !source.includes("import") }) },
      { name: "Throws", check: () => { throw new Error("gate bug"); } },
    ],
  };
  const result = await grade_source(gated, "import os\nprint(1)\n");
  assert.equal(result.zero_reason, 'failed "No imports"', "the first failed gate names the zero");
  assert.equal(result.total_points, 0);
  assert.deepEqual(result.rows.map((row) => row.score), ["OK", "ZERO", "ZERO"]);
  assert.ok(result.rows[2].detail.includes("gate bug"));
});

test("grade_source lists manual rows after the scored ones, as pending", async () => {
  next_run = {};
  const manual = {
    ...ASSIGNMENT,
    manual_rows: [{ name: "Comments", description: "Reviewed by hand.", score: "manual / 5", detail: "" }],
  };
  const result = await grade_source(manual, "print(1)\n");
  assert.deepEqual(result.rows.at(-1), {
    mark: "—", state: "pending", name: "Comments", description: "Reviewed by hand.", score: "manual / 5", detail: "",
  });
  assert.equal(result.total_points, 10, "a manual row adds nothing to the total");
});

test("grade_source grades Windows line endings and a byte order mark as plain text", async () => {
  next_run = {};
  const seen = [];
  const watched = {
    ...ASSIGNMENT,
    gates: [{ name: "Sees the source", check: (source) => { seen.push(source); return { pass: true }; } }],
  };
  const result = await grade_source(watched, "﻿x = 1\r\nprint(x)\r\ny = 2\rprint(y)\r\n");
  assert.deepEqual(seen, ["x = 1\nprint(x)\ny = 2\nprint(y)\n"], "every check reads LF, no BOM");
  assert.ok(!result.submission.includes("\r"), "the paste carries the source as graded");
  assert.ok(!result.submission.includes("﻿"));
});

test("grade_source rejects a malformed assignment or source at the boundary", async () => {
  await assert.rejects(grade_source({ ...ASSIGNMENT, cases: [] }, "print(1)"), AssertionError);
  await assert.rejects(grade_source(ASSIGNMENT, 42), AssertionError);
});
