/**
 * Declarative rubric engine.
 *
 * A rubric is an array of plain criterion objects ("does the source contain
 * this substring", "does the output match these lines", "is it flake8
 * clean"), and {@link grade} runs them against one submission and totals the
 * score. It never runs Python itself: callers pass in results already
 * produced by `py_runner.run()`.
 *
 * @module rubric
 */

import { assert, assert_array, assert_range, assert_string, unreachable } from "./assert.js";
import * as checks from "./checks.js";
import { escape_html } from "./html.js";
import * as py_runner from "./pyrunner.js";
import {
  CRITERION_COUNT_MAX, LINE_COUNT_MAX, LINE_LENGTH_CHARS_DEFAULT, LINE_LENGTH_CHARS_MAX,
  LINT_FINDING_SHOWN_DEFAULT, NEEDLE_CHARS_MAX, NEEDLE_COUNT_MAX, OUTPUT_BYTES_MAX,
  POINTS_MAX, SOURCE_BYTES_MAX, SUBMISSION_FILENAME_DEFAULT, TEST_CASE_COUNT_MAX,
} from "./constants.js";

/**
 * How a criterion is checked.
 *
 * - `code`: substring match against the submitted source.
 * - `output`: substring match against the concatenated stdout.
 * - `code-regex`: `RegExp` match against the source, for when a plain
 *   substring cannot tell a real hit from a false positive.
 * - `output-diff`: per-line diff of each case's stdout against expected.
 * - `flake8`: style findings from flake8, or the regex fallback.
 * - `custom`: the criterion supplies its own `check(context)`.
 *
 * @typedef {"code" | "output" | "code-regex" | "output-diff" | "flake8" | "custom"} CriterionType
 */

/**
 * @typedef {object} DiffCase
 * @property {string} name Case label shown to the student.
 * @property {string[]} expected_lines Required output, one entry per line.
 */

/**
 * @typedef {object} GradeContext
 * @property {string} source The submitted source code.
 * @property {import("./pyrunner.js").RunResult[]} results One run per test case.
 * @property {string} [combined_output] Cached `results` stdout, joined by newlines.
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} [pass] All-or-nothing outcome; ignored when `earned` is set.
 * @property {number} [earned] Points earned, for partial credit.
 * @property {string} [detail] Explanation shown under the rubric row.
 * @property {boolean} [detail_is_html] `detail` is already HTML; do not escape it.
 */

/**
 * One rubric line item.
 *
 * @typedef {object} Criterion
 * @property {string} id Unique key.
 * @property {string} name Row title.
 * @property {number} points Points this criterion is worth.
 * @property {CriterionType} [type="code"] How the criterion is checked.
 * @property {string} [description] Sub-line shown under the title.
 * @property {string} [needle] Single substring to find.
 * @property {import("./checks.js").Needle[]} [needles] Several substrings; an
 *   entry may itself be a list of alternatives.
 * @property {"all" | "any"} [mode="all"] `"all"`: needles are independent and
 *   credit is proportional to how many were found. `"any"`: needles are
 *   alternative spellings of one thing, so finding one is full credit.
 * @property {boolean} [case_sensitive=true] Compare with case intact.
 * @property {RegExp} [regex] Pattern for `code-regex`.
 * @property {string} [filename] Filename flake8 reports on.
 * @property {number} [max_line_length_chars=99] flake8 line-length ceiling.
 * @property {boolean} [partial=false] flake8 scoring: `false` means clean is
 *   full points and anything else is zero; `true` deducts one point per finding.
 * @property {number} [max_findings_shown=12] flake8 findings listed in the detail.
 * @property {DiffCase[]} [cases] Expected output per case, for `output-diff`,
 *   aligned by index with `context.results`.
 * @property {string} [anchor_prefix] Skip output lines before this prefix.
 * @property {number} [points_per_case] Defaults to `points / cases.length`.
 * @property {(context: GradeContext) => CheckResult | Promise<CheckResult>} [check]
 *   Checker for `custom`.
 */

/**
 * @typedef {object} GradedItem
 * @property {string} id Criterion key, copied through.
 * @property {string} name Row title.
 * @property {string} description Sub-line under the title.
 * @property {number} points Points available.
 * @property {number} earned Points awarded, clamped to `[0, points]`.
 * @property {boolean} pass Whether full points were earned.
 * @property {string} detail Explanation for the student.
 * @property {boolean} detail_is_html Whether `detail` is pre-rendered HTML.
 */

