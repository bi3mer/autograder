/**
 * Pyodide-backed Python runner.
 *
 * Loads the CPython-in-WebAssembly runtime once, then feeds it a source
 * file plus canned stdin lines and hands back stdout, errors, and the
 * prompts that fired. Nothing here knows about any assignment's rubric:
 * pages call {@link run} and {@link lint} and score the result themselves.
 *
 * The page must load Pyodide before calling {@link init}, either by adding
 * `<script src=".../pyodide.js">` (which defines the global `loadPyodide`)
 * or by passing a `load_pyodide` function to {@link init}.
 *
 * @module py_runner
 */

import { assert, assert_array, assert_range, assert_string } from "./assert.js";
import {
  FILENAME_CHARS_MAX, LINE_COUNT_MAX, LINE_LENGTH_CHARS_DEFAULT, LINE_LENGTH_CHARS_MAX,
  LINT_FINDING_COUNT_MAX, SOURCE_BYTES_MAX, STDIN_LINE_COUNT_MAX, SUBMISSION_FILENAME_DEFAULT,
} from "./constants.js";

/**
 * @typedef {object} RunResult
 * @property {string} out Captured stdout, including echoed input prompts.
 * @property {string} err `""`, `"SYNTAX:<message>"`, or `"RUNTIME:<traceback>"`.
 * @property {string[]} prompts Prompt strings passed to `input()`, in order.
 */

/**
 * @typedef {object} InitResult
 * @property {boolean} ready Whether the Python runtime loaded.
 * @property {boolean} flake8_ready Whether real flake8 is available.
 * @property {string} flake8_error Why flake8 is unavailable, `""` if it is.
 */

/**
 * Runner lifecycle. `run` and `lint` assert against it rather than trusting
 * the caller to have awaited {@link init}: calling into a half-loaded
 * interpreter fails deep inside Pyodide with an unreadable message.
 *
 * @typedef {"idle" | "loading" | "ready" | "failed"} RunnerState
 */

/** @type {RunnerState} */
let state = "idle";

/** @type {any} The loaded Pyodide interpreter, `null` until ready. */
let pyodide = null;

/** @type {boolean} Whether the flake8 wheel installed and warmed up. */
let flake8_ready = false;

/** @type {string} Why flake8 is unavailable; `""` when it is available. */
let flake8_error = "";

/**
 * Python side of {@link lint}.
 *
 * Reads flake8's structured `manager.results` rather than its stdout
 * formatter: the formatter writes through `sys.stdout.buffer`, which does
 * not exist under the captured `io.StringIO` stream {@link run} installs.
 */
const LINT_BOOTSTRAP_PYTHON = `
from flake8.api.legacy import get_style_guide

def _pyrunner_lint(src, filename, max_line_length):
    with open(filename, "w") as fh:
        fh.write(src)
    sg = get_style_guide(max_line_length=max_line_length)
    app = sg._application
    app.initialize([filename])
    app.make_file_checker_manager([filename])
    app.run_checks()
    out = []
    for _fname, res, _stats in app.file_checker_manager.results:
        for (code, line, col, text, _physical) in res:
            out.append({"code": code, "line": line, "col": col + 1, "text": text})
    out.sort(key=lambda d: (d["line"], d["col"]))
    return out
`;

/**
 * Embed a JS string or array as a Python string literal holding JSON.
 *
 * `JSON.stringify` twice: the outer call produces the Python literal, whose
 * decoded value is itself JSON text that `json.loads()` parses back into the
 * real string or list. Encoding once and leaning on Python's own string
 * literal parsing looks equivalent, but mangles surrogate pairs and breaks
 * any consumer that then calls `json.loads` on the value.
 *
 * @param {string | string[]} value Value to hand to Python.
 * @returns {string} A Python source fragment: a quoted JSON string literal.
 */
