/**
 * Page glue: file drop, grading run, rubric rendering.
 *
 * This is the only module that touches the DOM. An assignment page supplies
 * its test cases and rubric through {@link init} and reuses the shared page
 * skeleton (the element ids in `ELEMENT_IDS_DEFAULT`) and `css/a1.css`.
 * Nothing here knows about any specific assignment.
 *
 * @module grader_app
 */

import { assert, assert_array, assert_range, assert_string } from "./assert.js";
import { escape_html } from "./html.js";
import { default_styles_href, ensure_stylesheet, render_skeleton } from "./page.js";
import * as py_runner from "./pyrunner.js";
import * as rubric from "./rubric.js";
import {
  CRITERION_COUNT_MAX, FILENAME_CHARS_MAX, MANUAL_ROW_COUNT_MAX, NEEDLE_CHARS_MAX,
  POINTS_MAX, SOURCE_BYTES_MAX, STDIN_LINE_COUNT_MAX, TEST_CASE_COUNT_MAX,
} from "./constants.js";

/**
 * @typedef {object} TestCase
 * @property {string} name Case label shown to the student.
 * @property {string[]} stdin_lines Values fed to successive `input()` calls.
 * @property {string[]} expected_lines Required output, one entry per line.
 */

/**
 * A rubric line the tool cannot check, shown for completeness and excluded
 * from the automatic total (variable naming, comment quality, and the like).
 *
 * @typedef {object} ManualRow
 * @property {string} name Row title.
 * @property {string} description Sub-line under the title.
 * @property {string} score Text shown in the score column, e.g. `"manual / 5"`.
 * @property {string} [detail] Explanation shown under the description.
 */

/**
 * @typedef {object} RubricRow
 * @property {string} mark Glyph in the left column: `✓`, `±`, `✗`, or `—`.
 * @property {"pass" | "fail" | "pending"} state CSS state class for the mark.
 * @property {string} name Row title.
 * @property {string} description Sub-line under the title.
 * @property {string} score Text shown in the score column.
 * @property {string} [detail] Explanation, already HTML-escaped where needed.
 */

/**
 * @callback BuildCriteria
 * @param {import("./pyrunner.js").RunResult[]} results One run per test case.
 * @returns {import("./rubric.js").Criterion[]} The rubric, in display order.
 */

/**
 * @typedef {object} GraderConfig
 * @property {string} filename Expected submission filename, e.g. `"program1.py"`.
 * @property {TestCase[]} cases Test cases, run in order. `cases[0].stdin_lines`
 *   also drives the syntax-error probe that gates the whole run.
 * @property {BuildCriteria} build_criteria Builds the rubric from the results.
 * @property {number} max_auto_points Denominator shown beside the total.
 * @property {ManualRow[]} [manual_rows] Instructor-graded rows, not totalled.
 * @property {Partial<ElementIds>} [element_ids] Element id overrides.
 * @property {string} [title] Page heading; defaults to `document.title`.
 * @property {string} [subtitle] Line under the heading, e.g. the rubric total.
 * @property {string} [headline_label] Caption under the score; defaults to
 *   `"/ <max_auto_points> auto"`.
 * @property {string} [drop_prompt] Bold line in the drop zone; defaults to
 *   `"Drop <filename> here"`.
 * @property {string} [drop_hint] Small line under the drop prompt.
 * @property {string} [accept=".py"] `accept` attribute for the file input.
 * @property {string} [footer] Footer text; omitted when absent.
 * @property {HTMLElement | string} [mount] Element (or selector) the skeleton
 *   renders into; defaults to `document.body`.
 * @property {string | false} [styles_href] Stylesheet to add, `false` to add
 *   none. Defaults to `css/a1.css` beside the loaded bundle.
 * @property {string} [submit_to="BrightSpace"] Where the student uploads the
 *   file, named in the wrong-filename warning.
 */