/**
 * @typedef {object} GradeReport
 * @property {GradedItem[]} items One entry per criterion, in rubric order.
 * @property {number} total Sum of `earned`, rounded to two decimals.
 * @property {number} max Sum of `points` across the rubric.
 */

/**
 * Round points to two decimals.
 *
 * Scores are money-like: 6.666… points must display as 6.67, and a total
 * must not drift by a stray cent.
 *
 * @param {number} points Unrounded points.
 * @returns {number} `points`, rounded to two decimals.
 */
function round_points(points) {
  assert(
    typeof points === "number" && Number.isFinite(points),
    "round_points: points must be finite",
  );
  const rounded = Math.round(points * 100) / 100;
  assert(
    Math.abs(rounded - points) <= 0.005,
    "round_points: rounding must move by less than a cent",
  );
  return rounded;
}

/**
 * Pick the text a substring criterion searches.
 *
 * @param {Criterion} criterion Criterion being checked.
 * @param {GradeContext} context Submission under grading.
 * @returns {string} Source for `code`, combined stdout for `output`.
 */
function text_for(criterion, context) {
  assert(criterion != null, "text_for: criterion must not be null");
  assert(context != null, "text_for: context must not be null");
  if (criterion.type === "code" || criterion.type === undefined) return context.source ?? "";
  if (criterion.type === "output") return context.combined_output ?? "";
  return unreachable(`type "${criterion.type}" has no default text source; use type "custom"`);
}

/**
 * Quote a list of needle labels for a detail line.
 *
 * @param {string[]} labels Needle labels.
 * @returns {string} Comma-separated, each in double quotes.
 */
function quote_labels(labels) {
  assert(Array.isArray(labels), "quote_labels: labels must be an array");
  assert(labels.length <= NEEDLE_COUNT_MAX, `quote_labels: at most ${NEEDLE_COUNT_MAX} labels`);
  return labels.map((label) => `"${label}"`).join(", ");
}

/**
 * Score a substring criterion against `text`.
 *
 * @param {string} text Haystack chosen by {@link text_for}.
 * @param {Criterion} criterion Criterion carrying `needle` or `needles`.
 * @returns {CheckResult} Pass or partial credit, plus what was found.
 */
function match_text(text, criterion) {
  assert_string(text, `criterion "${criterion.id}": text`, OUTPUT_BYTES_MAX);
  const options = { case_sensitive: criterion.case_sensitive !== false };

  if (criterion.needle != null) {
    assert_string(criterion.needle, `criterion "${criterion.id}": needle`, NEEDLE_CHARS_MAX);
    const found = checks.contains(text, criterion.needle, options);
    const detail = found ? `Found "${criterion.needle}".` : `Missing "${criterion.needle}".`;
    return { pass: found, detail };
  }

  assert(criterion.needles != null, `criterion "${criterion.id}" needs a "needle" or "needles"`);
  const needles = assert_array(
    criterion.needles, `criterion "${criterion.id}": needles`, NEEDLE_COUNT_MAX,
  );
  assert(needles.length > 0, `criterion "${criterion.id}": needles must not be empty`);
  const mode = criterion.mode ?? "all";
  const { pass, matched, missing } = checks.contains_set(text, needles, { ...options, mode });

  const parts = [];
  if (matched.length > 0) parts.push(`found: ${quote_labels(matched)}`);
  if (missing.length > 0) parts.push(`missing: ${quote_labels(missing)}`);
  const detail = parts.join("; ");

  // Under "all" the needles are independent requirements, so credit is
  // proportional to how many were found rather than all-or-nothing. Under
  // "any" they are spellings of one requirement, so one hit earns it all.
  if (mode === "any") return { pass, detail };
  const earned = round_points(criterion.points * (matched.length / needles.length));
  return { earned, detail };
}

/**
 * Is `value` a regular expression?
 *
 * `instanceof RegExp` is not enough: a page's inline script and the bundle can
 * live in different realms (an iframe, or a `vm` context in a test harness),
 * and each realm has its own `RegExp` constructor. The brand check works
 * across realms, because the tag travels with the object rather than with the
 * constructor that made it.
 *
 * @param {unknown} value Candidate pattern.
 * @returns {value is RegExp} True when `value` is a RegExp from any realm.
 */
