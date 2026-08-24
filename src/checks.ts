/**
 * Substring and line-diff checks over arbitrary text.
 *
 * Every function here takes a plain string, so the same four checks cover
 * "does the source contain X" and "does the captured stdout contain X".
 * Nothing here touches Pyodide or the DOM; `rubric` composes these into
 * scored criteria.
 */

import { assert, assert_array, assert_string } from "./assert.ts";
import {
  LINE_ABSENT, LINE_COUNT_MAX, NEEDLE_ALTERNATIVE_COUNT_MAX, NEEDLE_CHARS_MAX,
  NEEDLE_COUNT_MAX, OUTPUT_BYTES_MAX,
} from "./constants.ts";

/**
 * A literal substring, or a list of alternative spellings of the same thing
 * where matching any one counts as a match: `['input("x: ")', "input('x: ')"]`
 * accepts either quote style.
 */
export type Needle = string | string[];

export interface MatchOptions {
  case_sensitive?: boolean;
}

export interface ContainsSetResult {
  pass: boolean;
  /** Labels of the needles that were found. */
  matched: string[];
  /** Labels of the needles that were absent. */
  missing: string[];
}

export interface DiffRow {
  /** Line produced by the submission, or `LINE_ABSENT` if it ran out. */
  got: string;
  /** Line the assignment requires, or `LINE_ABSENT` if it ran out. */
  expected: string;
  ok: boolean;
}

export interface DiffResult {
  /** Every row matched and the line counts agree. */
  all_match: boolean;
  rows: DiffRow[];
}

function normalize(text: string, case_sensitive: boolean): string {
  assert(typeof text === "string", "normalize: text must be a string");
  assert(typeof case_sensitive === "boolean", "normalize: case_sensitive must be a boolean");
  return case_sensitive ? text : text.toLowerCase();
}

/**
 * Carriage returns are dropped so a CRLF submission diffs the same as an LF
 * one; students on Windows should not lose points to their editor.
 */
function split_lines(text: string, name: string): string[] {
  assert_string(text, name, OUTPUT_BYTES_MAX);
  assert(typeof name === "string" && name.length > 0, "split_lines: name must be non-empty");
  const lines = text.replace(/\r/g, "").split("\n");
  assert(
    lines.length <= LINE_COUNT_MAX,
    `${name} exceeds ${LINE_COUNT_MAX} lines: ${lines.length}`,
  );
  return lines;
}

/** The label is what the student sees: alternatives joined by `|`. */
function expand_needle(
  needle: Needle | undefined,
  index: number,
): { alternatives: string[], label: string } {
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

export function contains(text: string, needle: string, options: MatchOptions = {}): boolean {
  assert_string(text, "contains: text", OUTPUT_BYTES_MAX);
  assert_string(needle, "contains: needle", NEEDLE_CHARS_MAX);
  assert(options != null && typeof options === "object", "contains: options must be an object");
  const case_sensitive = options.case_sensitive !== false;
  return normalize(text, case_sensitive).includes(normalize(needle, case_sensitive));
}

/**
 * `mode` is `"all"` (every needle must be present) or `"any"` (at least one).
 * Both modes report the full matched/missing split either way, so the caller
 * can show the student exactly which needles are missing.
 */
export function contains_set(
  text: string,
  needles: Needle[],
  options: MatchOptions & { mode?: "all" | "any" } = {},
): ContainsSetResult {
  assert_string(text, "contains_set: text", OUTPUT_BYTES_MAX);
  assert_array(needles, "contains_set: needles", NEEDLE_COUNT_MAX);
  assert(
    options != null && typeof options === "object",
    "contains_set: options must be an object",
  );
  const mode = options.mode ?? "all";
  assert(
    mode === "all" || mode === "any",
    `contains_set: mode must be "all" or "any", got ${mode}`,
  );
  const case_sensitive = options.case_sensitive !== false;

  const haystack = normalize(text, case_sensitive);
  const matched: string[] = [];
  const missing: string[] = [];
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
 * Line numbers are 1-indexed and ascending. Pointing at exactly where a
 * required or forbidden substring sits is what turns "missing a prompt" into
 * "line 12 is the wrong prompt".
 */
export function find_lines(text: string, needle: string, options: MatchOptions = {}): number[] {
  assert_string(text, "find_lines: text", OUTPUT_BYTES_MAX);
  assert_string(needle, "find_lines: needle", NEEDLE_CHARS_MAX);
  assert(options != null && typeof options === "object", "find_lines: options must be an object");
  const case_sensitive = options.case_sensitive !== false;

  const target = normalize(needle, case_sensitive);
  const lines = split_lines(normalize(text, case_sensitive), "find_lines: text");
  const line_numbers: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes(target)) line_numbers.push(index + 1);
  }

  assert(line_numbers.length <= lines.length, "find_lines: cannot match more lines than exist");
  return line_numbers;
}

/**
 * Drop trailing blank lines, then skip everything before `anchor_prefix`.
 *
 * A captured transcript starts with echoed input prompts; anchoring on the
 * first real output line ("Habit Costs for") lets the diff compare program
 * output against program output.
 */
function trim_to_anchor(lines: string[], anchor_prefix?: string): string[] {
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
 * Rows are aligned by index, with `LINE_ABSENT` standing in on whichever side
 * ran out of lines first.
 */
export function diff_lines(
  text: string,
  expected_lines: string[],
  options: { anchor_prefix?: string } = {},
): DiffResult {
  assert_string(text ?? "", "diff_lines: text", OUTPUT_BYTES_MAX);
  assert_array(expected_lines, "diff_lines: expected_lines", LINE_COUNT_MAX);
  assert(options != null && typeof options === "object", "diff_lines: options must be an object");

  const got = trim_to_anchor(split_lines(text ?? "", "diff_lines: text"), options.anchor_prefix);
  const row_count = Math.max(got.length, expected_lines.length);
  assert(row_count <= LINE_COUNT_MAX, `diff_lines: row_count exceeds ${LINE_COUNT_MAX}`);

  const rows: DiffRow[] = [];
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