/**
 * @typedef {object} ElementIds
 * @property {string} status Status line beside the grade button.
 * @property {string} run Grade button.
 * @property {string} drop Drop zone label.
 * @property {string} file Hidden file input.
 * @property {string} filename Chosen filename readout.
 * @property {string} rubric Container the rubric rows render into.
 * @property {string} zero Banner shown when a syntax error zeroes the score.
 * @property {string} headline Large score readout in the header.
 * @property {string} summary_box Wrapper around the summary textarea.
 * @property {string} summary Textarea holding the copy-paste summary.
 * @property {string} copy Copy-to-clipboard button.
 * @property {string} copy_status Status line beside the copy button.
 */

/**
 * @typedef {object} Elements
 * @property {HTMLElement} status Status line beside the grade button.
 * @property {HTMLButtonElement} run Grade button.
 * @property {HTMLElement} drop Drop zone label.
 * @property {HTMLInputElement} file Hidden file input.
 * @property {HTMLElement} filename Chosen filename readout.
 * @property {HTMLElement} rubric Container the rubric rows render into.
 * @property {HTMLElement} zero Banner shown when a syntax error zeroes the score.
 * @property {HTMLElement} headline Large score readout in the header.
 * @property {HTMLElement} summary_box Wrapper around the summary textarea.
 * @property {HTMLTextAreaElement} summary Textarea holding the summary.
 * @property {HTMLElement} copy Copy-to-clipboard button.
 * @property {HTMLElement} copy_status Status line beside the copy button.
 */

/**
 * Everything one wired-up page owns. Passing this explicitly, rather than
 * closing over a pile of `let`s, keeps every handler a top-level function
 * small enough to read in one screen.
 *
 * @typedef {object} GraderSession
 * @property {GraderConfig} config Assignment configuration.
 * @property {Elements} elements Resolved page elements.
 * @property {ManualRow[]} manual_rows Instructor-graded rows.
 * @property {string | null} source Loaded submission, `null` until one is chosen.
 * @property {boolean} grading True while a run is in flight, to reject re-entry.
 */

/** @type {ElementIds} Element ids the shared page skeleton provides. */
const ELEMENT_IDS_DEFAULT = {
  status: "status",
  run: "run",
  drop: "drop",
  file: "file",
  filename: "filename",
  rubric: "rubric",
  zero: "zero",
  headline: "headline",
  summary_box: "summarybox",
  summary: "summary",
  copy: "copy",
  copy_status: "copystatus",
};

/** Message shown when a submission does not compile. */
const SYNTAX_ZERO_MESSAGE = "Syntax error — score is zero per assignment policy.";

/** Prefix `py_runner` puts on a compile failure. */
const SYNTAX_PREFIX = "SYNTAX:";

/**
 * Read an error's message without assuming it is an `Error`.
 *
 * @param {unknown} error Whatever was thrown or rejected.
 * @returns {string} A human-readable reason.
 */
function reason_for(error) {
  const reason = error instanceof Error ? error.message : String(error);
  assert(typeof reason === "string", "reason_for: reason must be a string");
  return reason;
}

/**
 * Look up a required element, failing loudly when the page is missing it.
 *
 * A missing id is a page bug, not a student problem, and it is far cheaper
 * to catch here than as a `null` dereference three callbacks later.
 *
 * @param {string} id Element id to resolve.
 * @returns {HTMLElement} The element.
 */
function require_element(id) {
  assert(typeof id === "string" && id.length > 0, "require_element: id must be non-empty");
  const element = document.getElementById(id);
  assert(element != null, `page is missing an element with id "${id}"`);
  return /** @type {HTMLElement} */ (element);
}

/**
 * Resolve every element the page must provide.
 *
 * @param {ElementIds} ids Element ids, after applying any overrides.
 * @returns {Elements} The resolved elements.
 */
