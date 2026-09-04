/**
 * Page glue: file drop, grading run, rubric rendering.
 *
 * This module owns the page's behaviour; `page.js` builds its markup and
 * `handout.js` fills the column beside it, so the three of them are the DOM
 * layer between them. An assignment page supplies
 * its test cases and rubric through `init` and reuses the shared page
 * skeleton (the element ids in `ELEMENT_IDS_DEFAULT`) and `css/a1.css`.
 * Nothing here knows about any specific assignment.
 */

import { assert, assert_array, assert_range, assert_string } from "./assert.js";
import * as checks from "./checks.js";
import * as editor_box from "./editor.js";
import { load_handout } from "./handout.js";
import { escape_html } from "./html.js";
import {
  default_styles_href,
  ensure_stylesheet,
  render_skeleton,
  resolve_mount,
  rubric_preview_html,
} from "./page.js";
import * as py_runner from "./pyrunner.js";
import * as rubric from "./rubric.js";
import {
  CRITERION_COUNT_MAX,
  EDITOR_LINE_COUNT_MAX,
  FILENAME_CHARS_MAX,
  HANDOUT_HREF_CHARS_MAX,
  MANUAL_ROW_COUNT_MAX,
  NEEDLE_CHARS_MAX,
  POINTS_MAX,
  DRAFT_SAVE_DELAY_MS,
  SOURCE_BYTES_MAX,
  STDIN_LINE_COUNT_MAX,
  TEST_CASE_COUNT_MAX,
} from "./constants.js";

/**
 * `init` takes one config object:
 *
 * - `filename`: the submission's name, e.g. `"program1.py"`. Names the file
 *   inside Pyodide (so tracebacks read `program1.py`), heads the copyable
 *   summary, and fills the default drop prompt. The upload itself is only
 *   checked for a `.py` extension, not for this exact name.
 * - `cases`: `{ name, stdin_lines, expected_lines }` per example, run in
 *   order. `cases[0].stdin_lines` also drives the syntax-error probe that
 *   gates the whole run.
 * - `build_criteria(results)`: returns the rubric `rubric.grade` scores.
 * - `max_auto_points`: the denominator shown beside the total.
 * - `manual_rows`: instructor-graded rows, not totalled, each
 *   `{ name, description, score, detail }` where `score` is text like
 *   `"manual / 5"`.
 * - `title`, `subtitle`, `headline_label`, `drop_prompt`, `drop_hint`,
 *   `accept`, `footer`: page text, each with a default (the title falls back
 *   to `document.title`, the caption to `"/ <max_auto_points> auto"`, and the
 *   prompt to `"Drop <filename> here"`).
 * - `mount`: an element or a selector, defaulting to `document.body`.
 * - `handout`: a markdown file to fetch and render beside the grader, either
 *   `"w1p1.md"` or `{ href, mount, render_rubric }`. The mount defaults to
 *   `"#handout"`, and is separate from the grader's, so a two-column page can
 *   carry the problem statement on one side and the drop zone on the other.
 *   `render_rubric` defaults to `true`: the rubric is generated from
 *   `build_criteria` and appended under the handout, so the points a student
 *   reads are the points the grader awards. Pass `false` for a handout that
 *   writes its own.
 * - `editor`: `true` for an in-page editor, or `{ download }`. Absent or
 *   `false` leaves the page exactly as it was: no editor markup, no editor
 *   ids, no behaviour change. With one, the buffer is what gets graded, a
 *   dropped file lands in it, and Run executes it against one example without
 *   spending a grading run.
 * - `styles_href`: another stylesheet, or `false` to link none. Defaults to
 *   `css/a1.css` beside this module.
 * - `element_ids`: overrides for any of `ELEMENT_IDS_DEFAULT`.
 * - `submit_to`: where the student uploads the file, named in the
 *   non-Python-file warning. Defaults to `"BrightSpace"`.
 *
 * A rubric row rendered from all that is `{ mark, state, name, description,
 * score, detail }`: the mark is `✓`, `±`, `✗`, or `—`, and the state is
 * `"pass"`, `"fail"`, or `"pending"`, which is the mark's CSS class.
 */

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

