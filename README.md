# Autograder

A browser-side autograder for introductory Python assignments. A student drops
`program1.py` onto the page, the page runs it under Pyodide (CPython compiled
to WebAssembly), diffs the output against the assignment's examples, lints it
with flake8, and prints a rubric plus a copy-paste summary. Nothing is
uploaded: the Python runtime, the student's code, and the grading all live in
the browser tab.

The site is served by GitHub Pages, built from `src/` by the workflow on every
push to `main`. `dist/` is gitignored: the deployed bundle always comes from
the commit that produced it, so a stale bundle cannot ship.

## Layout

| Path     | What lives there                                            |
| -------- | ----------------------------------------------------------- |
| `src/`   | The grading engine, as ES modules with JSDoc types          |
| `dist/`  | Built bundles, gitignored; `npm run build` creates them     |
| `css/`   | Page styles shared by assignment pages                      |
| `cs230/` | One HTML page per assignment: test cases and rubric only    |
| `index.html` | Site root: a placeholder page on the shared dark theme  |
| `test/`  | Node tests: the grading engine, and the page under jsdom    |

`src/` holds six modules. `assert.js` provides the assertions, which stay
enabled in every build. `checks.js` does substring matching and line diffing
over plain strings. `pyrunner.js` loads Pyodide and runs one submission
against canned stdin. `rubric.js` scores an array of criterion objects.
`page.js` generates the page markup, and `grader.js` wires everything to the
DOM.

## Using the Bundle in an HTML Page

Two script tags, Pyodide then the bundle, and one call. The bundle defines
the global `Autograder`, generates the page markup, and loads `css/a1.css`
from beside itself, so the page carries no boilerplate of its own.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Habit Cost Autograder</title>
    <script src="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js"></script>
    <script src="../dist/autograder.js"></script>
  </head>
  <body>
    <script>
      Autograder.grader_app.init({
        filename: "program1.py",
        subtitle: "Assignment 1 · program1.py · 45 auto-graded (of 50 total)",
        footer: "Runs Python via Pyodide. Nothing is uploaded.",
        cases: CASES, // [{ name, stdin_lines, expected_lines }]
        build_criteria, // (results) => Criterion[]
        manual_rows: MANUAL_ROWS, // instructor-graded rows, not totalled
        max_auto_points: 45,
      });
    </script>
  </body>
</html>
```

The heading defaults to the document title, the score caption to
`"/ <max_auto_points> auto"`, and the drop prompt to `"Drop <filename> here"`.
Override any of them with `title`, `headline_label`, `drop_prompt`,
`drop_hint`, `accept`, or `submit_to` (the upload target named when a student
picks a wrongly-named file, `"BrightSpace"` by default). Pass
`mount: "#somewhere"` to render inside an existing element rather than
`document.body`, and `styles_href` to point at another stylesheet or `false`
to link none.

Use `dist/autograder.min.js` for the deployed page and `dist/autograder.js`
while debugging: both keep assertions live, and both ship a source map.
`dist/autograder.esm.js` is the same code as an ES module:

```js
import { grader_app, rubric } from "./dist/autograder.esm.js";
```

A page that already contains the grader elements keeps its own markup:
`init()` renders the skeleton only when `#run` is absent. The generated
elements carry the ids `status`, `run`, `drop`, `file`, `filename`, `rubric`,
`zero`, `headline`, `summarybox`, `summary`, `copy`, and `copystatus`, which
`element_ids` can override. A hand-written page missing one of them fails an
assertion at startup rather than throwing `null` errors later.

## Adding an Assignment

Copy `cs230/a1.html`, then replace two things: `CASES` (the stdin and expected
output for each example in the handout) and `build_criteria` (the rubric).
Everything else is shared, and the page is about a dozen lines around that
data. Criterion types are `code`, `output`, `code-regex`,
`output-diff`, `flake8`, and `custom`; see the `Criterion` typedef in
`src/rubric.js` for every field.

Scoring is proportional wherever partial work deserves partial credit. A
`code` criterion in the default `all` mode awards points in proportion to how
many needles were found. An `output-diff` case awards points in proportion to
how many lines match. A `flake8` criterion with `partial: true` deducts one
point per finding, with a floor of zero.

## Development

```
npm install
npm run build       # required first: dist/ is gitignored, so a clone has none
npm run serve       # http://localhost:8000/cs230/a1.html
npm run typecheck   # tsc --checkJs against the JSDoc types
npm test            # 16 engine tests, then 11 DOM tests under jsdom
npm run docs        # generate docs/api from the JSDoc comments
npm run check       # typecheck, then build
```

Build before serving, and serve over HTTP rather than opening the page
directly: `dist/` starts empty in a fresh clone, and Pyodide fetches its
WebAssembly runtime, which a `file://` page cannot do.

The types are JSDoc comments checked by TypeScript in `checkJs` mode, so
`npm run typecheck` catches a misspelled criterion field without adding a
build step to the source. There is no `.ts` file in the repository.

## Deploying

Pushing to `main` triggers `.github/workflows/pages.yml`, which typechecks,
tests, builds `dist/`, generates the docs, assembles `_site/`, and deploys it
to GitHub Pages. `_site/` holds `index.html`, `cs230/`, `css/`, `dist/`, and
`docs/`: uploading the checkout itself would publish `node_modules/` and the
tests along with them. Nothing deploys unless the typecheck and the tests pass.

This requires the repository's Pages source to be GitHub Actions rather than a
branch. The repository is on branch mode today, so flip it once:

```
gh api -X PUT repos/bi3mer/autograder/pages -f build_type=workflow
```

To catch a failure before the push rather than in CI, install the pre-push
hook, which runs the same typecheck and tests locally:

```
npm run hooks:install
```

## Code Style

The JavaScript follows [TIGER_STYLE](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md),
including `snake_case` identifiers. In practice that means four habits:

Assertions are everywhere and stay enabled in production builds, including the
minified one. Every function asserts its arguments and its postconditions. A
grader that throws loudly in front of one instructor costs less than a grader
that quietly awards the wrong score to two hundred students.

Every limit is explicit and lives in `src/constants.js`, so every loop runs
against a stated bound. A pasted binary or a runaway `while True` print loop
fails an assertion at the boundary instead of hanging the tab.

Functions stay under 70 lines and do one thing. Names carry their units and
avoid abbreviation: `max_line_length_chars`, not `maxLen`.

Errors are handled where they happen, and a degraded path names its reason.
When flake8 fails to install, the rubric row says so and the regex fallback
runs; the failure never disappears into an empty `catch`.