function resolve_elements(ids) {
  assert(ids != null && typeof ids === "object", "resolve_elements: ids must be an object");
  const elements = {
    status: require_element(ids.status),
    run: /** @type {HTMLButtonElement} */ (require_element(ids.run)),
    drop: require_element(ids.drop),
    file: /** @type {HTMLInputElement} */ (require_element(ids.file)),
    filename: require_element(ids.filename),
    rubric: require_element(ids.rubric),
    zero: require_element(ids.zero),
    headline: require_element(ids.headline),
    summary_box: require_element(ids.summary_box),
    summary: /** @type {HTMLTextAreaElement} */ (require_element(ids.summary)),
    copy: require_element(ids.copy),
    copy_status: require_element(ids.copy_status),
  };
  assert(
    Object.keys(elements).length === Object.keys(ids).length,
    "resolve_elements: one element per id",
  );
  return elements;
}

/**
 * Validate the configuration an assignment page passes in.
 *
 * @param {GraderConfig} config Configuration to validate.
 * @returns {void}
 */
function check_config(config) {
  assert(config != null && typeof config === "object", "init: config must be an object");
  assert_string(config.filename, "config.filename", FILENAME_CHARS_MAX);
  assert(config.filename.length > 0, "config.filename must not be empty");
  const cases = assert_array(config.cases, "config.cases", TEST_CASE_COUNT_MAX);
  assert(cases.length > 0, "config.cases must contain at least one case");
  for (let index = 0; index < cases.length; index++) {
    const test_case = cases[index];
    assert_string(test_case.name, `config.cases[${index}].name`, NEEDLE_CHARS_MAX);
    assert_array(test_case.stdin_lines, `config.cases[${index}].stdin_lines`, STDIN_LINE_COUNT_MAX);
    assert_array(
      test_case.expected_lines,
      `config.cases[${index}].expected_lines`, STDIN_LINE_COUNT_MAX,
    );
  }
  assert(typeof config.build_criteria === "function", "config.build_criteria must be a function");
  assert_range(config.max_auto_points, "config.max_auto_points", 0, POINTS_MAX);
  assert_array(config.manual_rows ?? [], "config.manual_rows", MANUAL_ROW_COUNT_MAX);
}

/**
 * Render one rubric row.
 *
 * @param {RubricRow} row Row to render.
 * @returns {string} HTML for the row.
 */
function row_html(row) {
  assert(row != null, "row_html: row must not be null");
  assert(
    row.state === "pass" || row.state === "fail" || row.state === "pending",
    `row_html: unknown state ${row.state}`,
  );
  const detail_html = row.detail ? `<div class="r-detail">${row.detail}</div>` : "";
  return `
      <div class="rubric-row">
        <div class="mark ${row.state}">${escape_html(row.mark)}</div>
        <div>
          <div class="r-name">${escape_html(row.name)}</div>
          <div class="r-desc">${escape_html(row.description)}</div>
          ${detail_html}
        </div>
        <div class="r-score">${escape_html(row.score)}</div>
      </div>`;
}

/**
 * Convert a graded rubric item into a display row.
 *
 * @param {import("./rubric.js").GradedItem} item Graded criterion.
 * @returns {RubricRow} The row to render.
 */
function row_for_item(item) {
  assert(item != null, "row_for_item: item must not be null");
  assert(item.earned <= item.points, `row_for_item: "${item.id}" earned more than its points`);
  const partial = !item.pass && item.earned > 0;
  return {
    mark: item.pass ? "✓" : (partial ? "±" : "✗"),
    state: item.pass ? "pass" : (partial ? "pending" : "fail"),
    name: item.name,
    description: item.description,
    score: `${item.earned} / ${item.points}`,
    detail: item.detail_is_html ? item.detail : escape_html(item.detail),
  };
}

/**
 * Build the gate row that reports whether the submission compiled.
 *
 * @param {import("./pyrunner.js").RunResult} probe Result of the syntax probe.
 * @returns {RubricRow} The gate row.
 */
function row_for_syntax(probe) {
  assert(probe != null, "row_for_syntax: probe must not be null");
  const failed = probe.err.startsWith(SYNTAX_PREFIX);
  const message = escape_html(probe.err.slice(SYNTAX_PREFIX.length));
  return {
    mark: failed ? "✗" : "✓",
    state: failed ? "fail" : "pass",
    name: "Compiles without syntax errors",
    description: "Gate: a syntax error forces a total score of zero.",
    score: failed ? "ZERO" : "OK",
    detail: failed ? `<span class="bad">${message}</span>` : "",
  };
}

