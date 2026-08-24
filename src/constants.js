/**
 * Hard limits, in one place.
 *
 * TigerBeetle puts an explicit bound on every resource so that no loop is
 * unbounded and no input can grow without a stated ceiling. These numbers
 * are the grader's ceilings: each is asserted at the boundary where the
 * data enters, so every loop downstream runs against a known maximum.
 *
 * Sizing rationale: a first-year Python assignment is a few dozen lines and
 * prints a few dozen lines. The limits below sit two orders of magnitude
 * above that, so they never fire on real work, and fire immediately on a
 * pasted binary, a runaway `while True` print loop, or a wrong file.
 *
 * @module constants
 */

/** Largest accepted submission, in bytes (UTF-16 code units). */
export const SOURCE_BYTES_MAX = 1024 * 1024;

/** Largest accepted captured stdout for one test case, in bytes. */
export const OUTPUT_BYTES_MAX = 1024 * 1024;

/** Largest accepted single needle or expected line, in characters. */
export const NEEDLE_CHARS_MAX = 4096;

/** Largest accepted number of needles in one criterion. */
export const NEEDLE_COUNT_MAX = 256;

/** Largest accepted number of alternatives inside one needle. */
export const NEEDLE_ALTERNATIVE_COUNT_MAX = 16;

/** Largest accepted number of lines scanned in any text. */
export const LINE_COUNT_MAX = 100_000;

/** Largest accepted number of stdin lines fed to one run. */
export const STDIN_LINE_COUNT_MAX = 1024;

/** Largest accepted number of test cases per assignment. */
export const TEST_CASE_COUNT_MAX = 64;

/** Largest accepted number of rubric criteria per assignment. */
export const CRITERION_COUNT_MAX = 128;

/** Largest accepted number of manual (instructor-graded) rows. */
export const MANUAL_ROW_COUNT_MAX = 64;

/** Largest accepted number of lint findings retained from one lint pass. */
export const LINT_FINDING_COUNT_MAX = 10_000;

/** Lint findings listed in a rubric row's detail text, unless overridden. */
export const LINT_FINDING_SHOWN_DEFAULT = 12;

/** Largest points value a single criterion may carry. */
export const POINTS_MAX = 10_000;

/** Default flake8 line-length ceiling, in characters. */
export const LINE_LENGTH_CHARS_DEFAULT = 99;

/** Largest configurable flake8 line-length ceiling, in characters. */
export const LINE_LENGTH_CHARS_MAX = 1000;

/** Default filename the submission is compiled under inside Pyodide. */
export const SUBMISSION_FILENAME_DEFAULT = "submission.py";

/** Largest accepted submission filename, in characters. */
export const FILENAME_CHARS_MAX = 255;

/** Placeholder shown in a diff where one side has no line. */
export const LINE_ABSENT = "∅";
