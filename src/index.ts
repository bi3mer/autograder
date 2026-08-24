/**
 * Bundle entry point.
 *
 * Bundled as `dist/autograder.js` (and `.min.js`), which defines the global
 * `Autograder`, so an assignment page needs two script tags: Pyodide, then
 * the bundle. `dist/autograder.esm.js` is the same code as an ES module for
 * tooling that imports it.
 *
 *     <script src="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js"></script>
 *     <script src="../dist/autograder.js"></script>
 *     <script>
 *       Autograder.grader_app.init({
 *         filename: "program1.py", cases, build_criteria, max_auto_points: 45,
 *       });
 *     </script>
 */

export * as assertions from "./assert.ts";
export * as checks from "./checks.ts";
export * as constants from "./constants.ts";
export * as grader_app from "./grader.ts";
export * as page from "./page.ts";
export * as py_runner from "./pyrunner.ts";
export * as rubric from "./rubric.ts";

export {
  assert, assert_array, assert_range, assert_string, AssertionError, unreachable,
} from "./assert.ts";
export { escape_html } from "./html.ts";

export type { ContainsSetResult, DiffResult, DiffRow, MatchOptions, Needle } from "./checks.ts";
export type {
  BuildCriteria, ElementIds, Elements, GraderConfig, GraderSession, ManualRow, RubricRow, TestCase,
} from "./grader.ts";
export type {
  InitOptions, InitResult, PyodideInterface, RunResult, RunnerState,
} from "./pyrunner.ts";
export type {
  CheckResult, Criterion, CriterionType, DiffCase, GradeContext, GradeReport, GradedItem,
} from "./rubric.ts";
export type { SkeletonOptions } from "./page.ts";

/** Kept in step with `package.json`. */
export const VERSION = "0.1.0";