function embed(value) {
  assert(
    typeof value === "string" || Array.isArray(value),
    "embed: value must be a string or array",
  );
  const encoded = JSON.stringify(JSON.stringify(value));
  assert(
    typeof encoded === "string" && encoded.length >= 2,
    "embed: encoding must produce a literal",
  );
  return encoded;
}

/**
 * Validate a filename the submission is compiled under.
 *
 * @param {unknown} filename Candidate filename.
 * @returns {string} The filename, bounded and free of path separators.
 */
function check_filename(filename) {
  const name = assert_string(filename, "filename", FILENAME_CHARS_MAX);
  assert(name.length > 0, "filename must not be empty");
  assert(!name.includes("/") && !name.includes("\\"), `filename must not contain a path: ${name}`);
  return name;
}

/**
 * Install flake8 into the running interpreter and warm up its API.
 *
 * Failure here is a degraded mode, not a crash: {@link regex_lint} covers
 * the common findings, so a student on a flaky network still gets graded.
 * The reason is kept in `flake8_error` so the page can say which engine ran.
 *
 * @param {(message: string) => void} on_status Progress sink.
 * @returns {Promise<void>} Resolves once flake8 is ready or has been ruled out.
 */
async function install_flake8(on_status) {
  assert(typeof on_status === "function", "install_flake8: on_status must be a function");
  assert(pyodide != null, "install_flake8: interpreter must be loaded first");
  try {
    on_status("Installing flake8…");
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    // flake8 pulls pyflakes, pycodestyle, and mccabe, all pure-Python wheels.
    await micropip.install("flake8");
    await pyodide.runPythonAsync(LINT_BOOTSTRAP_PYTHON);
    flake8_ready = true;
    flake8_error = "";
  } catch (error) {
    flake8_ready = false;
    flake8_error = error instanceof Error ? error.message : String(error);
    assert(flake8_error.length > 0, "install_flake8: a failure must carry a reason");
  }
}

/**
 * Load the Python runtime. Call once, and await it before {@link run}.
 *
 * @param {object} [options] Initialization options.
 * @param {(message: string) => void} [options.on_status] Progress sink, called
 *   with human-readable stage names for the page's status line.
 * @param {() => Promise<any>} [options.load_pyodide] Loader override; defaults
 *   to the global `loadPyodide` defined by Pyodide's own script tag.
 * @returns {Promise<InitResult>} Which engines came up.
 * @throws {Error} If Pyodide itself fails to load; the page cannot grade
 *   without it, so this one is fatal rather than degraded.
 */
export async function init(options = {}) {
  assert(options != null && typeof options === "object", "init: options must be an object");
  assert(state === "idle" || state === "failed", `init: already ${state}; call init() once`);
  const on_status = options.on_status ?? (() => {});
  assert(typeof on_status === "function", "init: on_status must be a function");
  const load = options.load_pyodide ?? /** @type {any} */ (globalThis).loadPyodide;
  assert(typeof load === "function", "init: loadPyodide is undefined; load pyodide.js first");

  state = "loading";
  on_status("Loading Python runtime…");
  try {
    pyodide = await load();
  } catch (error) {
    state = "failed";
    throw error;
  }
  assert(pyodide != null, "init: loader resolved without an interpreter");
  state = "ready";

  await install_flake8(on_status);
  on_status(flake8_ready ? "Ready." : "Ready (flake8 unavailable — using built-in style checks).");
  return { ready: true, flake8_ready, flake8_error };
}

/**
 * Is the Python runtime loaded and usable?
 *
 * @returns {boolean} True once {@link init} has resolved successfully.
 */
export function is_ready() {
  return state === "ready" && pyodide != null;
}

/**
 * Is real flake8 available, as opposed to the regex fallback?
 *
 * @returns {boolean} True when {@link lint} may be called.
 */
export function is_flake8_ready() {
  return flake8_ready;
}

/**
 * Why flake8 is unavailable.
 *
 * @returns {string} The failure reason, or `""` when flake8 is available.
 */
