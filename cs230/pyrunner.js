// pyrunner.js
// Generic Pyodide-backed Python runner: load the runtime once, then feed it
// a source file plus canned stdin lines and get back stdout/errors/prompts.
// Nothing here knows about any specific assignment's rubric — assignment
// pages call PyRunner.run()/lint() and grade the result themselves.
//
// Requires <script src=".../pyodide.js"></script> (for global loadPyodide)
// to be loaded before this file.
const PyRunner = (() => {
  let pyodide = null;
  let ready = false;
  let flake8Ready = false;

  // Embed an arbitrary JS string/array as Python source text safely, for any
  // unicode content (including astral chars/surrogate pairs): JSON.stringify
  // twice so the template splice becomes a Python string *literal* whose
  // decoded value is itself JSON text, then json.loads() on the Python side
  // parses that text into the real string/list. (Single-encoding and relying
  // on Python's own string-literal parsing looks like it works but breaks
  // json.loads-based consumers and mishandles surrogate pairs.)
  function embed(value) {
    return JSON.stringify(JSON.stringify(value));
  }

  async function init({ onStatus, maxLineLength = 99 } = {}) {
    onStatus?.("Loading Python runtime…");
    pyodide = await loadPyodide();
    ready = true;
    try {
      onStatus?.("Installing flake8…");
      await pyodide.loadPackage("micropip");
      const micropip = pyodide.pyimport("micropip");
      // flake8 pulls in pyflakes, pycodestyle, and mccabe as pure-Python wheels.
      await micropip.install("flake8");
      // Warm the API and expose a reusable linter that reads structured
      // results (mgr.results) rather than flake8's stdout formatter, which
      // needs sys.stdout.buffer and would crash under a captured stream.
      await pyodide.runPythonAsync(`
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
`);
      flake8Ready = true;
      onStatus?.("Ready.");
    } catch (e) {
      flake8Ready = false;
      onStatus?.("Ready (flake8 unavailable — falling back to built-in style checks).");
    }
    return { ready, flake8Ready };
  }

  function isReady() {
    return ready;
  }

  function isFlake8Ready() {
    return flake8Ready;
  }

  // Run `code` (a Python source string) feeding `stdinLines` (array of
  // strings) to successive input() calls. Mimics a real terminal session by
  // having input() write "prompt + typed value\n" to stdout, so callers can
  // both compare full transcripts and inspect exactly which prompts fired
  // (result.prompts).
  //
  // Returns { out, err, prompts }:
  //   out      - captured stdout
  //   err      - "" | "SYNTAX:<msg>" | "RUNTIME:<traceback>"
  //   prompts  - array of the prompt strings passed to input(), in order
  async function run(code, stdinLines, { filename = "submission.py" } = {}) {
    if (!ready) throw new Error("PyRunner.run() called before PyRunner.init() resolved.");
    const escaped = embed(code);
    const feed = embed(stdinLines);
    const fname = JSON.stringify(filename);
    const py = `
import sys, io, json, builtins, traceback
_lines = iter(json.loads(${feed}))
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
    exec(compile(json.loads(${escaped}), ${fname}, "exec"), {"__name__": "__main__"})
except SyntaxError as e:
    _err = "SYNTAX:" + str(e)
except Exception:
    _err = "RUNTIME:" + traceback.format_exc()
finally:
    sys.stdout = _old
json.dumps({"out": _out.getvalue(), "err": _err, "prompts": _prompts})
`;
    const res = await pyodide.runPythonAsync(py);
    return JSON.parse(res);
  }

  // Real flake8 findings as "L<line>:<col> <code> <text>" strings.
  async function lint(code, { filename = "submission.py", maxLineLength = 99 } = {}) {
    if (!flake8Ready) throw new Error("PyRunner.lint() called but flake8 isn't available.");
    const py = `
import json
json.dumps(_pyrunner_lint(json.loads(${embed(code)}), ${JSON.stringify(filename)}, ${maxLineLength}))
`;
    const proxy = await pyodide.runPythonAsync(py);
    return JSON.parse(proxy).map((f) => `L${f.line}:${f.col} ${f.code} ${f.text}`);
  }

  // Regex-based fallback style checks, used only if flake8 failed to load.
  function regexLint(code) {
    const lines = code.replace(/\r/g, "").split("\n");
    const detail = [];
    lines.forEach((ln, i) => {
      const n = i + 1;
      if (/\t/.test(ln)) detail.push(`L${n}: W191 indentation contains tabs`);
      if (/[ \t]+$/.test(ln)) detail.push(`L${n}: W291 trailing whitespace`);
      if (ln.length > 99) detail.push(`L${n}: E501 line too long (${ln.length} > 99)`);
    });
    if (/except\s*:/.test(code)) detail.push("E722 do not use bare 'except'");
    return detail;
  }

  return { init, run, lint, regexLint, isReady, isFlake8Ready };
})();
