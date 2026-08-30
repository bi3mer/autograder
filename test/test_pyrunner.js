/**
 * The Pyodide runner, without Pyodide.
 *
 * Real Pyodide needs a browser, but almost nothing in this module is Pyodide:
 * it is state guards, JSON encoding on the way in, and result assertions on
 * the way out. A fake interpreter that records the Python it is handed covers
 * all of it, and `regex_lint` needs no interpreter at all.
 *
 * The module keeps its interpreter in module-level state, and `init` may only
 * run once, so each scenario imports a fresh copy rather than sharing one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../src/assert.js";
import { RUN_TIMEOUT_MS, RUN_TIMEOUT_MS_MAX } from "../src/constants.js";
import { LINE_LENGTH_CHARS_DEFAULT } from "../src/constants.js";

const PYRUNNER_URL = new URL("../src/pyrunner.js", import.meta.url).href;
let instance_count = 0;

/** A module instance nobody else has initialised. The query defeats the ESM cache. */
function fresh_runner() {
  instance_count++;
  return import(`${PYRUNNER_URL}?instance=${instance_count}`);
}

/**
 * Stands in for the interpreter: records every Python source it is given and
 * answers with `reply`, so the driver the runner builds is inspectable and
 * the result it parses is ours to choose.
 */
function fake_interpreter(reply = () => undefined, options = {}) {
  const python = [];
  return {
    python,
    async loadPackage(name) {
      if (options.flake8_error != null) throw new Error(options.flake8_error);
      python.push(`loadPackage:${name}`);
    },
    pyimport(name) {
      python.push(`pyimport:${name}`);
      return { install: async (pkg) => { python.push(`install:${pkg}`); } };
    },
    async runPythonAsync(source) {
      python.push(source);
      return reply(source);
    },
  };
}

/** A fresh runner already through `init`, plus the interpreter behind it. */
async function ready_runner(reply, options) {
  const py_runner = await fresh_runner();
  const interpreter = fake_interpreter(reply, options);
  const result = await py_runner.init({ load_pyodide: async () => interpreter });
  return { py_runner, interpreter, result };
}

/**
 * Answers the run driver with one canned result and the lint bootstrap with
 * findings. The fields a caller leaves out default to a clean run, so a test
 * about stdout does not have to spell out `kind`, `line`, and `col`.
 */
function canned(run_result, findings = []) {
  const reply = { kind: "", line: null, col: null, ...run_result };
  return (source) => (source.includes("_pyrunner_lint(")
    ? JSON.stringify(findings)
    : (source.includes('json.dumps({"out"') ? JSON.stringify(reply) : undefined));
}

test("a fresh runner is idle: not ready, no flake8, no reason yet", async () => {
  const py_runner = await fresh_runner();
  assert.equal(py_runner.is_ready(), false);
  assert.equal(py_runner.is_flake8_ready(), false);
  assert.equal(py_runner.flake8_failure_reason(), "");
});

test("run before init trips an assertion", async () => {
  const py_runner = await fresh_runner();
  await assert.rejects(() => py_runner.run("print(1)", []), AssertionError);
});

test("lint before init trips an assertion", async () => {
  const py_runner = await fresh_runner();
  await assert.rejects(() => py_runner.lint("print(1)"), AssertionError);
});

test("init needs a loader, and says which one is missing", async () => {
  const py_runner = await fresh_runner();
  await assert.rejects(() => py_runner.init(), /loadPyodide is undefined; load pyodide.js first/);
});

test("init loads the interpreter and installs flake8", async () => {
  const { py_runner, interpreter, result } = await ready_runner();
  assert.deepEqual(result, { ready: true, flake8_ready: true, flake8_error: "" });
  assert.equal(py_runner.is_ready(), true);
  assert.equal(py_runner.is_flake8_ready(), true);
  assert.deepEqual(interpreter.python.slice(0, 3), [
    "loadPackage:micropip", "pyimport:micropip", "install:flake8",
  ]);
});

test("init reports its progress through on_status", async () => {
  const py_runner = await fresh_runner();
  const messages = [];
  await py_runner.init({
    load_pyodide: async () => fake_interpreter(),
    on_status: (message) => messages.push(message),
  });
  assert.deepEqual(messages, ["Loading Python runtime…", "Installing flake8…", "Ready."]);
});

test("a flake8 that will not install is a degraded mode, not a failure", async () => {
  const { py_runner, result } = await ready_runner(undefined, { flake8_error: "network down" });
  assert.equal(result.ready, true, "the page can still grade");
  assert.equal(result.flake8_ready, false);
  assert.equal(result.flake8_error, "network down");
  assert.equal(py_runner.is_ready(), true);
  assert.equal(py_runner.flake8_failure_reason(), "network down");
});