export function flake8_failure_reason() {
  return flake8_error;
}

/**
 * Build the Python driver that runs one submission under fake stdin.
 *
 * `input()` is replaced so it writes `prompt + typed value + "\n"` to
 * stdout, which is what a real terminal session looks like. That lets the
 * caller diff a whole transcript and separately inspect which prompts fired.
 *
 * @param {string} code Submission source.
 * @param {string[]} stdin_lines Values successive `input()` calls receive.
 * @param {string} filename Name the source is compiled under.
 * @returns {string} Python source producing a JSON {@link RunResult}.
 */
function build_run_python(code, stdin_lines, filename) {
  assert(typeof code === "string", "build_run_python: code must be a string");
  assert(Array.isArray(stdin_lines), "build_run_python: stdin_lines must be an array");
  return `
import sys, io, json, builtins, traceback
_lines = iter(json.loads(${embed(stdin_lines)}))
_prompts = []
def _fake_input(prompt=""):
    try:
        _val = next(_lines)
    except StopIteration:
        raise EOFError("no more input")
    _prompts.append(prompt)
    sys.stdout.write(prompt + _val + "\\n")
    return _val
builtins.input = _fake_input
_out = io.StringIO()
_old = sys.stdout
sys.stdout = _out
_err = ""
try:
    _code = compile(json.loads(${embed(code)}), ${JSON.stringify(filename)}, "exec")
    exec(_code, {"__name__": "__main__"})
except SyntaxError as e:
    _err = "SYNTAX:" + str(e)
except Exception:
    _err = "RUNTIME:" + traceback.format_exc()
finally:
    sys.stdout = _old
json.dumps({"out": _out.getvalue(), "err": _err, "prompts": _prompts})
`;
}

/**
 * Run a submission against one set of canned stdin lines.
 *
 * A student program that raises is not an error here: the traceback comes
 * back in `err` and the rubric decides what it costs. Only a broken runner
 * throws.
 *
 * @param {string} code Submission source.
 * @param {string[]} stdin_lines Values fed to successive `input()` calls.
 * @param {object} [options] Run options.
 * @param {string} [options.filename="submission.py"] Name shown in tracebacks.
 * @returns {Promise<RunResult>} Captured stdout, error text, and prompts.
 * @throws {Error} If called before {@link init} resolved.
 */
export async function run(code, stdin_lines, options = {}) {
  assert(is_ready(), "run: called before init() resolved");
  assert_string(code, "run: code", SOURCE_BYTES_MAX);
  assert_array(stdin_lines, "run: stdin_lines", STDIN_LINE_COUNT_MAX);
  assert(options != null && typeof options === "object", "run: options must be an object");
  for (let index = 0; index < stdin_lines.length; index++) {
    assert_string(stdin_lines[index], `run: stdin_lines[${index}]`, LINE_COUNT_MAX);
  }
  const filename = check_filename(options.filename ?? SUBMISSION_FILENAME_DEFAULT);

  const encoded = await pyodide.runPythonAsync(build_run_python(code, stdin_lines, filename));
  assert(typeof encoded === "string", "run: driver must return a JSON string");
  const result = /** @type {RunResult} */ (JSON.parse(encoded));

  assert(typeof result.out === "string", "run: out must be a string");
  assert(typeof result.err === "string", "run: err must be a string");
  assert(Array.isArray(result.prompts), "run: prompts must be an array");
  assert(
    result.prompts.length <= stdin_lines.length,
    "run: cannot prompt more times than stdin has lines",
  );
  assert(
    result.err === "" || result.err.startsWith("SYNTAX:") || result.err.startsWith("RUNTIME:"),
    `run: err must be empty or tagged, got ${result.err.slice(0, 40)}`,
  );
  return result;
}