/**
 * The editor's own ids, kept apart from `ELEMENT_IDS_DEFAULT` on purpose.
 * `resolve_elements` asserts one element per id and `require_element` asserts
 * that each exists, so an optional id routed through either would fail
 * startup on every page that never asked for an editor.
 */
const EDITOR_IDS_DEFAULT = {
  code: "code",
  gutter: "gutter",
  highlight: "highlight",
  run_code: "runcode",
  run_status: "runstatus",
  case_select: "caseselect",
  stdin: "stdin",
  console: "console",
  download: "download",
};

/** Where a handout renders when the config names a file but no mount. */
const HANDOUT_MOUNT_DEFAULT = "#handout";

/**
 * `handout: "w1p1.md"` is shorthand for the full `{ href, mount }` form, which
 * is what an assignment page wants nine times in ten.
 */
function handout_options(handout) {
  if (handout == null) return null;
  if (typeof handout === "string") {
    return { href: handout, mount: HANDOUT_MOUNT_DEFAULT, render_rubric: true };
  }
  assert(
    typeof handout === "object",
    "config.handout must be a path or a { href, mount } object",
  );
  return {
    href: handout.href,
    mount: handout.mount ?? HANDOUT_MOUNT_DEFAULT,
    render_rubric: handout.render_rubric ?? true,
  };
}

/**
 * `editor: true` is shorthand for the full form, the way `handout` works
 * above it. `false` and `undefined` both mean no editor, so a page that never
 * mentions it is exactly the page it was.
 */
function editor_options(config_editor) {
  if (config_editor == null || config_editor === false) return null;
  if (config_editor === true) return { download: true };
  assert(
    typeof config_editor === "object",
    "config.editor must be true, false, or an options object",
  );
  return { download: config_editor.download ?? true };
}

const SYNTAX_ZERO_MESSAGE =
  "Syntax error — score is zero per assignment policy.";

/** Prefix `py_runner` puts on a compile failure. */
const SYNTAX_PREFIX = "SYNTAX:";

function reason_for(error) {
  const reason = error instanceof Error ? error.message : String(error);
  assert(typeof reason === "string", "reason_for: reason must be a string");
  return reason;
}

/**
 * A missing id is a page bug, not a student problem, and it is far cheaper to
 * catch here than as a `null` dereference three callbacks later.
 */
function require_element(id) {
  assert(
    typeof id === "string" && id.length > 0,
    "require_element: id must be non-empty",
  );
  const element = document.getElementById(id);
  assert(element != null, `page is missing an element with id "${id}"`);
  return element;
}

