/**
 * Page glue: file drop, grading run, rubric rendering.
 *
 * This is the only module that touches the DOM. An assignment page supplies
 * its test cases and rubric through `init` and reuses the shared page
 * skeleton (the element ids in `ELEMENT_IDS_DEFAULT`) and `css/a1.css`.
 * Nothing here knows about any specific assignment.
 */

import { assert, assert_array, assert_range, assert_string } from "./assert.ts";
import { escape_html } from "./html.ts";
import { default_styles_href, ensure_stylesheet, render_skeleton } from "./page.ts";
import * as py_runner from "./pyrunner.ts";
import type { RunResult } from "./pyrunner.ts";
import * as rubric from "./rubric.ts";
import type { Criterion, GradeReport, GradedItem } from "./rubric.ts";
import {
  CRITERION_COUNT_MAX, FILENAME_CHARS_MAX, MANUAL_ROW_COUNT_MAX, NEEDLE_CHARS_MAX,
  POINTS_MAX, SOURCE_BYTES_MAX, STDIN_LINE_COUNT_MAX, TEST_CASE_COUNT_MAX,
} from "./constants.ts";

export interface TestCase {
  name: string;
  /** Values fed to successive `input()` calls. */
  stdin_lines: string[];
  /** Required output, one entry per line. */
  expected_lines: string[];
}

/**
 * A rubric line the tool cannot check, shown for completeness and excluded
 * from the automatic total (variable naming, comment quality, and the like).
 */
export interface ManualRow {
  name: string;
  description: string;
  /** Text shown in the score column, e.g. `"manual / 5"`. */
  score: string;
  detail?: string;
}

export interface RubricRow {
  /** Glyph in the left column: `✓`, `±`, `✗`, or `—`. */
  mark: string;
  /** CSS state class for the mark. */
  state: "pass" | "fail" | "pending";
  name: string;
  description: string;
  score: string;
  /** Already HTML-escaped where needed. */
  detail?: string;
}

export type BuildCriteria = (results: RunResult[]) => Criterion[];

export interface GraderConfig {
  /**
   * Submission filename, e.g. `"program1.py"`. Names the file inside Pyodide
   * (so tracebacks read `program1.py`), heads the copyable summary, and fills
   * the default drop prompt. The upload itself is only checked for a `.py`
   * extension, not for this exact name.
   */
  filename: string;
  /**
   * Run in order. `cases[0].stdin_lines` also drives the syntax-error probe
   * that gates the whole run.
   */
  cases: TestCase[];
  build_criteria: BuildCriteria;
  /** Denominator shown beside the total. */
  max_auto_points: number;
  /** Instructor-graded rows, not totalled. */
  manual_rows?: ManualRow[];
  element_ids?: Partial<ElementIds>;
  /** Defaults to `document.title`. */
  title?: string;
  /** Line under the heading, e.g. the rubric total. */
  subtitle?: string;
  /** Defaults to `"/ <max_auto_points> auto"`. */
  headline_label?: string;
  /** Defaults to `"Drop <filename> here"`. */
  drop_prompt?: string;
  drop_hint?: string;
  accept?: string;
  footer?: string;
  /** Element or selector; defaults to `document.body`. */
  mount?: HTMLElement | string;
  /** `false` adds none. Defaults to `css/a1.css` beside the loaded bundle. */
  styles_href?: string | false;
  /**
   * Where the student uploads the file, named in the non-Python-file warning.
   * Defaults to `"BrightSpace"`.
   */
  submit_to?: string;
}

export interface ElementIds {
  status: string;
  run: string;
  drop: string;
  file: string;
  filename: string;
  rubric: string;
  zero: string;
  headline: string;
  summary_box: string;
  summary: string;
  copy: string;
  copy_status: string;
}

export interface Elements {
  status: HTMLElement;
  run: HTMLButtonElement;
  drop: HTMLElement;
  file: HTMLInputElement;
  filename: HTMLElement;
  rubric: HTMLElement;
  zero: HTMLElement;
  headline: HTMLElement;
  summary_box: HTMLElement;
  summary: HTMLTextAreaElement;
  copy: HTMLElement;
  copy_status: HTMLElement;
}