test("an interpreter that will not load is fatal, and init can be retried", async () => {
  const py_runner = await fresh_runner();
  await assert.rejects(
    () => py_runner.init({ load_pyodide: async () => { throw new Error("cdn 404"); } }),
    /cdn 404/,
  );
  assert.equal(py_runner.is_ready(), false);

  const retry = await py_runner.init({ load_pyodide: async () => fake_interpreter() });
  assert.equal(retry.ready, true);
});

test("init refuses a second call once it has succeeded", async () => {
  const { py_runner } = await ready_runner();
  await assert.rejects(
    () => py_runner.init({ load_pyodide: async () => fake_interpreter() }),
    /already ready; call init\(\) once/,
  );
});

test("run returns the stdout, the error tag, and the prompts that fired", async () => {
  const { py_runner } = await ready_runner(
    canned({ out: "name? bob\nhi bob\n", err: "", prompts: ["name? "] }),
  );
  assert.deepEqual(await py_runner.run("print(1)", ["bob"]), {
    out: "name? bob\nhi bob\n", err: "", prompts: ["name? "], kind: "", line: null, col: null,
  });
});

test("run embeds the source and stdin as JSON the driver decodes", async () => {
  const { py_runner, interpreter } = await ready_runner(
    canned({ out: "", err: "", prompts: [] }),
  );
  await py_runner.run('print("héllo 𝄞")', ["bob"], { filename: "program1.py" });
  const driver = interpreter.python.at(-1);
  // Double-encoded on purpose: the Python literal decodes to JSON text, and
  // encoding once would mangle the surrogate pair in that music glyph.
  assert.ok(driver.includes(JSON.stringify(JSON.stringify('print("héllo 𝄞")'))));
  assert.ok(driver.includes(JSON.stringify(JSON.stringify(["bob"]))));
  assert.ok(driver.includes('"program1.py"'), "the filename names the frame in a traceback");
});

test("run passes a student traceback through instead of throwing", async () => {
  const { py_runner } = await ready_runner(
    canned({ out: "", err: "RUNTIME:Traceback…\nValueError", prompts: [], kind: "runtime", line: 3 }),
  );
  const result = await py_runner.run("int('x')", []);
  assert.match(result.err, /^RUNTIME:/);
  assert.equal(result.kind, "runtime");
  assert.equal(result.line, 3, "the editor puts a cursor here");
});

test("the driver carries what a beginner needs to read their own mistake", async () => {
  const { py_runner, interpreter } = await ready_runner(canned({ out: "", err: "", prompts: [] }));
  await py_runner.run("print(1)", [], { filename: "program1.py", timeout_ms: 250 });
  const driver = interpreter.python.at(-1);
  // Without linecache a frame prints a bare line number: the submission is
  // compiled from a string, so Python has no file to quote the source from.
  assert.ok(driver.includes("linecache.cache[_name]"), "frames must show their source line");
  assert.ok(driver.includes("f.filename == _name"), "harness frames must be filtered out");
  assert.ok(driver.includes("raise _OutOfInput"), "running out of stdin must be a sentence");
  assert.ok(driver.includes("format_exception_only"), "a SyntaxError must keep its caret");
  assert.ok(driver.includes("250 / 1000.0"), "the watchdog must carry the caller's deadline");
  assert.ok(driver.includes("sys.settrace(_watchdog)"), "a loop that never ends must be stopped");
});

test("run defaults the deadline and rejects one outside the ceiling", async () => {
  const { py_runner, interpreter } = await ready_runner(canned({ out: "", err: "", prompts: [] }));
  await py_runner.run("print(1)", []);
  assert.ok(interpreter.python.at(-1).includes(`${RUN_TIMEOUT_MS} / 1000.0`));
  await assert.rejects(() => py_runner.run("print(1)", [], { timeout_ms: 0 }), /timeout_ms/);
  await assert.rejects(
    () => py_runner.run("print(1)", [], { timeout_ms: RUN_TIMEOUT_MS_MAX + 1 }), /timeout_ms/,
  );
});

test("run rejects a widened result the driver could not have produced", async () => {
  const unknown = await ready_runner(canned({ out: "", err: "", prompts: [], kind: "weird" }));
  await assert.rejects(() => unknown.py_runner.run("x", []), /unknown kind weird/);

  // A failure that names no reason, or a reason with no failure, means the
  // driver fell through a branch rather than reporting one.
  const silent = await ready_runner(canned({ out: "", err: "", prompts: [], kind: "runtime" }));
  await assert.rejects(() => silent.py_runner.run("x", []), /kind "runtime" and err must agree/);

  const bad_line = await ready_runner(
    canned({ out: "", err: "SYNTAX:x", prompts: [], kind: "syntax", line: 0 }),
  );
  await assert.rejects(() => bad_line.py_runner.run("x", []), /line must be a positive integer/);
});