function resolve_elements(ids) {
  assert(
    ids != null && typeof ids === "object",
    "resolve_elements: ids must be an object",
  );
  const elements = {
    status: require_element(ids.status),
    run: require_element(ids.run),
    drop: require_element(ids.drop),
    file: require_element(ids.file),
    filename: require_element(ids.filename),
    rubric: require_element(ids.rubric),
    zero: require_element(ids.zero),
    headline: require_element(ids.headline),
    summary_box: require_element(ids.summary_box),
    summary: require_element(ids.summary),
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
 * Resolved only when the assignment asked for an editor, so the ids stay
 * optional. A page that supplies its own markup still has to carry all of
 * them: half an editor is worse than none.
 *
 * The highlight layer is the one exception, and it is looked up rather than
 * required: nothing is read back from it and nothing depends on it, so a page
 * written before it existed keeps an editor that works, in one colour.
 */
function resolve_editor_elements(ids) {
  assert(ids != null && typeof ids === "object", "resolve_editor_elements: ids must be an object");
  const elements = {
    code: require_element(ids.code),
    gutter: require_element(ids.gutter),
    highlight: document.getElementById(ids.highlight),
    run_code: require_element(ids.run_code),
    run_status: require_element(ids.run_status),
    case_select: require_element(ids.case_select),
    stdin: require_element(ids.stdin),
    console: require_element(ids.console),
    download: require_element(ids.download),
  };
  assert(
    Object.keys(elements).length === Object.keys(ids).length,
    "resolve_editor_elements: one element per id",
  );
  return elements;
}

function check_config(config) {
  assert(
    config != null && typeof config === "object",
    "init: config must be an object",
  );
  assert_string(config.filename, "config.filename", FILENAME_CHARS_MAX);
  assert(config.filename.length > 0, "config.filename must not be empty");
  const handout = handout_options(config.handout);
  if (handout !== null) {
    assert_string(handout.href, "config.handout.href", HANDOUT_HREF_CHARS_MAX);
    assert(handout.href.length > 0, "config.handout.href must not be empty");
    assert(
      typeof handout.render_rubric === "boolean",
      "config.handout.render_rubric must be a boolean",
    );
  }
  const editor = editor_options(config.editor);
  if (editor !== null) {
    assert(
      typeof editor.download === "boolean",
      "config.editor.download must be a boolean",
    );
  }
  const cases = assert_array(config.cases, "config.cases", TEST_CASE_COUNT_MAX);
  assert(cases.length > 0, "config.cases must contain at least one case");
  for (let index = 0; index < cases.length; index++) {
    const test_case = cases[index];
    assert_string(
      test_case.name,
      `config.cases[${index}].name`,
      NEEDLE_CHARS_MAX,
    );
    assert_array(
      test_case.stdin_lines,
      `config.cases[${index}].stdin_lines`,
      STDIN_LINE_COUNT_MAX,
    );
    assert_array(
      test_case.expected_lines,
      `config.cases[${index}].expected_lines`,
      STDIN_LINE_COUNT_MAX,
    );
  }
  assert(
    typeof config.build_criteria === "function",
    "config.build_criteria must be a function",
  );
  assert_range(config.max_auto_points, "config.max_auto_points", 0, POINTS_MAX);
  assert_array(
    config.manual_rows ?? [],
    "config.manual_rows",
    MANUAL_ROW_COUNT_MAX,
  );
}

function row_html(row) {
  assert(row != null, "row_html: row must not be null");
  assert(
    row.state === "pass" || row.state === "fail" || row.state === "pending",
    `row_html: unknown state ${row.state}`,
  );
  const detail_html = row.detail
    ? `<div class="r-detail">${row.detail}</div>`
    : "";
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

function row_for_item(item) {
  assert(item != null, "row_for_item: item must not be null");
  assert(
    item.earned <= item.points,
    `row_for_item: "${item.id}" earned more than its points`,
  );
  const partial = !item.pass && item.earned > 0;
  return {
    mark: item.pass ? "✓" : partial ? "±" : "✗",
    state: item.pass ? "pass" : partial ? "pending" : "fail",
    name: item.name,
    description: item.description,
    score: `${item.earned} / ${item.points}`,
    detail: item.detail_is_html ? item.detail : escape_html(item.detail),
  };
}

/** The gate row: a syntax error forces a total score of zero. */
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
 * The plain-text summary a student pastes into their submission. `args` is
 * `{ filename, total_points, max_auto_points, has_syntax_error }`.
 */
function summary_text(args, rows) {
  assert(args != null, "summary_text: args must not be null");
  assert(Array.isArray(rows), "summary_text: rows must be an array");
  const lines = [`${args.filename} — Autograder Summary`];
  lines.push(
    args.has_syntax_error
      ? "Score: 0 (syntax error — see below)"
      : `Score: ${args.total_points} / ${args.max_auto_points}`,
  );
  lines.push("");
  for (let index = 0; index < rows.length; index++) {
    lines.push(`- ${rows[index].name}: ${rows[index].score}`);
  }
  assert(
    lines.length === rows.length + 3,
    "summary_text: one line per row plus the header",
  );
  return lines.join("\n");
}

function read_file_text(file) {
  assert(file != null, "read_file_text: file must not be null");
  assert(
    typeof file.name === "string",
    "read_file_text: file must carry a name",
  );
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error(`could not read ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * A submission worth grading. An editor starts empty, so "loaded" is not the
 * same question as "has anything in it".
 */
function can_grade(session) {
  assert(session != null, "can_grade: session must not be null");
  return session.source != null && session.source.trim() !== "" && py_runner.is_ready();
}

/** One place decides what is clickable, so the two entry paths cannot disagree. */
function refresh_buttons(session) {
  assert(session != null, "refresh_buttons: session must not be null");
  session.elements.run.disabled = session.grading || !can_grade(session);
  if (session.editor_elements != null) {
    session.editor_elements.run_code.disabled = session.running || !can_grade(session);
  }
}

/**
 * The anchor an `output-diff` criterion trims transcripts to, read off the
 * rubric rather than configured twice. Run must compare what Grade compares,
 * or a student passes the preview and fails the score.
 */
function diff_anchor_prefix(config) {
  const criteria = config.build_criteria([]);
  for (let index = 0; index < criteria.length; index++) {
    if (criteria[index].type === "output-diff") return criteria[index].anchor_prefix;
  }
  return undefined;
}

/** The example the picker is on, or `null` for the free-form entry. */
function selected_case(session) {
  assert(session != null, "selected_case: session must not be null");
  const index = Number(session.editor_elements.case_select.value);
  if (!Number.isInteger(index) || index < 0) return null;
  return session.config.cases[index] ?? null;
}

/** Drop the tag `py_runner` puts on an error; the console is not parsing it. */
function untagged(err) {
  assert(typeof err === "string", "untagged: err must be a string");
  const colon = err.indexOf(":");
  return colon === -1 ? err : err.slice(colon + 1);
}

/**
 * What one run looks like in the console: the transcript, then the failure if
 * there was one, then how the output compares to the example that was run.
 *
 * The diff comes from the same `diff_lines` and the same renderer the rubric
 * uses, so a student can see exactly which line is wrong without spending a
 * grading run to find out.
 */
function run_console_html(session, result, test_case) {
  assert(session != null, "run_console_html: session must not be null");
  assert(result != null, "run_console_html: result must not be null");
  const parts = [];
  parts.push(result.out === ""
    ? '<p class="console-note">The program printed nothing.</p>'
    : `<pre class="io">${escape_html(result.out)}</pre>`);

  if (result.err !== "") {
    parts.push(`<pre class="io bad">${escape_html(untagged(result.err).trim())}</pre>`);
    if (result.line != null) {
      parts.push(
        `<button class="ghost jump" type="button" data-line="${result.line}" `
        + `data-col="${result.col ?? 1}">Go to line ${result.line}</button>`,
      );
    }
    return parts.join("");
  }

  if (test_case != null) {
    const diff = checks.diff_lines(result.out, test_case.expected_lines, {
      anchor_prefix: session.anchor_prefix,
    });
    parts.push(diff.all_match
      ? '<p class="console-note good">Output matches this example exactly.</p>'
      : '<p class="console-note bad">Output does not match this example yet.</p>'
        + rubric.render_diff_html(diff.rows));
  }
  return parts.join("");
}

/** Run the buffer once, against whatever the stdin box currently holds. */
async function run_once(session) {
  assert(session != null, "run_once: session must not be null");
  const elements = session.editor_elements;
  if (session.running || !can_grade(session)) return;
  session.running = true;
  refresh_buttons(session);
  elements.run_status.textContent = "Running…";
  elements.console.innerHTML = "";
  try {
    const stdin_lines = editor_box.stdin_lines_from_text(elements.stdin.value);
    const result = await py_runner.run(session.source, stdin_lines, {
      filename: session.config.filename,
    });
    elements.console.innerHTML = run_console_html(session, result, selected_case(session));
    elements.run_status.textContent = result.err === "" ? "Ran." : "Stopped.";
  } catch (error) {
    // A throw here is a runner bug, not a student mistake. Say so, then let it
    // reach the console with its stack intact.
    elements.run_status.textContent = `Runner error: ${reason_for(error)}`;
    throw error;
  } finally {
    session.running = false;
    refresh_buttons(session);
  }
}

/** The editor is the source of truth once it exists; the drop zone feeds it. */
function set_editor_source(session, text) {
  assert(session != null, "set_editor_source: session must not be null");
  assert(typeof text === "string", "set_editor_source: text must be a string");
  session.editor.set_value(text);
}

function save_current_draft(session) {
  assert(session != null, "save_current_draft: session must not be null");
  editor_box.save_draft(session.draft_key, session.source ?? "");
}

function download_source(session) {
  assert(session != null, "download_source: session must not be null");
  const { config } = session;
  // Students still upload the real file, so the buffer has to become one.
  const blob = new Blob([session.source ?? ""], { type: "text/x-python" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = config.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * What the editor opens with: the draft, or nothing.
 *
 * A student writes the program, so an empty box is the honest starting point.
 * The one thing worth restoring is their own work from last time.
 */
function initial_source(session) {
  assert(session != null, "initial_source: session must not be null");
  const draft = editor_box.load_draft(session.draft_key);
  return draft ?? "";
}

/** Fill the picker from the rubric's own examples, and prime the stdin box. */
function fill_case_picker(session) {
  assert(session != null, "fill_case_picker: session must not be null");
  const { cases } = session.config;
  const options = cases.map(
    (test_case, index) => `<option value="${index}">${escape_html(test_case.name)}</option>`,
  );
  options.push('<option value="-1">Input of my own</option>');
  session.editor_elements.case_select.innerHTML = options.join("");
  sync_stdin_to_case(session);
}

function sync_stdin_to_case(session) {
  const test_case = selected_case(session);
  if (test_case == null) return;
  session.editor_elements.stdin.value = test_case.stdin_lines.join("\n");
}

function wire_editor_pane(session) {
  assert(session != null, "wire_editor_pane: session must not be null");
  const elements = session.editor_elements;

  session.editor = editor_box.wire_editor(
    { textarea: elements.code, gutter: elements.gutter, highlight: elements.highlight },
    {
      on_change: (text) => {
        if (text.length > SOURCE_BYTES_MAX) {
          elements.run_status.textContent = "That is too much code to grade.";
          return;
        }
        // The buffer is past what the gutter can number, so it is not a
        // submission yet. Said here because the editor cannot say it: pasting
        // is the only way to reach this, since a dropped file is turned away
        // by `accept_file` before it lands.
        if (text.split("\n").length > EDITOR_LINE_COUNT_MAX) {
          elements.run_status.textContent =
            `That is over ${EDITOR_LINE_COUNT_MAX} lines, which is more than the editor can number.`;
          return;
        }
        session.source = text;
        refresh_buttons(session);
        // Debounced: a keystroke per write would hammer storage for nothing.
        globalThis.clearTimeout(session.draft_timer);
        session.draft_timer = globalThis.setTimeout(
          () => save_current_draft(session), DRAFT_SAVE_DELAY_MS,
        );
      },
      on_run: () => void run_once(session),
    },
  );

  fill_case_picker(session);
  elements.case_select.addEventListener("change", () => sync_stdin_to_case(session));
  elements.run_code.addEventListener("click", () => void run_once(session));

  // Delegated, because the button only exists while an error is on screen.
  elements.console.addEventListener("click", (event) => {
    const button = event.target.closest?.(".jump");
    if (button == null) return;
    session.editor.focus_line(Number(button.dataset.line), Number(button.dataset.col));
  });

  elements.download.addEventListener("click", () => download_source(session));
  if (!session.editor_config.download) elements.download.style.display = "none";

  set_editor_source(session, initial_source(session));
}

function reset_output(session) {
  assert(session != null, "reset_output: session must not be null");
  const { elements } = session;
  elements.rubric.innerHTML = "";
  elements.zero.style.display = "none";
  elements.summary_box.style.display = "none";
  elements.summary.value = "";
  elements.headline.textContent = "—";
  assert(
    elements.rubric.innerHTML === "",
    "reset_output: rubric must end empty",
  );
}

/**
 * Whether a dropped file may take the buffer over.
 *
 * The drop zone and the editor write to the same submission, and the file
 * wins, so a student who has written something is asked first. Nothing else
 * in the editor destroys work this way: Tab and Enter go through
 * `execCommand` precisely so the browser's undo history survives them, and a
 * dropped file cannot be undone at all. The debounced draft save then follows
 * it into `localStorage`, so a reload does not bring the work back either.
 *
 * A blank buffer is nothing to lose, and a page without an editor has no
 * buffer at all. Neither asks.
 */
function may_replace_buffer(session, filename) {
  assert(session != null, "may_replace_buffer: session must not be null");
  assert(typeof filename === "string", "may_replace_buffer: filename must be a string");
  if (session.editor == null) return true;
  if (session.editor.get_value().trim() === "") return true;
  return globalThis.confirm(
    `Replace what you have written with ${filename}?`
    + " Your code will be gone, and this cannot be undone.",
  );
}

/**
 * A file the browser cannot read, or one too large to be a Python program,
 * leaves the previous submission in place and says why on the status line.
 */
async function accept_file(session, file) {
  assert(session != null, "accept_file: session must not be null");
  if (file == null) return;
  const { config, elements } = session;

  // Asked before the file is read, so a student who says no waits for nothing.
  if (!may_replace_buffer(session, file.name)) {
    elements.status.textContent = "Kept what you had written.";
    return;
  }

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
  // The editor's gutter numbers a bounded number of lines and asserts on more,
  // so a file it cannot display is turned away here rather than throwing three
  // calls deeper. A wrong file — a spreadsheet, a log — is how this is reached,
  // and it stays under the byte ceiling while being far over this one.
  const line_count = text.split("\n").length;
  if (session.editor != null && line_count > EDITOR_LINE_COUNT_MAX) {
    elements.status.textContent =
      `${file.name} has ${line_count} lines; the editor shows at most ${EDITOR_LINE_COUNT_MAX}.`;
    return;
  }

  session.source = text;
  // With an editor on the page the buffer is what gets graded, so a dropped
  // file lands in it rather than beside it.
  if (session.editor != null) set_editor_source(session, text);
  const is_python = file.name.endsWith(".py");
  const submit_to = config.submit_to ?? "BrightSpace";
  elements.filename.textContent =
    file.name +
    (is_python
      ? "  ✓"
      : `  ⚠ Not a Python file. Submit a .py file on ${submit_to}`);
  reset_output(session);
  refresh_buttons(session);
  elements.status.textContent = "File loaded. Ready to grade.";
}

async function score_submission(session) {
  assert(session.source != null, "score_submission: no submission loaded");
  const { config } = session;
  const source = session.source;

  const results = [];
  for (let index = 0; index < config.cases.length; index++) {
    const stdin_lines = config.cases[index].stdin_lines;
    results.push(
      await py_runner.run(source, stdin_lines, { filename: config.filename }),
    );
  }
  assert(
    results.length === config.cases.length,
    "score_submission: one result per case",
  );

  const criteria = config.build_criteria(results);
  assert_array(criteria, "build_criteria() result", CRITERION_COUNT_MAX);
  return rubric.grade(criteria, { source, results });
}

/**
 * A submission that does not compile scores zero by assignment policy, so the
 * syntax probe gates everything: there is no point diffing the output of a
 * program that never ran.
 */
async function grade_submission(session) {
  assert(session.source != null, "grade_submission: no submission loaded");
  assert(py_runner.is_ready(), "grade_submission: Python runtime is not ready");
  const { config, elements } = session;
  reset_output(session);

  const probe = await py_runner.run(
    session.source,
    config.cases[0].stdin_lines,
    {
      filename: config.filename,
    },
  );
  const has_syntax_error = probe.err.startsWith(SYNTAX_PREFIX);
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
  elements.summary.value = summary_text(
    {
      filename: config.filename,
      total_points,
      max_auto_points: config.max_auto_points,
      has_syntax_error,
    },
    rows,
  );
  elements.summary_box.style.display = "block";
  elements.copy_status.textContent = "";
}

/**
 * Falls back to the legacy selection copy, because a browser may refuse the
 * async clipboard on a page opened over `file://`.
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

function wire_file_input(session) {
  assert(session != null, "wire_file_input: session must not be null");
  const { elements } = session;

  elements.drop.addEventListener("click", () => elements.file.click());
  elements.file.addEventListener("change", (event) => {
    const input = event.target;
    void accept_file(session, input.files?.[0]);
    // Cleared so that choosing the same file again still fires `change`. The
    // File itself is already in hand, and outlives the input's list.
    input.value = "";
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
    const transfer = event.dataTransfer;
    void accept_file(session, transfer?.files[0]);
  });
}

function wire_buttons(session) {
  assert(session != null, "wire_buttons: session must not be null");
  const { elements } = session;

  elements.run.addEventListener("click", async () => {
    if (session.grading || !can_grade(session)) return;
    session.grading = true;
    refresh_buttons(session);
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
      refresh_buttons(session);
    }
  });

  elements.copy.addEventListener("click", () => void copy_summary(session));
}

async function boot(session) {
  assert(session != null, "boot: session must not be null");
  const { elements } = session;
  try {
    await py_runner.init({
      on_status: (message) => {
        elements.status.textContent = message;
      },
    });
  } catch (error) {
    elements.status.textContent = `Python runtime failed to load: ${reason_for(error)}`;
    return;
  }
  refresh_buttons(session);
}

/**
 * Detection is by the grade button: a hand-written page that carries the
 * elements keeps them, and everything else gets the generated skeleton, so an
 * assignment page is a title, a stylesheet, and its data.
 */
function ensure_page(config, ids, editor_ids) {
  assert(config != null, "ensure_page: config must not be null");
  assert(ids != null, "ensure_page: ids must not be null");
  if (document.getElementById(ids.run) != null) return false;

  if (config.styles_href !== false) {
    ensure_stylesheet(config.styles_href ?? default_styles_href());
  }
  render_skeleton({
    ids,
    editor_ids,
    filename: config.filename,
    title: config.title ?? document.title ?? "Autograder",
    subtitle: config.subtitle,
    headline_label: config.headline_label ?? `/ ${config.max_auto_points} auto`,
    drop_prompt: config.drop_prompt ?? `Drop ${config.filename} here`,
    drop_hint: config.drop_hint,
    accept: config.accept,
    footer: config.footer,
    mount: resolve_mount(config.mount, "init"),
  });
  assert(
    document.getElementById(ids.run) != null,
    "ensure_page: the skeleton must provide a button",
  );
  return true;
}

/**
 * Wire up a browser autograder page. The page needs no markup of its own:
 * when the grader elements are absent, this renders the skeleton first.
 */
export function init(config) {
  check_config(config);
  const ids = {
    ...ELEMENT_IDS_DEFAULT,
    ...(config.element_ids ?? {}),
  };
  const editor_config = editor_options(config.editor);
  const editor_ids = editor_config === null
    ? null
    : { ...EDITOR_IDS_DEFAULT, ...(config.editor_element_ids ?? {}) };
  ensure_page(config, ids, editor_ids);
  // Everything one wired-up page owns. Passing this session explicitly,
  // rather than closing over a pile of `let`s, keeps every handler a
  // top-level function small enough to read in one screen. `source` is null
  // until a submission is chosen, which on an editor page happens as the
  // editor is wired: its buffer is the submission, empty or restored from a
  // draft. `grading` rejects re-entry while a run is in flight.
  const session = {
    config,
    elements: resolve_elements(ids),
    manual_rows: config.manual_rows ?? [],
    source: null,
    grading: false,
    // Everything below belongs to the editor, and stays null without one.
    editor_config,
    editor_elements: editor_config === null ? null : resolve_editor_elements(editor_ids),
    editor: null,
    running: false,
    draft_timer: 0,
    draft_key: editor_config === null
      ? ""
      : editor_box.draft_key(globalThis.location?.pathname ?? "/", config.filename),
    anchor_prefix: editor_config === null ? undefined : diff_anchor_prefix(config),
  };

  wire_file_input(session);
  wire_buttons(session);
  if (editor_config !== null) wire_editor_pane(session);
  // Fetched rather than awaited: the prose and the Python runtime load in
  // parallel, and a handout that never arrives must not hold up grading.
  const handout = handout_options(config.handout);
  if (handout !== null) {
    const mount = resolve_mount(handout.mount, "init");
    // The rubric is built here rather than in the callback below, so a rubric
    // that cannot be built fails in front of the instructor now instead of
    // disappearing into a rejected promise after the fetch returns.
    const rubric = handout.render_rubric
      ? rubric_preview_html({
        criteria: config.build_criteria([]),
        manual_rows: config.manual_rows ?? [],
        max_auto_points: config.max_auto_points,
      })
      : "";
    void load_handout({ href: handout.href, mount }).then(() => {
      if (rubric !== "") mount.insertAdjacentHTML("beforeend", rubric);
    });
  }
  void boot(session);
  assert(
    editor_config === null ? session.source === null : typeof session.source === "string",
    "init: without an editor, no submission may be loaded before the student picks one",
  );
}