function is_regexp(value) {
  const tag = Object.prototype.toString.call(value);
  assert(typeof tag === "string" && tag.length > 0, "is_regexp: brand check must yield a tag");
  return tag === "[object RegExp]";
}

/**
 * Score a `code-regex` criterion.
 *
 * @param {Criterion} criterion Criterion carrying `regex`.
 * @param {GradeContext} context Submission under grading.
 * @returns {CheckResult} Pass or fail, naming the pattern either way.
 */
function code_regex_check(criterion, context) {
  assert(
    is_regexp(criterion.regex),
    `criterion "${criterion.id}": type "code-regex" needs a RegExp`,
  );
  assert(
    typeof context.source === "string",
    `criterion "${criterion.id}": context.source must be a string`,
  );
  // A "g" or "y" regex carries lastIndex across calls, and the same criterion
  // object is reused for every submission graded in this page session. Without
  // the reset, one submission's match could make the next one spuriously fail.
  criterion.regex.lastIndex = 0;
  const matched = criterion.regex.test(context.source);
  const detail = matched ? `Matched ${criterion.regex}.` : `No match for ${criterion.regex}.`;
  return { pass: matched, detail };
}

/**
 * Collect style findings, preferring flake8 and falling back to regexes.
 *
 * @param {string} source Submission source.
 * @param {string} filename Filename flake8 reports on.
 * @param {number} max_line_length_chars Line-length ceiling.
 * @returns {Promise<{ findings: string[], engine: string }>} Findings plus the
 *   engine that produced them, so the row can say which one ran.
 */
async function collect_findings(source, filename, max_line_length_chars) {
  assert_string(source, "collect_findings: source", SOURCE_BYTES_MAX);
  assert(filename.length > 0, "collect_findings: filename must not be empty");
  if (!py_runner.is_flake8_ready()) {
    const reason = py_runner.flake8_failure_reason();
    return {
      findings: py_runner.regex_lint(source, { max_line_length_chars }),
      engine: `built-in (flake8 unavailable${reason ? `: ${reason}` : ""})`,
    };
  }
  try {
    const findings = await py_runner.lint(source, { filename, max_line_length_chars });
    return { findings, engine: "flake8" };
  } catch (error) {
    // flake8 loaded but this run failed. Fall back rather than zeroing the
    // student, and name the reason so the failure is visible, not silent.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      findings: py_runner.regex_lint(source, { max_line_length_chars }),
      engine: `built-in (flake8 errored: ${reason})`,
    };
  }
}

/**
 * Score a `flake8` criterion.
 *
 * @param {Criterion} criterion Criterion carrying the flake8 options.
 * @param {GradeContext} context Submission under grading.
 * @returns {Promise<CheckResult>} Points earned plus the findings list.
 */
async function flake8_check(criterion, context) {
  assert(criterion.type === "flake8", `criterion "${criterion.id}": expected type "flake8"`);
  assert(
    typeof context.source === "string",
    `criterion "${criterion.id}": context.source must be a string`,
  );
  const filename = criterion.filename ?? SUBMISSION_FILENAME_DEFAULT;
  const max_line_length_chars = assert_range(
    criterion.max_line_length_chars ?? LINE_LENGTH_CHARS_DEFAULT,
    `criterion "${criterion.id}": max_line_length_chars`, 1, LINE_LENGTH_CHARS_MAX,
  );
  const max_findings_shown = assert_range(
    criterion.max_findings_shown ?? LINT_FINDING_SHOWN_DEFAULT,
    `criterion "${criterion.id}": max_findings_shown`, 1, 1000,
  );

  const { findings, engine } = await collect_findings(
    context.source, filename, max_line_length_chars,
  );
  const clean = findings.length === 0;
  const earned = criterion.partial
    ? Math.max(0, criterion.points - findings.length)
    : (clean ? criterion.points : 0);
  const detail = clean
    ? `Clean — no ${engine} findings.`
    : `${engine}: ${findings.length} finding(s).\n` +
      findings.slice(0, max_findings_shown).join("\n");

  assert(
    earned >= 0 && earned <= criterion.points,
    `criterion "${criterion.id}": earned must fit the points`,
  );
  return { earned, pass: clean, detail };
}