/**
 * Everything one wired-up page owns. Passing this explicitly, rather than
 * closing over a pile of `let`s, keeps every handler a top-level function
 * small enough to read in one screen.
 */
export interface GraderSession {
  config: GraderConfig;
  elements: Elements;
  manual_rows: ManualRow[];
  /** `null` until a submission is chosen. */
  source: string | null;
  /** True while a run is in flight, to reject re-entry. */
  grading: boolean;
}

const ELEMENT_IDS_DEFAULT: ElementIds = {
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

const SYNTAX_ZERO_MESSAGE = "Syntax error — score is zero per assignment policy.";

/** Prefix `py_runner` puts on a compile failure. */
const SYNTAX_PREFIX = "SYNTAX:";

function reason_for(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  assert(typeof reason === "string", "reason_for: reason must be a string");
  return reason;
}

/**
 * A missing id is a page bug, not a student problem, and it is far cheaper to
 * catch here than as a `null` dereference three callbacks later.
 */
function require_element(id: string): HTMLElement {
  assert(typeof id === "string" && id.length > 0, "require_element: id must be non-empty");
  const element = document.getElementById(id);
  assert(element != null, `page is missing an element with id "${id}"`);
  return element;
}

function resolve_elements(ids: ElementIds): Elements {
  assert(ids != null && typeof ids === "object", "resolve_elements: ids must be an object");
  const elements: Elements = {
    status: require_element(ids.status),
    run: require_element(ids.run) as HTMLButtonElement,
    drop: require_element(ids.drop),
    file: require_element(ids.file) as HTMLInputElement,
    filename: require_element(ids.filename),
    rubric: require_element(ids.rubric),
    zero: require_element(ids.zero),
    headline: require_element(ids.headline),
    summary_box: require_element(ids.summary_box),
    summary: require_element(ids.summary) as HTMLTextAreaElement,
    copy: require_element(ids.copy),
    copy_status: require_element(ids.copy_status),
  };
  assert(
    Object.keys(elements).length === Object.keys(ids).length,
    "resolve_elements: one element per id",
  );
  return elements;
}

function check_config(config: GraderConfig): void {
  assert(config != null && typeof config === "object", "init: config must be an object");
  assert_string(config.filename, "config.filename", FILENAME_CHARS_MAX);
  assert(config.filename.length > 0, "config.filename must not be empty");
  const cases = assert_array<TestCase>(config.cases, "config.cases", TEST_CASE_COUNT_MAX);
  assert(cases.length > 0, "config.cases must contain at least one case");
  for (let index = 0; index < cases.length; index++) {
    const test_case = cases[index];
    assert_string(test_case.name, `config.cases[${index}].name`, NEEDLE_CHARS_MAX);
    assert_array(
      test_case.stdin_lines,
      `config.cases[${index}].stdin_lines`, STDIN_LINE_COUNT_MAX,
    );
    assert_array(
      test_case.expected_lines,
      `config.cases[${index}].expected_lines`, STDIN_LINE_COUNT_MAX,
    );
  }
  assert(typeof config.build_criteria === "function", "config.build_criteria must be a function");
  assert_range(config.max_auto_points, "config.max_auto_points", 0, POINTS_MAX);
  assert_array(config.manual_rows ?? [], "config.manual_rows", MANUAL_ROW_COUNT_MAX);
}

function row_html(row: RubricRow): string {
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

function row_for_item(item: GradedItem): RubricRow {
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

/** The gate row: a syntax error forces a total score of zero. */
function row_for_syntax(probe: RunResult): RubricRow {
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

interface SummaryArgs {
  filename: string;
  total_points: number;
  max_auto_points: number;
  has_syntax_error: boolean;
}

/** The plain-text summary a student pastes into their submission. */
function summary_text(args: SummaryArgs, rows: RubricRow[]): string {
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

function read_file_text(file: File): Promise<string> {
  assert(file != null, "read_file_text: file must not be null");
  assert(typeof file.name === "string", "read_file_text: file must carry a name");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`could not read ${file.name}`));
    reader.readAsText(file);
  });
}

function reset_output(session: GraderSession): void {
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
 * A file the browser cannot read, or one too large to be a Python program,
 * leaves the previous submission in place and says why on the status line.
 */
async function accept_file(session: GraderSession, file: File | null | undefined): Promise<void> {
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
  const is_python = file.name.endsWith(".py");
  const submit_to = config.submit_to ?? "BrightSpace";
  elements.filename.textContent = file.name +
    (is_python ? "  ✓" : `  ⚠ Not a Python file. Submit a .py file on ${submit_to}`);
  reset_output(session);
  elements.run.disabled = !py_runner.is_ready();
  elements.status.textContent = "File loaded. Ready to grade.";
}

async function score_submission(session: GraderSession): Promise<GradeReport> {
  assert(session.source != null, "score_submission: no submission loaded");
  const { config } = session;
  const source = session.source;

  const results: RunResult[] = [];
  for (let index = 0; index < config.cases.length; index++) {
    const stdin_lines = config.cases[index].stdin_lines;
    results.push(await py_runner.run(source, stdin_lines, { filename: config.filename }));
  }
  assert(results.length === config.cases.length, "score_submission: one result per case");

  const criteria = config.build_criteria(results);
  assert_array(criteria, "build_criteria() result", CRITERION_COUNT_MAX);
  return rubric.grade(criteria, { source, results });
}

/**
 * A submission that does not compile scores zero by assignment policy, so the
 * syntax probe gates everything: there is no point diffing the output of a
 * program that never ran.
 */
async function grade_submission(session: GraderSession): Promise<void> {
  assert(session.source != null, "grade_submission: no submission loaded");
  assert(py_runner.is_ready(), "grade_submission: Python runtime is not ready");
  const { config, elements } = session;
  reset_output(session);

  const probe = await py_runner.run(session.source, config.cases[0].stdin_lines, {
    filename: config.filename,
  });
  const has_syntax_error = probe.err.startsWith(SYNTAX_PREFIX);
  const rows: RubricRow[] = [row_for_syntax(probe)];

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
 * Falls back to the legacy selection copy, because a browser may refuse the
 * async clipboard on a page opened over `file://`.
 */
async function copy_summary(session: GraderSession): Promise<void> {
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

function wire_file_input(session: GraderSession): void {
  assert(session != null, "wire_file_input: session must not be null");
  const { elements } = session;

  elements.drop.addEventListener("click", () => elements.file.click());
  elements.file.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
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
    const transfer = (event as DragEvent).dataTransfer;
    void accept_file(session, transfer?.files[0]);
  });
}

function wire_buttons(session: GraderSession): void {
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

async function boot(session: GraderSession): Promise<void> {
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

function resolve_mount(mount: HTMLElement | string | undefined): HTMLElement {
  if (mount == null) return document.body;
  if (typeof mount === "string") {
    const found = document.querySelector(mount);
    assert(found != null, `init: no element matches the mount selector "${mount}"`);
    return found as HTMLElement;
  }
  assert(mount instanceof HTMLElement, "init: mount must be an element or a selector");
  return mount;
}

/**
 * Detection is by the grade button: a hand-written page that carries the
 * elements keeps them, and everything else gets the generated skeleton, so an
 * assignment page is a title, a stylesheet, and its data.
 */
function ensure_page(config: GraderConfig, ids: ElementIds): boolean {
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
export function init(config: GraderConfig): void {
  check_config(config);
  const ids: ElementIds = { ...ELEMENT_IDS_DEFAULT, ...(config.element_ids ?? {}) };
  ensure_page(config, ids);
  const session: GraderSession = {
    config,
    elements: resolve_elements(ids),
    manual_rows: config.manual_rows ?? [],
    source: null,
    grading: false,
  };

  wire_file_input(session);
  wire_buttons(session);
  void boot(session);
  assert(
    session.source === null,
    "init: no submission may be loaded before the student picks one",
  );
}