test("run rejects a result the driver could not have produced", async () => {
  const untagged = await ready_runner(canned({ out: "", err: "boom", prompts: [] }));
  await assert.rejects(() => untagged.py_runner.run("x", []), /err must be empty or tagged/);

  const chatty = await ready_runner(canned({ out: "", err: "", prompts: ["a", "b"] }));
  await assert.rejects(
    () => chatty.py_runner.run("x", ["only one"]),
    /cannot prompt more times than stdin has lines/,
  );

  const wrong_shape = await ready_runner(canned({ out: 1, err: "", prompts: [] }));
  await assert.rejects(() => wrong_shape.py_runner.run("x", []), /out must be a string/);
});

test("run refuses a filename carrying a path", async () => {
  const { py_runner } = await ready_runner(canned({ out: "", err: "", prompts: [] }));
  await assert.rejects(
    () => py_runner.run("x", [], { filename: "sub/dir.py" }),
    /filename must not contain a path/,
  );
  await assert.rejects(() => py_runner.run("x", [], { filename: "" }), AssertionError);
});

test("run refuses stdin that is not a list of strings", async () => {
  const { py_runner } = await ready_runner(canned({ out: "", err: "", prompts: [] }));
  await assert.rejects(() => py_runner.run("x", "bob"), /stdin_lines must be an array/);
  await assert.rejects(() => py_runner.run("x", [42]), /stdin_lines\[0\] must be a string/);
});

test("lint formats each finding as one line, sorted by the bootstrap", async () => {
  const { py_runner } = await ready_runner(canned(null, [
    { code: "E501", line: 2, col: 100, text: "line too long (120 > 99)" },
    { code: "W291", line: 4, col: 1, text: "trailing whitespace" },
  ]));
  assert.deepEqual(await py_runner.lint("x = 1"), [
    "L2:100 E501 line too long (120 > 99)",
    "L4:1 W291 trailing whitespace",
  ]);
});

test("lint refuses to run when flake8 never installed", async () => {
  const { py_runner } = await ready_runner(undefined, { flake8_error: "network down" });
  await assert.rejects(() => py_runner.lint("x = 1"), /flake8 unavailable \(network down\)/);
});

test("regex_lint finds tabs, trailing whitespace, long lines, and bare except", async () => {
  const { regex_lint } = await fresh_runner();
  const source = [
    "\tx = 1",
    "y = 2   ",
    `z = "${"a".repeat(LINE_LENGTH_CHARS_DEFAULT)}"`,
    "try:",
    "    pass",
    "except:",
    "    pass",
  ].join("\n");
  assert.deepEqual(regex_lint(source), [
    "L1:1 W191 indentation contains tabs",
    "L2:1 W291 trailing whitespace",
    "L3:100 E501 line too long (105 > 99)",
    "L6:1 E722 do not use bare 'except'",
  ]);
});

test("regex_lint leaves clean code alone", async () => {
  const { regex_lint } = await fresh_runner();
  assert.deepEqual(regex_lint('x = 1\nprint("ok")\n'), []);
});

test("regex_lint flags a tab that indents, not one inside a string", async () => {
  const { regex_lint } = await fresh_runner();
  assert.deepEqual(regex_lint('x = "a\tb"'), []);
  assert.deepEqual(regex_lint("    \tx = 1"), ["L1:1 W191 indentation contains tabs"]);
});

test("regex_lint honours a custom line length", async () => {
  const { regex_lint } = await fresh_runner();
  assert.deepEqual(regex_lint("x = 12345", { max_line_length_chars: 5 }), [
    "L1:6 E501 line too long (9 > 5)",
  ]);
  assert.deepEqual(regex_lint("x = 12345", { max_line_length_chars: 9 }), []);
});

test("regex_lint treats CRLF as LF, so a Windows editor costs no points", async () => {
  const { regex_lint } = await fresh_runner();
  assert.deepEqual(regex_lint("x = 1\r\ny = 2\r\n"), []);
});

test("regex_lint rejects a line length outside the allowed range", async () => {
  const { regex_lint } = await fresh_runner();
  assert.throws(() => regex_lint("x", { max_line_length_chars: 0 }), AssertionError);
  assert.throws(() => regex_lint("x", { max_line_length_chars: 100_000 }), AssertionError);
  assert.throws(() => regex_lint(42), /code must be a string/);
});
