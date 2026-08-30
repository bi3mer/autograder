/**
 * The entry point an assignment page imports.
 *
 * A page loads these modules directly from the browser, with no build step to
 * catch a rename, so the export surface is the contract: a dropped name is a
 * page that fails at load with a blank screen.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as autograder from "../src/main.js";

const EXPECTED_EXPORTS = [
  "AssertionError", "VERSION", "assert", "assert_array", "assert_range", "assert_string",
  "assertions", "checks", "constants", "escape_html", "grader_app", "handout", "load_handout",
  "markdown", "page", "py_runner", "render_markdown", "rubric", "unreachable",
].sort();

test("main.js re-exports the whole engine", () => {
  assert.deepEqual(Object.keys(autograder).sort(), EXPECTED_EXPORTS);
});

test("each namespace export carries the module's entry points", () => {
  assert.equal(typeof autograder.grader_app.init, "function");
  assert.equal(typeof autograder.py_runner.init, "function");
  assert.equal(typeof autograder.py_runner.run, "function");
  assert.equal(typeof autograder.rubric.grade, "function");
  assert.equal(typeof autograder.checks.contains_set, "function");
  assert.equal(typeof autograder.checks.diff_lines, "function");
  assert.equal(typeof autograder.page.render_skeleton, "function");
  assert.equal(typeof autograder.markdown.render_markdown, "function");
  assert.equal(typeof autograder.handout.load_handout, "function");
  assert.equal(typeof autograder.assertions.assert, "function");
});

test("assertions are live wherever the engine is loaded from", () => {
  assert.throws(() => autograder.assert(false, "live"), /assertion failed: live/);
  assert.throws(() => autograder.unreachable("live"), autograder.AssertionError);
});

test("the named re-exports are the same functions as the namespaces'", () => {
  assert.equal(autograder.assert, autograder.assertions.assert);
  assert.equal(autograder.AssertionError, autograder.assertions.AssertionError);
  assert.equal(autograder.render_markdown, autograder.markdown.render_markdown);
  assert.equal(autograder.load_handout, autograder.handout.load_handout);
});

test("VERSION is kept in step with package.json", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(autograder.VERSION, manifest.version);
});