/**
 * Render one case's diff as collapsible HTML.
 *
 * @param {import("./checks.js").DiffRow[]} rows Aligned line pairs.
 * @returns {string} A `<details>` block, or `""` when every row matched.
 */
function render_diff_html(rows) {
  assert(Array.isArray(rows), "render_diff_html: rows must be an array");
  assert(rows.length <= LINE_COUNT_MAX, `render_diff_html: at most ${LINE_COUNT_MAX} rows`);
  const body = rows.map((row) => (row.ok
    ? `  ${escape_html(row.got)}`
    : `<span class="miss">- expected: ${escape_html(row.expected)}</span>\n` +
      `<span class="miss">+ got:      ${escape_html(row.got)}</span>`
  )).join("\n");
  return '<details class="diff"><summary>show diff</summary>' +
    `<pre class="io">${body}</pre></details>`;
}

/**
 * Score an `output-diff` criterion.
 *
 * Credit within a case is proportional to the fraction of lines that match,
 * so a submission with 9 of 15 lines right earns 60% of that case rather
 * than zero. Points accumulate at full precision and round once at the end:
 * rounding each case first and summing can overshoot the total (three cases
 * at 6.666… round to 6.67 each, which sums to 20.01, not 20).
 *
 * @param {Criterion} criterion Criterion carrying `cases`.
 * @param {GradeContext} context Submission under grading.
 * @returns {CheckResult} Points earned plus per-case HTML detail.
 */
function output_diff_check(criterion, context) {
  const cases = assert_array(
    criterion.cases ?? [], `criterion "${criterion.id}": cases`, TEST_CASE_COUNT_MAX,
  );
  const results = assert_array(
    context.results ?? [], `criterion "${criterion.id}": results`, TEST_CASE_COUNT_MAX,
  );
  const points_per_case = criterion.points_per_case ??
    (cases.length > 0 ? criterion.points / cases.length : 0);
  assert(points_per_case >= 0, `criterion "${criterion.id}": points_per_case must not be negative`);

  let earned = 0;
  const sections = [];
  for (let index = 0; index < results.length; index++) {
    const test_case = cases[index] ?? { name: `case ${index + 1}`, expected_lines: [] };
    const diff = checks.diff_lines(results[index].out, test_case.expected_lines, {
      anchor_prefix: criterion.anchor_prefix,
    });
    const row_count = Math.max(diff.rows.length, 1);
    const matched_count = diff.rows.filter((row) => row.ok).length;
    const matched_fraction = matched_count / row_count;
    const case_points = points_per_case * matched_fraction;
    earned += case_points;

    const label = round_points(case_points);
    const status = diff.all_match
      ? `<span class="good">✓ ${escape_html(test_case.name)} — exact match (+${label})</span>`
      : `<span class="bad">${matched_fraction > 0 ? "±" : "✗"} ${escape_html(test_case.name)} — ` +
        `${Math.round(matched_fraction * 100)}% of lines match ` +
        `(+${label} / ${round_points(points_per_case)})</span>`;
    sections.push(status + (diff.all_match ? "" : render_diff_html(diff.rows)));
  }

  assert(sections.length === results.length, `criterion "${criterion.id}": one section per result`);
  return { earned: round_points(earned), detail: sections.join("<br>"), detail_is_html: true };
}

/**
 * Validate one criterion before it is checked.
 *
 * Rubrics are hand-written per assignment, so a typo here is a grading bug
 * that would otherwise surface as a silently wrong score.
 *
 * @param {Criterion} criterion Criterion to validate.
 * @param {number} index Position in the rubric, for failure messages.
 * @returns {void}
 */
function check_criterion(criterion, index) {
  assert(
    criterion != null && typeof criterion === "object",
    `criteria[${index}] must be an object`,
  );
  assert_string(criterion.id, `criteria[${index}].id`, NEEDLE_CHARS_MAX);
  assert(criterion.id.length > 0, `criteria[${index}].id must not be empty`);
  assert_string(criterion.name, `criterion "${criterion.id}": name`, NEEDLE_CHARS_MAX);
  assert_range(criterion.points, `criterion "${criterion.id}": points`, 0, POINTS_MAX);
  const mode = criterion.mode ?? "all";
  assert(
    mode === "all" || mode === "any",
    `criterion "${criterion.id}": mode must be "all" or "any"`,
  );
}

