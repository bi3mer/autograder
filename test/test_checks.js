/**
 * Substring and line-diff checks.
 *
 * These decide whether a student's line "matches", so their edge cases are
 * the ones that move scores: a CRLF submission, a trailing blank line, a
 * transcript whose first lines are echoed prompts rather than output.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../src/assert.js";
import * as checks from "../src/checks.js";
import { LINE_ABSENT } from "../src/constants.js";

test("contains finds a substring and reports a missing one", () => {
  assert.equal(checks.contains('x = input("a: ")', 'input("a: ")'), true);
  assert.equal(checks.contains('x = input("a: ")', "input('a: ')"), false);
});

test("contains is case-sensitive by default and case-folds on request", () => {
  assert.equal(checks.contains("Total Cost", "total cost"), false);
  assert.equal(checks.contains("Total Cost", "total cost", { case_sensitive: false }), true);
});

test("contains_set reports matched and missing needles", () => {
  const needles = [['input("a: ")', "input('a: ')"], "missing"];
  const result = checks.contains_set('x = input("a: ")', needles);
  assert.equal(result.pass, false);
  assert.deepEqual(result.matched, ['input("a: ") | input(\'a: \')']);
  assert.deepEqual(result.missing, ["missing"]);
});

test("contains_set labels alternatives with a pipe, which is what the student sees", () => {
  const result = checks.contains_set("round(x, 2)", [["round(", "format("]]);
  assert.deepEqual(result.matched, ["round( | format("]);
});

test("mode all needs every needle; mode any needs one", () => {
  const needles = ["print", "input"];
  assert.equal(checks.contains_set("print(1)", needles).pass, false);
  assert.equal(checks.contains_set("print(1)", needles, { mode: "any" }).pass, true);
  assert.equal(checks.contains_set("print(input())", needles).pass, true);
});

test("contains_set classifies every needle, matched or missing", () => {
  const result = checks.contains_set("a b", ["a", "b", "c", "d"]);
  assert.equal(result.matched.length + result.missing.length, 4);
});

test("contains_set rejects a mode it does not implement", () => {
  assert.throws(
    () => checks.contains_set("a", ["a"], { mode: "some" }),
    /mode must be "all" or "any", got some/,
  );
});

test("contains_set rejects a malformed needle", () => {
  assert.throws(() => checks.contains_set("a", [null]), /needle\[0\] must not be null/);
  assert.throws(() => checks.contains_set("a", [42]), AssertionError);
  assert.throws(() => checks.contains_set("a", [[]]), /at least one alternative/);
});

test("find_lines returns 1-indexed line numbers in ascending order", () => {
  assert.deepEqual(checks.find_lines("a\nb\na", "a"), [1, 3]);
  assert.deepEqual(checks.find_lines("a\nb\na", "zzz"), []);
});

test("find_lines can fold case, which the default does not", () => {
  assert.deepEqual(checks.find_lines("Total\ntotal", "total"), [2]);
  assert.deepEqual(checks.find_lines("Total\ntotal", "total", { case_sensitive: false }), [1, 2]);
});

test("diff_lines ignores trailing blanks and honours the anchor", () => {
  const diff = checks.diff_lines("prompt: x\nHEAD\n1\n\n", ["HEAD", "1"], {
    anchor_prefix: "HEAD",
  });
  assert.equal(diff.all_match, true);
  assert.equal(diff.rows.length, 2);
});

test("diff_lines keeps every line when the anchor never appears", () => {
  const diff = checks.diff_lines("a\nb", ["a", "b"], { anchor_prefix: "HEAD" });
  assert.equal(diff.all_match, true);
  assert.deepEqual(diff.rows.map((row) => row.got), ["a", "b"]);
});

test("diff_lines marks a missing line with the absent placeholder", () => {
  const diff = checks.diff_lines("a", ["a", "b"]);
  assert.equal(diff.all_match, false);
  assert.equal(diff.rows[1].got, LINE_ABSENT);
  assert.equal(diff.rows[1].expected, "b");
});

test("diff_lines marks an extra line the same way, on the expected side", () => {
  const diff = checks.diff_lines("a\nb\nc", ["a"]);
  assert.equal(diff.all_match, false);
  assert.equal(diff.rows.length, 3);
  assert.equal(diff.rows[2].expected, LINE_ABSENT);
  assert.equal(diff.rows[2].got, "c");
});

test("diff_lines treats a CRLF submission like an LF one", () => {
  const diff = checks.diff_lines("a\r\nb\r\n", ["a", "b"]);
  assert.equal(diff.all_match, true);
});

test("diff_lines flags a mismatched line and still returns the pair", () => {
  const diff = checks.diff_lines("1\n9\n3\n", ["1", "2", "3"]);
  assert.equal(diff.all_match, false);
  assert.deepEqual(diff.rows.map((row) => row.ok), [true, false, true]);
  assert.deepEqual(diff.rows[1], { got: "9", expected: "2", ok: false });
});

test("diff_lines accepts absent output, which is what a crashed run leaves", () => {
  const diff = checks.diff_lines(null, ["a"]);
  assert.equal(diff.all_match, false);
  assert.equal(diff.rows[0].got, LINE_ABSENT);
});
