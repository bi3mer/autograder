/**
 * Entry point: the whole grading engine, in one import.
 *
 * There is no build step. The browser loads these modules itself, so an
 * assignment page is Pyodide's script tag plus one module script that imports
 * this file and hands `grader_app.init` its data.
 *
 *     <script src="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js"></script>
 *     <script type="module">
 *       import { grader_app } from "../src/main.js";
 *       grader_app.init({
 *         filename: "program1.py", cases, build_criteria, max_auto_points: 45,
 *       });
 *     </script>
 *
 * Pyodide's tag is a classic script, so `loadPyodide` is defined well before
 * any module script runs: modules are deferred, classic tags are not.
 */

export * as assertions from "./assert.js";
export * as checks from "./checks.js";
export * as constants from "./constants.js";
export * as editor from "./editor.js";
export * as grader_app from "./grader.js";
export * as handout from "./handout.js";
export * as highlight from "./highlight.js";
export * as markdown from "./markdown.js";
export * as page from "./page.js";
export * as py_runner from "./pyrunner.js";
export * as rubric from "./rubric.js";

export {
  assert, assert_array, assert_range, assert_string, AssertionError, unreachable,
} from "./assert.js";
export { escape_html } from "./html.js";
export { highlight_html } from "./highlight.js";
export { load_handout } from "./handout.js";
export { render_markdown } from "./markdown.js";

/** Kept in step with `package.json`. */
export const VERSION = "0.1.0";