/**
 * Dispatch one criterion to its checker.
 *
 * @param {Criterion} criterion Criterion to check.
 * @param {GradeContext} context Submission under grading.
 * @returns {Promise<CheckResult>} Whatever the checker reported.
 */
async function run_check(criterion, context) {
  assert(criterion != null, "run_check: criterion must not be null");
  assert(context != null, "run_check: context must not be null");
  const type = criterion.type ?? "code";
  if (type === "flake8") return flake8_check(criterion, context);
  if (type === "code-regex") return code_regex_check(criterion, context);
  if (type === "output-diff") return output_diff_check(criterion, context);
  if (type === "custom") {
    assert(
      typeof criterion.check === "function",
      `criterion "${criterion.id}": type "custom" needs a check()`,
    );
    return (await criterion.check(context)) ?? {};
  }
  return match_text(text_for(criterion, context), criterion);
}

/**
 * Turn one checker result into a graded rubric item.
 *
 * Clamping and rounding happen here, the single point every check type's
 * score passes through, so no checker has to guard against float drift
 * pushing `earned` past `points`.
 *
 * @param {Criterion} criterion Criterion that was checked.
 * @param {CheckResult} result What the checker reported.
 * @returns {GradedItem} The scored row.
 */
function score_item(criterion, result) {
  assert(criterion != null, "score_item: criterion must not be null");
  assert(
    result != null && typeof result === "object",
    `criterion "${criterion.id}": check must return an object`,
  );
  const raw_earned = result.earned != null ? result.earned : (result.pass ? criterion.points : 0);
  assert(Number.isFinite(raw_earned), `criterion "${criterion.id}": earned must be finite`);
  const earned = round_points(Math.min(Math.max(raw_earned, 0), criterion.points));

  assert(
    earned >= 0 && earned <= criterion.points,
    `criterion "${criterion.id}": earned must fit the points`,
  );
  return {
    id: criterion.id,
    name: criterion.name,
    description: criterion.description ?? "",
    points: criterion.points,
    earned,
    pass: earned >= criterion.points,
    detail: result.detail ?? "",
    detail_is_html: result.detail_is_html === true,
  };
}

/**
 * Grade a rubric against one submission.
 *
 * Criteria run one at a time rather than concurrently: flake8 checks reach
 * into Pyodide, which is a single shared interpreter, and overlapping calls
 * would interleave and clobber each other's state.
 *
 * A checker that throws costs its criterion zero points and reports the
 * error in the row, so one broken criterion cannot take down the whole run.
 *
 * @param {Criterion[]} criteria The rubric, in display order.
 * @param {GradeContext} context Submission source plus its run results.
 * @returns {Promise<GradeReport>} Scored items and the totals.
 */
export async function grade(criteria, context) {
  assert_array(criteria, "grade: criteria", CRITERION_COUNT_MAX);
  assert(context != null && typeof context === "object", "grade: context must be an object");
  assert_string(context.source ?? "", "grade: context.source", SOURCE_BYTES_MAX);
  const results = assert_array(
    context.results ?? [], "grade: context.results", TEST_CASE_COUNT_MAX,
  );

  const full_context = {
    ...context,
    combined_output: context.combined_output ??
      results.map((result) => result.out ?? "").join("\n"),
  };

  /** @type {GradedItem[]} */
  const items = [];
  for (let index = 0; index < criteria.length; index++) {
    const criterion = criteria[index];
    check_criterion(criterion, index);
    /** @type {CheckResult} */
    let result;
    try {
      result = await run_check(criterion, full_context);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result = { pass: false, detail: `Check error: ${reason}` };
    }
    items.push(score_item(criterion, result));
  }

  const total = round_points(items.reduce((sum, item) => sum + item.earned, 0));
  const max = criteria.reduce((sum, criterion) => sum + criterion.points, 0);
  assert(items.length === criteria.length, "grade: one item per criterion");
  assert(total <= max + 0.01, "grade: total must not exceed the rubric maximum");
  return { items, total, max };
}
