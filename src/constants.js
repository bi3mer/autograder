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

/**
 * A handout, in bytes. An assignment statement is a page or two of prose; the
 * ceiling sits far above that, so it fires on a wrong file rather than on real
 * work.
 */
export const MARKDOWN_BYTES_MAX = 256 * 1024;

export const MARKDOWN_LINE_COUNT_MAX = 10_000;

/**
 * How deep lists and blockquotes may nest. Each level recurses through the
 * block scanner, so this is what bounds that recursion.
 */
export const MARKDOWN_LIST_DEPTH_MAX = 6;

/** Backtick spans lifted out of one text run before the other inline rules. */
export const MARKDOWN_CODE_SPAN_COUNT_MAX = 4096;

export const MARKDOWN_TABLE_COLUMN_COUNT_MAX = 16;

/** Tags counted by the output allowlist check. */
export const MARKDOWN_TAG_COUNT_MAX = 20_000;

/** A fence's info string, e.g. the `python` in ```python. */
export const MARKDOWN_INFO_CHARS_MAX = 32;

/** A handout's URL, as written in an assignment page's config. */
export const HANDOUT_HREF_CHARS_MAX = 2048;

/**
 * How long one run may take before the watchdog stops it. Pyodide runs on the
 * page's only thread, so a loop that never ends freezes the tab with no way
 * out but a reload. A first-year program finishes in milliseconds; this sits
 * far above that and far below a student's patience.
 */
export const RUN_TIMEOUT_MS = 5000;

/**
 * Trace events between clock checks in the watchdog. Reading the clock on
 * every line costs more than the check saves, and a `while True: pass` loop
 * turns over roughly sixteen million events per second, so sampling this
 * often still stops it within a few milliseconds of the deadline.
 */
export const TRACE_CHECK_INTERVAL_EVENTS = 2000;

/** A draft held in localStorage, in characters. */
export const DRAFT_BYTES_MAX = 256 * 1024;

/** Lines the editor's gutter will number. */
export const EDITOR_LINE_COUNT_MAX = 10_000;

/** Debounce before a draft is written to localStorage. */
export const DRAFT_SAVE_DELAY_MS = 400;

/** Ceiling a page may raise `RUN_TIMEOUT_MS` to for one run. */
export const RUN_TIMEOUT_MS_MAX = 120_000;

/** Spaces one indent step inserts in the editor. Python's own convention. */
export const EDITOR_INDENT_SPACES = 4;

/**
 * Source the editor's highlighter will scan. Past this it paints the buffer
 * one colour rather than tokenizing it on every keystroke: an assignment is a
 * page of Python, and a paste large enough to reach this is not one.
 */
export const HIGHLIGHT_BYTES_MAX = 128 * 1024;

/**
 * Tokens from one highlight pass. Every token consumes at least one character,
 * so `HIGHLIGHT_BYTES_MAX` already bounds this; the assertion is what proves
 * the scanner never loops without consuming.
 */
export const HIGHLIGHT_TOKEN_COUNT_MAX = HIGHLIGHT_BYTES_MAX;
