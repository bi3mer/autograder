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
 */

/** In bytes, which for a JS string means UTF-16 code units. */
export const SOURCE_BYTES_MAX = 1024 * 1024;

/** Captured stdout for one test case, in bytes. */
export const OUTPUT_BYTES_MAX = 1024 * 1024;

/** A single needle or expected line, in characters. */
export const NEEDLE_CHARS_MAX = 4096;

export const NEEDLE_COUNT_MAX = 256;

/** Alternative spellings inside one needle. */
export const NEEDLE_ALTERNATIVE_COUNT_MAX = 16;

/** Lines scanned in any text. */
export const LINE_COUNT_MAX = 100_000;

/** Stdin lines fed to one run. */
export const STDIN_LINE_COUNT_MAX = 1024;

export const TEST_CASE_COUNT_MAX = 64;

export const CRITERION_COUNT_MAX = 128;

/** Manual (instructor-graded) rubric rows. */
export const MANUAL_ROW_COUNT_MAX = 64;

/** Lint findings retained from one lint pass. */
export const LINT_FINDING_COUNT_MAX = 10_000;

/** Lint findings listed in a rubric row's detail text, unless overridden. */
export const LINT_FINDING_SHOWN_DEFAULT = 12;

/** Points a single criterion may carry. */
export const POINTS_MAX = 10_000;

export const LINE_LENGTH_CHARS_DEFAULT = 99;

export const LINE_LENGTH_CHARS_MAX = 1000;

/** Filename the submission is compiled under inside Pyodide. */
export const SUBMISSION_FILENAME_DEFAULT = "submission.py";

/**
 * Scratch path flake8 lints inside Pyodide's in-memory filesystem. Purely
 * internal: the bootstrap discards flake8's own filename column, so this
 * never reaches a finding, a rubric row, or a student.
 */
export const LINT_FILENAME = "lint-target.py";

export const FILENAME_CHARS_MAX = 255;

/** Placeholder shown in a diff where one side has no line. */
export const LINE_ABSENT = "∅";