/**
 * Lint a submission with real flake8.
 *
 * @param {string} code Submission source.
 * @param {object} [options] Lint options.
 * @param {string} [options.filename="submission.py"] Name flake8 reports on.
 * @param {number} [options.max_line_length_chars=99] Line-length ceiling.
 * @returns {Promise<string[]>} Findings as `"L<line>:<col> <code> <text>"`.
 * @throws {Error} If flake8 is unavailable; call {@link regex_lint} instead.
 */
export async function lint(code, options = {}) {
  assert(is_ready(), "lint: called before init() resolved");
  assert(flake8_ready, `lint: flake8 unavailable (${flake8_error || "not installed"})`);
  assert_string(code, "lint: code", SOURCE_BYTES_MAX);
  assert(options != null && typeof options === "object", "lint: options must be an object");
  const filename = check_filename(options.filename ?? SUBMISSION_FILENAME_DEFAULT);
  const max_line_length_chars = assert_range(
    options.max_line_length_chars ?? LINE_LENGTH_CHARS_DEFAULT,
    "lint: max_line_length_chars", 1, LINE_LENGTH_CHARS_MAX,
  );

  const encoded = await pyodide.runPythonAsync(`
import json
_findings = _pyrunner_lint(
    json.loads(${embed(code)}), ${JSON.stringify(filename)}, ${max_line_length_chars}
)
json.dumps(_findings)
`);
  assert(typeof encoded === "string", "lint: bootstrap must return a JSON string");
  const findings = assert_array(JSON.parse(encoded), "lint: findings", LINT_FINDING_COUNT_MAX);

  /** @type {string[]} */
  const formatted = [];
  for (let index = 0; index < findings.length; index++) {
    /** @type {{ code: string, line: number, col: number, text: string }} */
    const finding = findings[index];
    assert(typeof finding.code === "string", `lint: findings[${index}].code must be a string`);
    formatted.push(`L${finding.line}:${finding.col} ${finding.code} ${finding.text}`);
  }
  assert(formatted.length === findings.length, "lint: one formatted line per finding");
  return formatted;
}

/**
 * Regex fallback for the findings flake8 would have caught, used only when
 * flake8 failed to install.
 *
 * It covers the four findings that dominate first-year submissions: tabs,
 * trailing whitespace, long lines, and bare `except:`. It is deliberately
 * not a reimplementation of pycodestyle.
 *
 * @param {string} code Submission source.
 * @param {object} [options] Lint options.
 * @param {number} [options.max_line_length_chars=99] Line-length ceiling.
 * @returns {string[]} Findings, in the same shape {@link lint} returns.
 */
export function regex_lint(code, options = {}) {
  assert_string(code, "regex_lint: code", SOURCE_BYTES_MAX);
  assert(options != null && typeof options === "object", "regex_lint: options must be an object");
  const max_line_length_chars = assert_range(
    options.max_line_length_chars ?? LINE_LENGTH_CHARS_DEFAULT,
    "regex_lint: max_line_length_chars", 1, LINE_LENGTH_CHARS_MAX,
  );

  const lines = code.replace(/\r/g, "").split("\n");
  assert(lines.length <= LINE_COUNT_MAX, `regex_lint: code exceeds ${LINE_COUNT_MAX} lines`);
  /** @type {string[]} */
  const findings = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const number = index + 1;
    // W191 is about indentation specifically, matching flake8: a tab inside a
    // string literal is not a style finding, a tab before the first token is.
    if (/^[ \t]*\t/.test(line)) findings.push(`L${number}:1 W191 indentation contains tabs`);
    if (/[ \t]+$/.test(line)) findings.push(`L${number}:1 W291 trailing whitespace`);
    if (line.length > max_line_length_chars) {
      findings.push(`L${number}:${max_line_length_chars + 1} E501 line too long ` +
        `(${line.length} > ${max_line_length_chars})`);
    }
    if (/^\s*except\s*:/.test(line)) findings.push(`L${number}:1 E722 do not use bare 'except'`);
  }

  assert(findings.length <= lines.length * 4, "regex_lint: at most four findings per line");
  return findings;
}
