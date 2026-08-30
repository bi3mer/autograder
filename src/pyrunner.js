/**
 * Pyodide-backed Python runner.
 *
 * Loads the CPython-in-WebAssembly runtime once, then feeds it a source file
 * plus canned stdin lines and hands back stdout, errors, and the prompts that
 * fired. Nothing here knows about any assignment's rubric: pages call `run`
 * and `lint` and score the result themselves.
 *
 * The page must load Pyodide before calling `init`, either by adding
 * `<script src=".../pyodide.js">` (which defines the global `loadPyodide`)
 * or by passing a `load_pyodide` function to `init`.
 */

import { assert, assert_array, assert_range, assert_string } from "./assert.js";
import {
  FILENAME_CHARS_MAX, LINE_COUNT_MAX, LINE_LENGTH_CHARS_DEFAULT, LINE_LENGTH_CHARS_MAX,
  LINT_FILENAME, LINT_FINDING_COUNT_MAX, OUTPUT_BYTES_MAX, RUN_TIMEOUT_MS,
  RUN_TIMEOUT_MS_MAX, SOURCE_BYTES_MAX, STDIN_LINE_COUNT_MAX,
  SUBMISSION_FILENAME_DEFAULT, TRACE_CHECK_INTERVAL_EVENTS,
} from "./constants.js";

/**
 * The shapes this module hands back, all plain objects:
 *
 * - `run` returns `{ out, err, prompts, kind, line, col }`: captured stdout
 *   including echoed input prompts, then `""` or `"SYNTAX:<message>"` or
 *   `"RUNTIME:<message>"`, then the prompt strings `input()` was called with,
 *   in order. `kind` names the failure more finely than the two `err` prefixes
 *   can (`""`, `"syntax"`, `"runtime"`, `"input"`, `"timeout"`, `"output"`),
 *   and `line` and `col` are where in the submission it happened, or `null`.
 *   The prefixes stay two-valued because a syntax error is the only one the
 *   rubric treats differently; `kind` is what an editor reads to put a cursor
 *   on the offending line.
 * - `init` takes `{ on_status, load_pyodide }` (a progress sink for the page's
 *   status line, and a loader that defaults to the global `loadPyodide` from
 *   Pyodide's own script tag) and returns `{ ready, flake8_ready, flake8_error }`,
 *   where `flake8_error` says why flake8 is unavailable and is `""` when it is.
 */

/**
 * `run` and `lint` assert against the state rather than trusting the caller
 * to have awaited `init`: calling into a half-loaded interpreter fails deep
 * inside Pyodide with an unreadable message. It is one of `"idle"`,
 * `"loading"`, `"ready"`, or `"failed"`.
 */
let state = "idle";

/** Every `kind` the driver below can report; `run` checks its result against it. */
const KINDS_ALLOWED = ["", "syntax", "runtime", "input", "timeout", "output"];

/** The Pyodide interpreter, `null` until `init` resolves. */
let pyodide = null;
let flake8_ready = false;
let flake8_error = "";

/**
 * Reads flake8's structured `manager.results` rather than its stdout
 * formatter: the formatter writes through `sys.stdout.buffer`, which does
 * not exist under the captured `io.StringIO` stream `run` installs.
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
 * Embed a JS value as a Python string literal holding JSON.
 *
 * `JSON.stringify` twice: the outer call produces the Python literal, whose
 * decoded value is itself JSON text that `json.loads()` parses back into the
 * real string or list. Encoding once and leaning on Python's own string
 * literal parsing looks equivalent, but mangles surrogate pairs and breaks
 * any consumer that then calls `json.loads` on the value.
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

function check_filename(filename) {
  const name = assert_string(filename, "filename", FILENAME_CHARS_MAX);
  assert(name.length > 0, "filename must not be empty");
  assert(!name.includes("/") && !name.includes("\\"), `filename must not contain a path: ${name}`);
  return name;
}

/**
 * Failure here is a degraded mode, not a crash: `regex_lint` covers the
 * common findings, so a student on a flaky network still gets graded. The
 * reason is kept in `flake8_error` so the page can say which engine ran.
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
 * Load the Python runtime. Call once, and await it before `run`.
 *
 * A Pyodide that fails to load throws: the page cannot grade without it, so
 * this one is fatal rather than degraded.
 */
