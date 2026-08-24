/**
 * Smoke tests for the parts that run without a browser.
 *
 * Pyodide needs a browser, so `py_runner.run` is out of scope here; what is
 * in scope is everything that decides a student's score: substring matching,
 * line diffing, partial credit, clamping, and the assertions that guard them.
 */

import assert_node from "node:assert/strict";
import { AssertionError } from "../src/assert.ts";
import * as checks from "../src/checks.ts";
import { escape_html } from "../src/html.ts";
import * as py_runner from "../src/pyrunner.ts";
import * as rubric from "../src/rubric.ts";
import type { Criterion } from "../src/rubric.ts";

let passed = 0;

/** Reports the first failure and stops: no point scoring a broken engine. */
async function test(name: string, body: () => void | Promise<void>): Promise<void> {
  await body();
  passed++;
  console.log(`  ok  ${name}`);
}

await test("contains_set reports matched and missing needles", () => {
  const needles = [['input("a: ")', "input('a: ')"], "missing"];
  const result = checks.contains_set('x = input("a: ")', needles);
  assert_node.equal(result.pass, false);
  assert_node.equal(result.matched.length, 1);
  assert_node.deepEqual(result.missing, ["missing"]);
});

await test("diff_lines ignores trailing blanks and honours the anchor", () => {
  const diff = checks.diff_lines("prompt: x\nHEAD\n1\n\n", ["HEAD", "1"], {
    anchor_prefix: "HEAD",
  });
  assert_node.equal(diff.all_match, true);
  assert_node.equal(diff.rows.length, 2);
});

await test("diff_lines marks a missing line with the absent placeholder", () => {
  const diff = checks.diff_lines("a", ["a", "b"]);
  assert_node.equal(diff.all_match, false);
  assert_node.equal(diff.rows[1].got, "∅");
});

await test("find_lines returns 1-indexed line numbers", () => {
  assert_node.deepEqual(checks.find_lines("a\nb\na", "a"), [1, 3]);
});

await test("escape_html neutralises tags and quotes", () => {
  assert_node.equal(escape_html('<b>"x"</b>'), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
});

await test("mode all awards proportional credit", async () => {
  const report = await rubric.grade(
    [{ id: "a", name: "A", points: 10, type: "code", needles: ["x", "y", "z"] }],
    { source: "x y", results: [] },
  );
  assert_node.equal(report.items[0].earned, 6.67);
  assert_node.equal(report.items[0].pass, false);
});

await test("mode any awards full credit for one alternative", async () => {
  const report = await rubric.grade(
    [{ id: "a", name: "A", points: 4, type: "code", mode: "any", needles: ["x", "zzz"] }],
    { source: "x", results: [] },
  );
  assert_node.equal(report.items[0].earned, 4);
});

await test("output-diff prorates credit by matching lines", async () => {
  const report = await rubric.grade(
    [{
      id: "out", name: "Out", points: 6, type: "output-diff",
      cases: [{ name: "case 1", expected_lines: ["1", "2", "3"] }],
    }],
    { source: "", results: [{ out: "1\n9\n3\n", err: "", prompts: [] }] },
  );
  assert_node.equal(report.items[0].earned, 4);
  assert_node.equal(report.items[0].detail_is_html, true);
});

await test("code-regex resets lastIndex between submissions", async () => {
  const criterion: Criterion = {
    id: "f", name: "F", points: 1, type: "code-regex", regex: /f["']/g,
  };
  const first = await rubric.grade([criterion], { source: 'f"x"', results: [] });
  const second = await rubric.grade([criterion], { source: 'f"x"', results: [] });
  assert_node.equal(first.items[0].earned, 1);
  assert_node.equal(second.items[0].earned, 1);
});

await test("flake8 criterion falls back to the regex linter", async () => {
  assert_node.equal(py_runner.is_flake8_ready(), false);
  const report = await rubric.grade(
    [{ id: "style", name: "Style", points: 10, type: "flake8", partial: true }],
    { source: "x = 1   \ny = 2\t\n", results: [] },
  );
  assert_node.equal(report.items[0].earned, 8);
  assert_node.match(report.items[0].detail, /built-in/);
});

await test("a throwing custom check costs its criterion, not the run", async () => {
  const report = await rubric.grade([
    {
      id: "boom", name: "Boom", points: 5, type: "custom",
      check: () => { throw new Error("nope"); },
    },
    { id: "fine", name: "Fine", points: 5, type: "code", needle: "x" },
  ], { source: "x", results: [] });
  assert_node.equal(report.items[0].earned, 0);
  assert_node.match(report.items[0].detail, /Check error: nope/);
  assert_node.equal(report.total, 5);
});

await test("earned points are clamped to the criterion's points", async () => {
  const report = await rubric.grade(
    [{ id: "over", name: "Over", points: 3, type: "custom", check: () => ({ earned: 99 }) }],
    { source: "", results: [] },
  );
  assert_node.equal(report.items[0].earned, 3);
});

await test("a malformed criterion trips an assertion", async () => {
  await assert_node.rejects(
    () => rubric.grade([{ id: "", name: "No id", points: 1 }], { source: "", results: [] }),
    AssertionError,
  );
});

await test("run before init trips an assertion", async () => {
  await assert_node.rejects(() => py_runner.run("print(1)", []), AssertionError);
});

await test("a regex from another realm still counts as a regex", async () => {
  const vm = await import("node:vm");
  const foreign = vm.runInNewContext('/f["\']/') as RegExp;
  assert_node.equal(foreign instanceof RegExp, false, "precondition: foreign realm");
  const report = await rubric.grade(
    [{ id: "f", name: "F", points: 1, type: "code-regex", regex: foreign }],
    { source: 'f"x"', results: [] },
  );
  assert_node.equal(report.items[0].earned, 1);
});

await test("the built bundle defines the Autograder global", async () => {
  const { readFile } = await import("node:fs/promises");
  const vm = await import("node:vm");
  const bundle_path = new URL("../dist/autograder.js", import.meta.url);
  const source = await readFile(bundle_path, "utf8");
  const sandbox: Record<string, any> = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert_node.deepEqual(
    Object.keys(sandbox.Autograder).sort(),
    ["AssertionError", "VERSION", "assert", "assert_array", "assert_range", "assert_string",
      "assertions", "checks", "constants", "escape_html", "grader_app", "page", "py_runner",
      "rubric", "unreachable"].sort(),
  );
  assert_node.equal(typeof sandbox.Autograder.grader_app.init, "function");
  // Assertions must survive bundling, minification included.
  assert_node.throws(() => sandbox.Autograder.assert(false, "live"), /assertion failed: live/);
});

console.log(`\n${passed} tests passed`);