/**
 * Build the plain-text summary a student pastes into their submission.
 *
 * @param {object} args Summary inputs.
 * @param {string} args.filename Submitted filename.
 * @param {number} args.total_points Points earned.
 * @param {number} args.max_auto_points Points available automatically.
 * @param {boolean} args.has_syntax_error Whether the submission failed to compile.
 * @param {RubricRow[]} rows Rendered rubric rows, in display order.
 * @returns {string} The summary text.
 */
function summary_text(args, rows) {
  assert(args != null, "summary_text: args must not be null");
  assert(Array.isArray(rows), "summary_text: rows must be an array");
  const lines = [`${args.filename} — Autograder Summary`];
  lines.push(args.has_syntax_error
    ? "Score: 0 (syntax error — see below)"
    : `Score: ${args.total_points} / ${args.max_auto_points}`);
  lines.push("");
  for (let index = 0; index < rows.length; index++) {
    lines.push(`- ${rows[index].name}: ${rows[index].score}`);
  }
  assert(lines.length === rows.length + 3, "summary_text: one line per row plus the header");
  return lines.join("\n");
}

/**
 * Read a dropped or chosen file as text.
 *
 * @param {File} file File the student selected.
 * @returns {Promise<string>} The file's text.
 * @throws {Error} If the browser cannot read the file.
 */