export async function init(options = {}) {
  assert(options != null && typeof options === "object", "init: options must be an object");
  assert(state === "idle" || state === "failed", `init: already ${state}; call init() once`);
  const on_status = options.on_status ?? (() => {});
  assert(typeof on_status === "function", "init: on_status must be a function");
  const load = options.load_pyodide ?? globalThis.loadPyodide;
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

export function is_ready() {
  return state === "ready" && pyodide != null;
}

/** False means `lint` will throw and `regex_lint` is the only option. */
export function is_flake8_ready() {
  return flake8_ready;
}

/** `""` when flake8 is available. */
export function flake8_failure_reason() {
  return flake8_error;
}

/**
 * Build the Python driver that runs one submission under fake stdin.
 *
 * `input()` is replaced so it writes `prompt + typed value + "\n"` to stdout,
 * which is what a real terminal session looks like. That lets the caller diff
 * a whole transcript and separately inspect which prompts fired.
 *
 * Most of the rest exists so a beginner reads their own mistake rather than
 * this file's internals. `linecache` is primed because a submission compiled
 * from a string has no file for Python to quote a frame's source line out of.
 * The traceback is rebuilt from only the frames belonging to the submission,
 * because the raw one opens with the `exec` call below. Running out of stdin
 * becomes one sentence instead of a chained `StopIteration` and `EOFError`,
 * which is the most common way a first attempt fails here. And the watchdog
 * stops a loop that never ends, which would otherwise freeze the tab: Pyodide
 * runs on the page's only thread, so there is nothing left to cancel it with.
 */
function build_run_python(code, stdin_lines, filename, timeout_ms) {
  assert(typeof code === "string", "build_run_python: code must be a string");
  assert(Array.isArray(stdin_lines), "build_run_python: stdin_lines must be an array");
  assert_range(timeout_ms, "build_run_python: timeout_ms", 1, RUN_TIMEOUT_MS_MAX);
  return `
import sys, io, json, time, builtins, traceback, linecache

_name = ${JSON.stringify(filename)}
_src = json.loads(${embed(code)})
linecache.cache[_name] = (len(_src), None, _src.splitlines(True), _name)

class _OutOfInput(Exception):
    def __init__(self, asked, have):
        self.asked = asked
        self.have = have

class _TookTooLong(Exception):
    pass

class _TooMuchOutput(Exception):
    pass

class _BoundedOut(io.StringIO):
    """Stops a print loop from growing the capture past what can be shipped."""
    def write(self, text):
        if self.tell() > ${OUTPUT_BYTES_MAX}:
            raise _TooMuchOutput()
        return io.StringIO.write(self, text)

_stdin = json.loads(${embed(stdin_lines)})
_lines = iter(_stdin)
_prompts = []
_asked = [0]

def _fake_input(prompt=""):
    _asked[0] += 1
    try:
        _val = next(_lines)
    except StopIteration:
        # \`from None\` drops the StopIteration chain: what went wrong is that the
        # program asked for input nobody supplied, not that an iterator ended.
        raise _OutOfInput(_asked[0], len(_stdin)) from None
    _prompts.append(prompt)
    sys.stdout.write(prompt + _val + "\\n")
    return _val

builtins.input = _fake_input

# Reading the clock on every line costs more than the check saves, so the
# counter samples it instead.
_deadline = time.monotonic() + ${timeout_ms} / 1000.0
_events = [0]

def _watchdog(frame, event, arg):
    _events[0] += 1
    if _events[0] % ${TRACE_CHECK_INTERVAL_EVENTS} == 0 and time.monotonic() > _deadline:
        raise _TookTooLong()
    return _watchdog

def _own_frames():
    return [f for f in traceback.extract_tb(sys.exc_info()[2]) if f.filename == _name]

_out = _BoundedOut()
_old = sys.stdout
sys.stdout = _out
_err = ""
_kind = ""
_line = None
_col = None
try:
    _code = compile(_src, _name, "exec")
    sys.settrace(_watchdog)
    try:
        exec(_code, {"__name__": "__main__"})
    finally:
        sys.settrace(None)
except SyntaxError as _e:
    # str(e) throws away the source line and the caret that point at the typo.
    _kind = "syntax"
    _line = _e.lineno
    _col = _e.offset
    _err = "SYNTAX:" + "".join(traceback.format_exception_only(type(_e), _e))
except _OutOfInput as _e:
    _kind = "input"
    _frames = _own_frames()
    if _frames:
        _line = _frames[-1].lineno
    _err = ("RUNTIME:Your program called input() %d time(s), but this run only "
            "supplies %d line(s) of input." % (_e.asked, _e.have))
except _TookTooLong:
    _kind = "timeout"
    _err = ("RUNTIME:Your program was still running after ${timeout_ms} ms, so it was "
            "stopped. Look for a loop that never ends.")
except _TooMuchOutput:
    _kind = "output"
    _err = ("RUNTIME:Your program printed more than ${OUTPUT_BYTES_MAX} characters, so it "
            "was stopped. Look for a print inside a loop that never ends.")
except SystemExit:
    # exit() and sys.exit() are how a beginner ends a program on purpose.
    pass
except BaseException as _e:
    _kind = "runtime"
    _frames = _own_frames()
    if _frames:
        _line = _frames[-1].lineno
    _err = ("RUNTIME:Traceback (most recent call last):\\n"
            + "".join(traceback.format_list(_frames))
            + "".join(traceback.format_exception_only(type(_e), _e)))
finally:
    sys.stdout = _old
json.dumps({"out": _out.getvalue(), "err": _err, "prompts": _prompts,
            "kind": _kind, "line": _line, "col": _col})
`;
}

/**
 * Run a submission against one set of canned stdin lines.
 *
 * A student program that raises is not an error here: the traceback comes
 * back in `err` and the rubric decides what it costs. Only a broken runner
 * throws.
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
  const timeout_ms = assert_range(
    options.timeout_ms ?? RUN_TIMEOUT_MS, "run: timeout_ms", 1, RUN_TIMEOUT_MS_MAX,
  );

  assert(pyodide != null, "run: interpreter must be loaded");
  const encoded = await pyodide.runPythonAsync(
    build_run_python(code, stdin_lines, filename, timeout_ms),
  );
  assert(typeof encoded === "string", "run: driver must return a JSON string");
  const result = JSON.parse(encoded);

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
  assert(KINDS_ALLOWED.includes(result.kind), `run: unknown kind ${result.kind}`);
  // A run either failed and said how, or succeeded and said nothing. One
  // without the other means the driver fell through a branch.
  assert(
    (result.kind === "") === (result.err === ""),
    `run: kind "${result.kind}" and err must agree`,
  );
  assert(
    result.line === null || (Number.isInteger(result.line) && result.line > 0),
    `run: line must be a positive integer or null, got ${result.line}`,
  );
  assert(
    result.col === null || (Number.isInteger(result.col) && result.col >= 0),
    `run: col must be a non-negative integer or null, got ${result.col}`,
  );
  return result;
}

/**
 * Lint a submission with real flake8, returning `"L<line>:<col> <code> <text>"`
 * findings. Throws when flake8 is unavailable; call `regex_lint` instead.
 *
 * The path flake8 lints is `LINT_FILENAME`, not a caller's choice: it is a
 * scratch file in Pyodide's filesystem that no finding ever names.
 */
export async function lint(code, options = {}) {
  assert(is_ready(), "lint: called before init() resolved");
  assert(flake8_ready, `lint: flake8 unavailable (${flake8_error || "not installed"})`);
  assert_string(code, "lint: code", SOURCE_BYTES_MAX);
  assert(options != null && typeof options === "object", "lint: options must be an object");
  const filename = check_filename(LINT_FILENAME);
  const max_line_length_chars = assert_range(
    options.max_line_length_chars ?? LINE_LENGTH_CHARS_DEFAULT,
    "lint: max_line_length_chars", 1, LINE_LENGTH_CHARS_MAX,
  );

  assert(pyodide != null, "lint: interpreter must be loaded");
  const encoded = await pyodide.runPythonAsync(`
import json
_findings = _pyrunner_lint(
    json.loads(${embed(code)}), ${JSON.stringify(filename)}, ${max_line_length_chars}
)
json.dumps(_findings)
`);
  assert(typeof encoded === "string", "lint: bootstrap must return a JSON string");
  // Each finding is `{ code, line, col, text }`, straight from the bootstrap.
  const findings = assert_array(JSON.parse(encoded), "lint: findings", LINT_FINDING_COUNT_MAX);

  const formatted = [];
  for (let index = 0; index < findings.length; index++) {
    const finding = findings[index];
    assert(typeof finding.code === "string", `lint: findings[${index}].code must be a string`);
    formatted.push(`L${finding.line}:${finding.col} ${finding.code} ${finding.text}`);
  }
  assert(formatted.length === findings.length, "lint: one formatted line per finding");
  return formatted;
}

/**
 * Fallback used only when flake8 failed to install, in the same shape `lint`
 * returns. It covers the four findings that dominate first-year submissions:
 * tabs, trailing whitespace, long lines, and bare `except:`. It is
 * deliberately not a reimplementation of pycodestyle.
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
