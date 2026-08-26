# Autograder

A browser-side autograder for introductory Python assignments. A student drops
`program1.py` onto the page, the page runs it under Pyodide (CPython compiled
to WebAssembly), diffs the output against the assignment's examples, lints it
with flake8, and prints a rubric plus a copy-paste summary. Nothing is
uploaded: the Python runtime, the student's code, and the grading all live in
the browser tab.

There is no build step and no dependencies. The browser loads `src/` as ES
modules, GitHub Pages serves the repository tree as it stands, and the tests
are plain Node, so what runs in production is the source you are reading.

## Layout

| Path           | What lives there                                         |
| -------------- | -------------------------------------------------------- |
| `src/`         | The grading engine, as plain ES modules                  |
| `css/`         | Page styles shared by assignment pages                   |
| `cs230/`       | One HTML page per assignment: test cases and rubric only |
| `index.html`   | Site root: a placeholder page on the shared dark theme   |
| `test/`        | One `node --test` file per engine module                 |
| `package.json` | Three scripts and `"type": "module"`; no dependencies    |

`src/main.js` re-exports the whole engine, and eight modules sit behind it.
`assert.js` provides the assertions, which stay enabled everywhere, and
`constants.js` holds every limit they check against. `checks.js` does
substring matching and line diffing over plain strings, and `html.js` escapes
whatever reaches the page. `pyrunner.js` loads Pyodide and runs one submission
against canned stdin. `rubric.js` scores an array of criterion objects.
`page.js` generates the page markup, and `grader.js` wires everything to the
DOM.

Nothing in `src/` imports anything outside `src/`, so a page needs those nine
files and no package manager.

## Using the Engine in an HTML Page

Pyodide's script tag, then one module script that imports `src/main.js` and
calls `init` with the assignment's data. The engine generates the page markup
and loads `css/a1.css` from beside `src/`, so the page carries no boilerplate
of its own.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Habit Cost Autograder</title>
    <script src="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js"></script>
  </head>
  <body>
    <script type="module">
      import { grader_app } from "../src/main.js";

      grader_app.init({
        filename: "program1.py",
        subtitle: "Assignment 1 · program1.py · 45 auto-graded (of 50 total)",
        footer: "Runs Python via Pyodide. Nothing is uploaded.",
        cases: CASES, // [{ name, stdin_lines, expected_lines }]
        build_criteria, // (results) => criteria
        manual_rows: MANUAL_ROWS, // instructor-graded rows, not totalled
        max_auto_points: 45,
      });
    </script>
  </body>
</html>
```

Pyodide's tag is a classic script and the page's is a module, so `loadPyodide`
is defined well before `init` runs: modules are deferred, classic tags are not.

The heading defaults to the document title, the score caption to
`"/ <max_auto_points> auto"`, and the drop prompt to `"Drop <filename> here"`.
Override any of them with `title`, `headline_label`, `drop_prompt`,
`drop_hint`, `accept`, or `submit_to` (the upload target named when a student
picks a wrongly-named file, `"BrightSpace"` by default). Pass
`mount: "#somewhere"` to render inside an existing element rather than
`document.body`, and `styles_href` to point at another stylesheet or `false`
to link none. The comment above `ELEMENT_IDS_DEFAULT` in `src/grader.js`
documents every field.

Import one module directly when that is all a page needs:

```js
import { grade } from "../src/rubric.js";
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
data. Criterion types are `code`, `output`, `code-regex`, `output-diff`,
`flake8`, and `custom`; the comment above `round_points` in `src/rubric.js`
lists every field a criterion takes.

Scoring is proportional wherever partial work deserves partial credit. A
`code` criterion in the default `all` mode awards points in proportion to how
many needles were found. An `output-diff` case awards points in proportion to
how many lines match. A `flake8` criterion with `partial: true` deducts one
point per finding, with a floor of zero.

## Development

```
npm run serve       # http://localhost:8000/cs230/a1.html
npm test            # 106 tests, straight from a clone: nothing to install
```

Serve over HTTP rather than opening a page directly: ES modules and Pyodide's
WebAssembly runtime are both fetched, and a `file://` page cannot do either.
Any static server works; `npm run serve` is Python's, because Pyodide already
assumes Python is around.

`package.json` carries the three scripts and `"type": "module"`, which is
what makes Node read `src/*.js` as ES modules. A browser decides that from
the `type="module"` attribute on the script tag instead, so it never reads
the manifest at all. There are no dependencies and no lockfile, so there is
no install step: `npm test` runs on a fresh clone.

The tests run on Node's own test runner, one file per module: `test_checks.js`
covers `src/checks.js`, `test_rubric.js` covers `src/rubric.js`, and so on.
`test_pyrunner.js` drives the runner against a fake interpreter that records
the Python it is handed, which covers the encoding and the state guards
without WebAssembly.

The tests cover the grading engine, which is where a wrong score comes from.
They do not cover the DOM: a test double for the browser is a second
implementation to trust, and jsdom is a large dependency to carry for it. The
generated page is checked by loading it. Serve the site and drop a `.py` file
on `cs230/a1.html`; a missing element fails an assertion at startup, in front
of you, rather than silently.

## Deploying

Pushing to `main` triggers `.github/workflows/pages.yml`, which runs the tests
and then uploads the checkout to GitHub Pages. No install step, no build step,
and no assembly step: the repository tree is the site. Nothing deploys unless
the tests pass.

This requires the repository's Pages source to be GitHub Actions rather than a
branch. The repository is on branch mode today, so flip it once:

```
gh api -X PUT repos/bi3mer/autograder/pages -f build_type=workflow
```

To catch a failure before the push rather than in CI, install the pre-push
hook, which runs the same tests locally:

```
npm run hooks:install
```

## Code Style

The JavaScript follows [TIGER_STYLE](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md),
including `snake_case` identifiers. In practice that means five habits:

Assertions are everywhere and stay enabled in production. Every function
asserts its arguments and its postconditions. A grader that throws loudly in
front of one instructor costs less than a grader that quietly awards the wrong
score to two hundred students.

Every limit is explicit and lives in `src/constants.js`, so every loop runs
against a stated bound. A pasted binary or a runaway `while True` print loop
fails an assertion at the boundary instead of hanging the tab.

Functions stay under 70 lines and do one thing. Names carry their units and
avoid abbreviation: `max_line_length_chars`, not `maxLen`.

Comments explain why, never what, with one exception: because there are no
type declarations, a module documents the shape of the objects it hands
around in one comment block near the top. Everything else earns its place by
saying something the code cannot: why the regex `lastIndex` is reset between
submissions, why flake8's structured results are read instead of its
formatter, why points round once at the end rather than per case.

Errors are handled where they happen, and a degraded path names its reason.
When flake8 fails to install, the rubric row says so and the regex fallback
runs; the failure never disappears into an empty `catch`.
