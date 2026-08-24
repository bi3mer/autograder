/**
 * Bundle entry point.
 *
 * Bundled as `dist/autograder.js` (and `.min.js`), which defines the global
 * `Autograder`, so an assignment page needs two script tags: Pyodide, then
 * the bundle. `dist/autograder.esm.js` is the same code as an ES module for
 * tooling that imports it.
 *
 * @example <caption>Browser, via the global</caption>
 * <script src="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js"></script>
 * <script src="../dist/autograder.js"></script>
 * <script>
 *   Autograder.grader_app.init({
 *     filename: "program1.py", cases, build_criteria, max_auto_points: 45,
 *   });
 * </script>
 *
 * @example <caption>ES module</caption>
 * import { grader_app } from "./dist/autograder.esm.js";
 *
 * @module autograder
 */

export * as assertions from "./assert.js";
export * as checks from "./checks.js";
export * as constants from "./constants.js";
export * as grader_app from "./grader.js";
export * as page from "./page.js";
export * as py_runner from "./pyrunner.js";
export * as rubric from "./rubric.js";

export {
  assert, assert_array, assert_range, assert_string, AssertionError, unreachable,
} from "./assert.js";
export { escape_html } from "./html.js";

/** Bundle version, kept in step with `package.json`. */
export const VERSION = "0.1.0";
