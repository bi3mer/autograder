/**
 * The limits themselves.
 *
 * Every bound in the engine is asserted against one of these, so a constant
 * that drifts to zero, a float, or past the range a caller checks it with
 * would disarm a boundary rather than announce itself.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as constants from "../src/constants.js";

test("every numeric limit is a positive integer", () => {
  for (const [name, value] of Object.entries(constants)) {
    if (typeof value !== "number") continue;
    assert.ok(Number.isInteger(value), `${name} must be an integer, got ${value}`);
    assert.ok(value > 0, `${name} must be positive, got ${value}`);
  }
});

test("every defaulted limit sits inside the range its caller checks", () => {
  assert.ok(constants.LINE_LENGTH_CHARS_DEFAULT >= 1);
  assert.ok(constants.LINE_LENGTH_CHARS_DEFAULT <= constants.LINE_LENGTH_CHARS_MAX);
  // `rubric.flake8_check` bounds max_findings_shown to [1, 1000].
  assert.ok(constants.LINT_FINDING_SHOWN_DEFAULT >= 1);
  assert.ok(constants.LINT_FINDING_SHOWN_DEFAULT <= 1000);
  assert.ok(constants.LINT_FINDING_SHOWN_DEFAULT <= constants.LINT_FINDING_COUNT_MAX);
});

test("a needle's alternatives cannot outnumber the needles themselves", () => {
  assert.ok(constants.NEEDLE_ALTERNATIVE_COUNT_MAX <= constants.NEEDLE_COUNT_MAX);
  assert.ok(constants.NEEDLE_CHARS_MAX <= constants.OUTPUT_BYTES_MAX);
});

test("both Python filenames are bare names, since a path is rejected downstream", () => {
  for (const name of [constants.SUBMISSION_FILENAME_DEFAULT, constants.LINT_FILENAME]) {
    assert.ok(name.length > 0 && name.length <= constants.FILENAME_CHARS_MAX);
    assert.ok(!name.includes("/") && !name.includes("\\"), name);
    assert.ok(name.endsWith(".py"), name);
  }
});

test("the absent-line placeholder is one visible character", () => {
  assert.equal(constants.LINE_ABSENT, "∅");
  assert.equal([...constants.LINE_ABSENT].length, 1);
});
