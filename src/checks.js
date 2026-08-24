/**
 * Substring and line-diff checks over arbitrary text.
 *
 * Every function here takes a plain string, so the same four checks cover
 * "does the source contain X" and "does the captured stdout contain X".
 * Nothing here touches Pyodide or the DOM; `rubric` composes
 * these into scored criteria.
 *
 * @module checks
 */

import { assert, assert_array, assert_string } from "./assert.js";
import {
  LINE_ABSENT, LINE_COUNT_MAX, NEEDLE_ALTERNATIVE_COUNT_MAX, NEEDLE_CHARS_MAX,
  NEEDLE_COUNT_MAX, OUTPUT_BYTES_MAX,
} from "./constants.js";

/**
 * One thing to search for: a literal substring, or a list of alternative
 * spellings of the same thing where matching any one counts as a match
 * (`['input("x: ")', "input('x: ')"]` accepts either quote style).
 *
 * @typedef {string | string[]} Needle
 */

/**
 * @typedef {object} MatchOptions
 * @property {boolean} [case_sensitive=true] Compare with case intact.
 */

/**
 * @typedef {object} ContainsSetResult
 * @property {boolean} pass Whether the set satisfied `mode`.
 * @property {string[]} matched Labels of the needles that were found.
 * @property {string[]} missing Labels of the needles that were absent.
 */

/**
 * @typedef {object} DiffRow
 * @property {string} got Line produced by the submission, or `"∅"` if absent.
 * @property {string} expected Line the assignment requires, or `"∅"` if absent.
 * @property {boolean} ok Whether the two sides are byte-identical.
 */

/**
 * @typedef {object} DiffResult
 * @property {boolean} all_match Every row matched and the line counts agree.
 * @property {DiffRow[]} rows One row per aligned line pair, in output order.
 */

/**
 * Case-fold `text` when the comparison is case-insensitive.
 *
 * @param {string} text Text to fold.
 * @param {boolean} case_sensitive Leave case intact when true.
 * @returns {string} `text`, folded or unchanged.
 */
function normalize(text, case_sensitive) {
  assert(typeof text === "string", "normalize: text must be a string");
  assert(typeof case_sensitive === "boolean", "normalize: case_sensitive must be a boolean");
  return case_sensitive ? text : text.toLowerCase();
}

/**
 * Split `text` into lines, with the line count asserted against a ceiling.
 *
 * Carriage returns are dropped so a CRLF submission diffs the same as an LF
 * one; students on Windows should not lose points to their editor.
 *
 * @param {string} text Text to split.
 * @param {string} name Identifier used in failure messages.
 * @returns {string[]} Lines, at most {@link LINE_COUNT_MAX} of them.
 */
function split_lines(text, name) {
  assert_string(text, name, OUTPUT_BYTES_MAX);
  assert(typeof name === "string" && name.length > 0, "split_lines: name must be non-empty");
  const lines = text.replace(/\r/g, "").split("\n");
  assert(
    lines.length <= LINE_COUNT_MAX,
    `${name} exceeds ${LINE_COUNT_MAX} lines: ${lines.length}`,
  );
  return lines;
}

/**
 * Expand a needle into its alternatives and its display label.
 *
 * @param {Needle} needle Literal substring, or alternatives for one thing.
 * @param {number} index Position in the needle list, for failure messages.
 * @returns {{ alternatives: string[], label: string }} Alternatives to test,
 *   plus the label reported back to the student (alternatives joined by `|`).
 */
function expand_needle(needle, index) {
  assert(
    Number.isInteger(index) && index >= 0,
    "expand_needle: index must be a non-negative integer",
  );
  assert(needle != null, `needle[${index}] must not be null`);
  const alternatives = Array.isArray(needle) ? needle : [needle];
  assert_array(alternatives, `needle[${index}]`, NEEDLE_ALTERNATIVE_COUNT_MAX);
  assert(alternatives.length > 0, `needle[${index}] must have at least one alternative`);
  for (let i = 0; i < alternatives.length; i++) {
    assert_string(alternatives[i], `needle[${index}][${i}]`, NEEDLE_CHARS_MAX);
  }
  const label = alternatives.length > 1 ? alternatives.join(" | ") : alternatives[0];
  assert(label.length > 0, `needle[${index}] label must not be empty`);
  return { alternatives, label };
}

/**
 * Does `text` contain `needle`?
 *
 * @param {string} text Haystack: source code, captured stdout, anything.
 * @param {string} needle Substring to look for.
 * @param {MatchOptions} [options] Comparison options.
 * @returns {boolean} True when `needle` occurs in `text`.
 */
export function contains(text, needle, options = {}) {
  assert_string(text, "contains: text", OUTPUT_BYTES_MAX);
  assert_string(needle, "contains: needle", NEEDLE_CHARS_MAX);
  assert(options != null && typeof options === "object", "contains: options must be an object");
  const case_sensitive = options.case_sensitive !== false;
  return normalize(text, case_sensitive).includes(normalize(needle, case_sensitive));
}

/**
 * Check `text` against a list of needles.
 *
 * @param {string} text Haystack to search.
 * @param {Needle[]} needles Needles to look for, each a substring or a list
 *   of alternatives.
 * @param {MatchOptions & { mode?: "all" | "any" }} [options] `mode` is
 *   `"all"` (default: every needle must be present) or `"any"` (at least
 *   one). Both modes report the full matched/missing split either way.
 * @returns {ContainsSetResult} Pass flag plus what hit and what did not, so
 *   the caller can show the student exactly which needles are missing.
 */