function read_file_text(file) {
  assert(file != null, "read_file_text: file must not be null");
  assert(typeof file.name === "string", "read_file_text: file must carry a name");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`could not read ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Clear the previous run's output.
 *
 * @param {GraderSession} session Page session.
 * @returns {void}
 */
function reset_output(session) {
  assert(session != null, "reset_output: session must not be null");
  const { elements } = session;
  elements.rubric.innerHTML = "";
  elements.zero.style.display = "none";
  elements.summary_box.style.display = "none";
  elements.summary.value = "";
  elements.headline.textContent = "—";
  assert(elements.rubric.innerHTML === "", "reset_output: rubric must end empty");
}

/**
 * Load a submission and enable grading.
 *
 * A file the browser cannot read, or one too large to be a Python program,
 * leaves the previous submission in place and says why on the status line.
 *
 * @param {GraderSession} session Page session.
 * @param {File | null | undefined} file File the student chose or dropped.
 * @returns {Promise<void>} Resolves once the file is loaded or rejected.
 */
async function accept_file(session, file) {
  assert(session != null, "accept_file: session must not be null");
  if (file == null) return;
  const { config, elements } = session;

  let text;
  try {
    text = await read_file_text(file);
  } catch (error) {
    elements.status.textContent = `Could not read ${file.name}: ${reason_for(error)}`;
    return;
  }
  if (text.length > SOURCE_BYTES_MAX) {
    elements.status.textContent = `${file.name} is too large to grade (${text.length} bytes).`;
    return;
  }

  session.source = text;
  const expected = file.name === config.filename;
  const submit_to = config.submit_to ?? "BrightSpace";
  elements.filename.textContent = file.name +
    (expected ? "  ✓" : `  ⚠ Submit this file as ${config.filename} on ${submit_to}`);
  reset_output(session);
  elements.run.disabled = !py_runner.is_ready();
  elements.status.textContent = "File loaded. Ready to grade.";
}

/**
 * Run every test case and score the rubric.
 *
 * @param {GraderSession} session Page session, with a submission loaded.
 * @returns {Promise<import("./rubric.js").GradeReport>} The scored rubric.
 */
async function score_submission(session) {
  assert(session.source != null, "score_submission: no submission loaded");
  const { config } = session;

  /** @type {import("./pyrunner.js").RunResult[]} */
  const results = [];
  for (let index = 0; index < config.cases.length; index++) {
    const stdin_lines = config.cases[index].stdin_lines;
    results.push(await py_runner.run(session.source, stdin_lines, { filename: config.filename }));
  }
  assert(results.length === config.cases.length, "score_submission: one result per case");

  const criteria = config.build_criteria(results);
  assert_array(criteria, "build_criteria() result", CRITERION_COUNT_MAX);
  return rubric.grade(criteria, { source: session.source, results });
}

/**
 * Grade the loaded submission and render the result.
 *
 * A submission that does not compile scores zero by assignment policy, so
 * the syntax probe gates everything: there is no point diffing the output of
 * a program that never ran.
 *
 * @param {GraderSession} session Page session, with a submission loaded.
 * @returns {Promise<void>} Resolves once the page is updated.
 */
async function grade_submission(session) {
  assert(session.source != null, "grade_submission: no submission loaded");
  assert(py_runner.is_ready(), "grade_submission: Python runtime is not ready");
  const { config, elements } = session;
  reset_output(session);

  const probe = await py_runner.run(session.source, config.cases[0].stdin_lines, {
    filename: config.filename,
  });
  const has_syntax_error = probe.err.startsWith(SYNTAX_PREFIX);
  /** @type {RubricRow[]} */
  const rows = [row_for_syntax(probe)];

  let total_points = 0;
  if (has_syntax_error) {
    elements.zero.style.display = "block";
    elements.zero.textContent = SYNTAX_ZERO_MESSAGE;
  } else {
    const report = await score_submission(session);
    total_points = report.total;
    for (let index = 0; index < report.items.length; index++) {
      rows.push(row_for_item(report.items[index]));
    }
    for (let index = 0; index < session.manual_rows.length; index++) {
      rows.push({ mark: "—", state: "pending", ...session.manual_rows[index] });
    }
  }

  elements.rubric.innerHTML = rows.map(row_html).join("");
  elements.headline.textContent = String(total_points);
  elements.summary.value = summary_text({
    filename: config.filename,
    total_points,
    max_auto_points: config.max_auto_points,
    has_syntax_error,
  }, rows);
  elements.summary_box.style.display = "block";
  elements.copy_status.textContent = "";
}

/**
 * Copy the summary to the clipboard.
 *
 * Falls back to the legacy selection copy, because a browser may refuse the
 * async clipboard on a page opened over `file://`.
 *
 * @param {GraderSession} session Page session.
 * @returns {Promise<void>} Resolves once the copy attempt finishes.
 */
async function copy_summary(session) {
  assert(session != null, "copy_summary: session must not be null");
  const { elements } = session;
  const text = elements.summary.value;
  assert(typeof text === "string", "copy_summary: summary must be a string");
  try {
    await navigator.clipboard.writeText(text);
    elements.copy_status.textContent = "Copied!";
  } catch (error) {
    elements.summary.select();
    const copied = document.execCommand("copy");
    elements.copy_status.textContent = copied
      ? "Copied!"
      : `Copy failed (${reason_for(error)}) — select the text and copy manually.`;
  }
}

/**
 * Wire the drop zone and the file input.
 *
 * @param {GraderSession} session Page session.
 * @returns {void}
 */
function wire_file_input(session) {
  assert(session != null, "wire_file_input: session must not be null");
  const { elements } = session;

  elements.drop.addEventListener("click", () => elements.file.click());
  elements.file.addEventListener("change", (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    void accept_file(session, input.files?.[0]);
  });
  for (const event_name of ["dragenter", "dragover"]) {
    elements.drop.addEventListener(event_name, (event) => {
      event.preventDefault();
      elements.drop.classList.add("drag");
    });
  }
  for (const event_name of ["dragleave", "drop"]) {
    elements.drop.addEventListener(event_name, (event) => {
      event.preventDefault();
      elements.drop.classList.remove("drag");
    });
  }
  elements.drop.addEventListener("drop", (event) => {
    const transfer = /** @type {DragEvent} */ (event).dataTransfer;
    void accept_file(session, transfer?.files[0]);
  });
}

/**
 * Wire the grade and copy buttons.
 *
 * @param {GraderSession} session Page session.
 * @returns {void}
 */
function wire_buttons(session) {
  assert(session != null, "wire_buttons: session must not be null");
  const { elements } = session;

  elements.run.addEventListener("click", async () => {
    if (session.source == null || !py_runner.is_ready() || session.grading) return;
    session.grading = true;
    elements.run.disabled = true;
    elements.status.textContent = "Grading…";
    try {
      await grade_submission(session);
      elements.status.textContent = "Done.";
    } catch (error) {
      // A throw here is a grader bug, not a student mistake. Say so on the
      // page, and rethrow so it reaches the console with its stack intact.
      elements.status.textContent = `Grader error: ${reason_for(error)}`;
      throw error;
    } finally {
      session.grading = false;
      elements.run.disabled = session.source == null || !py_runner.is_ready();
    }
  });

  elements.copy.addEventListener("click", () => void copy_summary(session));
}

/**
 * Load the Python runtime, reporting progress on the status line.
 *
 * @param {GraderSession} session Page session.
 * @returns {Promise<void>} Resolves once the runtime is up or has failed.
 */
async function boot(session) {
  assert(session != null, "boot: session must not be null");
  const { elements } = session;
  try {
    await py_runner.init({ on_status: (message) => { elements.status.textContent = message; } });
  } catch (error) {
    elements.status.textContent = `Python runtime failed to load: ${reason_for(error)}`;
    return;
  }
  elements.run.disabled = session.source == null;
}

/**
 * Resolve the element the skeleton renders into.
 *
 * @param {HTMLElement | string | undefined} mount Element, selector, or nothing.
 * @returns {HTMLElement} The mount point; `document.body` by default.
 */
function resolve_mount(mount) {
  if (mount == null) return document.body;
  if (typeof mount === "string") {
    const found = document.querySelector(mount);
    assert(found != null, `init: no element matches the mount selector "${mount}"`);
    return /** @type {HTMLElement} */ (found);
  }
  assert(mount instanceof HTMLElement, "init: mount must be an element or a selector");
  return mount;
}

/**
 * Build the page skeleton, unless the page already provides the markup.
 *
 * Detection is by the grade button: a hand-written page that carries the
 * elements keeps them, and everything else gets the generated skeleton, so
 * an assignment page is a title, a stylesheet, and its data.
 *
 * @param {GraderConfig} config Assignment configuration.
 * @param {ElementIds} ids Element ids, after applying any overrides.
 * @returns {boolean} True when the skeleton was rendered.
 */
function ensure_page(config, ids) {
  assert(config != null, "ensure_page: config must not be null");
  assert(ids != null, "ensure_page: ids must not be null");
  if (document.getElementById(ids.run) != null) return false;

  if (config.styles_href !== false) {
    ensure_stylesheet(config.styles_href ?? default_styles_href());
  }
  render_skeleton({
    ids,
    title: config.title ?? document.title ?? "Autograder",
    subtitle: config.subtitle,
    headline_label: config.headline_label ?? `/ ${config.max_auto_points} auto`,
    drop_prompt: config.drop_prompt ?? `Drop ${config.filename} here`,
    drop_hint: config.drop_hint,
    accept: config.accept,
    footer: config.footer,
    mount: resolve_mount(config.mount),
  });
  assert(document.getElementById(ids.run) != null, "ensure_page: the skeleton must provide a button");
  return true;
}

/**
 * Wire up a browser autograder page.
 *
 * The page needs no markup of its own: when the grader elements are absent,
 * this renders the skeleton before wiring anything up.
 *
 * @param {GraderConfig} config Assignment-specific configuration.
 * @returns {void}
 */
export function init(config) {
  check_config(config);
  const ids = { ...ELEMENT_IDS_DEFAULT, ...(config.element_ids ?? {}) };
  ensure_page(config, ids);
  /** @type {GraderSession} */
  const session = {
    config,
    elements: resolve_elements(ids),
    manual_rows: config.manual_rows ?? [],
    source: null,
    grading: false,
  };

  wire_file_input(session);
  wire_buttons(session);
  void boot(session);
  assert(session.source === null, "init: no submission may be loaded before the student picks one");
}