export function contains_set(text, needles, options = {}) {
  assert_string(text, "contains_set: text", OUTPUT_BYTES_MAX);
  assert_array(needles, "contains_set: needles", NEEDLE_COUNT_MAX);
  assert(options != null && typeof options === "object", "contains_set: options must be an object");
  const mode = options.mode ?? "all";
  assert(
    mode === "all" || mode === "any",
    `contains_set: mode must be "all" or "any", got ${mode}`,
  );
  const case_sensitive = options.case_sensitive !== false;

  const haystack = normalize(text, case_sensitive);
  /** @type {string[]} */
  const matched = [];
  /** @type {string[]} */
  const missing = [];
  for (let index = 0; index < needles.length; index++) {
    const { alternatives, label } = expand_needle(needles[index], index);
    let found = false;
    for (let alt = 0; alt < alternatives.length && !found; alt++) {
      found = haystack.includes(normalize(alternatives[alt], case_sensitive));
    }
    (found ? matched : missing).push(label);
  }

  assert(
    matched.length + missing.length === needles.length,
    "contains_set: every needle must be classified",
  );
  const pass = mode === "any" ? matched.length > 0 : missing.length === 0;
  return { pass, matched, missing };
}

/**
 * Find the 1-indexed line numbers where `needle` appears in `text`.
 *
 * Points at exactly where a required or forbidden substring sits, which is
 * what turns "missing a prompt" into "line 12 is the wrong prompt".
 *
 * @param {string} text Multi-line haystack.
 * @param {string} needle Substring to locate.
 * @param {MatchOptions} [options] Comparison options.
 * @returns {number[]} Line numbers, ascending, 1-indexed; empty when absent.
 */
export function find_lines(text, needle, options = {}) {
  assert_string(text, "find_lines: text", OUTPUT_BYTES_MAX);
  assert_string(needle, "find_lines: needle", NEEDLE_CHARS_MAX);
  assert(options != null && typeof options === "object", "find_lines: options must be an object");
  const case_sensitive = options.case_sensitive !== false;

  const target = normalize(needle, case_sensitive);
  const lines = split_lines(normalize(text, case_sensitive), "find_lines: text");
  /** @type {number[]} */
  const line_numbers = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes(target)) line_numbers.push(index + 1);
  }

  assert(line_numbers.length <= lines.length, "find_lines: cannot match more lines than exist");
  return line_numbers;
}

/**
 * Drop trailing blank lines, then skip everything before `anchor_prefix`.
 *
 * The anchor exists because a captured transcript starts with echoed input
 * prompts; anchoring on the first real output line ("Habit Costs for") lets
 * the diff compare program output against program output.
 *
 * @param {string[]} lines Captured output lines.
 * @param {string} [anchor_prefix] First line of the real output, if known.
 * @returns {string[]} Lines from the anchor onward, trailing blanks removed.
 */
function trim_to_anchor(lines, anchor_prefix) {
  assert(Array.isArray(lines), "trim_to_anchor: lines must be an array");
  assert(lines.length <= LINE_COUNT_MAX, `trim_to_anchor: lines exceeds ${LINE_COUNT_MAX}`);
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  let trimmed = lines.slice(0, end);
  if (anchor_prefix != null) {
    assert_string(anchor_prefix, "trim_to_anchor: anchor_prefix", NEEDLE_CHARS_MAX);
    const anchor_index = trimmed.findIndex((line) => line.startsWith(anchor_prefix));
    if (anchor_index > 0) trimmed = trimmed.slice(anchor_index);
  }
  assert(trimmed.length <= lines.length, "trim_to_anchor: trimming cannot add lines");
  return trimmed;
}

/**
 * Line-diff `text` against the lines the assignment expects.
 *
 * @param {string} text Captured stdout from one test case.
 * @param {string[]} expected_lines Required output, one entry per line.
 * @param {{ anchor_prefix?: string }} [options] Anchor to skip echoed input
 *   prompts preceding the real output.
 * @returns {DiffResult} Per-line comparison, aligned by index, with `"∅"`
 *   standing in on whichever side ran out of lines first.
 */
export function diff_lines(text, expected_lines, options = {}) {
  assert_string(text ?? "", "diff_lines: text", OUTPUT_BYTES_MAX);
  assert_array(expected_lines, "diff_lines: expected_lines", LINE_COUNT_MAX);
  assert(options != null && typeof options === "object", "diff_lines: options must be an object");

  const got = trim_to_anchor(split_lines(text ?? "", "diff_lines: text"), options.anchor_prefix);
  const row_count = Math.max(got.length, expected_lines.length);
  assert(row_count <= LINE_COUNT_MAX, `diff_lines: row_count exceeds ${LINE_COUNT_MAX}`);

  /** @type {DiffRow[]} */
  const rows = [];
  let all_match = got.length === expected_lines.length;
  for (let index = 0; index < row_count; index++) {
    const got_line = got[index] ?? LINE_ABSENT;
    const expected_line = expected_lines[index] ?? LINE_ABSENT;
    const ok = got_line === expected_line;
    if (!ok) all_match = false;
    rows.push({ got: got_line, expected: expected_line, ok });
  }

  assert(rows.length === row_count, "diff_lines: one row per aligned line pair");
  return { all_match, rows };
}
