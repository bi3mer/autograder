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

## Handouts in Markdown

A problem statement is prose, so it is written as prose. Point an assignment
page at a `.md` file and the browser fetches it, renders it, and puts the markup
in a mount element:

```js
grader_app.init({
  filename: "w1-1.py",
  handout: { href: "w1p1.md", mount: "#handout" },
  cases: CASES,
  build_criteria,
  max_auto_points: 40,
});
```

Every page under `cs230/` is wired this way: the handout fills the left column
and the grader the right, with `.split` in `css/a1.css` carrying the layout.

`handout: "w1p1.md"` is shorthand for the same thing mounted at `#handout`. The
path resolves against the page rather than against `src/`, so the markdown sits
beside the HTML that names it. The handout's mount is separate from the
grader's, which is what lets `cs230/w1p1.html` carry the statement in one column
and the drop zone in the other. A page with no grader on it can import
`load_handout` and call it directly.

### The Rubric Generates Itself

Under the handout, the grader appends a rubric table built from the same
`build_criteria` it scores with: one row per criterion, the auto-graded total,
then any `manual_rows` with their free-text scores below it. A handout that
spells its own point breakdown out in prose can promise points the grader does
not award, and that drift stays invisible until someone compares the two by
hand. Generating the table removes the second copy.

The criteria are summed rather than trusted, and the sum is asserted against
`max_auto_points`. A page whose rows come to 45 while the score reads `/ 50`
fails at startup rather than showing students a total they cannot reach.

Pass `handout: { href: "w1p1.md", render_rubric: false }` for a handout that
writes its own; it defaults to `true`.

The parser covers the subset a handout uses: ATX headings, paragraphs, nested
ordered and unordered lists, fenced code blocks, blockquotes, horizontal rules,
pipe tables with an alignment row, `code`, `**bold**`, `*italic*`, links,
images, and hard line breaks. A fence renders as `<pre class="io">`, the class
the terminal transcripts already use, so it lands on styling that exists.

Only a leading tab is expanded to spaces, since indentation is what nests a
list. A tab further along a line is content and survives, which is what lets
`cs230/a1.md` show the tab-separated output that assignment expects.

Reference links, setext headings, indented code blocks, autolinks, HTML blocks,
and lazy continuation inside a list item are all absent, each being a class of
surprise a handout does not need. Unknown syntax is never an error, because
markdown has none; it renders as the literal text it is.

Raw HTML in a handout renders as visible text. Every run of text is escaped
before any inline rule reaches it, and `render_markdown` then checks its own
output against a fixed tag allowlist, so a `<script>` written in a `.md` file
cannot become a tag. A `javascript:` or `data:` link target renders as the text
the author typed rather than as an anchor.

A handout that fails to load says why, in the space the prose would have
filled, and the grader beside it keeps working.

## Adding an Assignment

Copy `cs230/a1.html`, then replace two things: `CASES` (the stdin and expected
output for each example in the handout) and `build_criteria` (the rubric). The
problem statement goes in a `.md` file beside it, named by `handout`.
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
npm test            # 170 tests, straight from a clone: nothing to install
```

Serve over HTTP rather than opening a page directly: ES modules, Pyodide's
WebAssembly runtime, and an assignment's markdown handout are all fetched, and a
`file://` page cannot do any of them. Any static server works; `npm run serve`
is Python's, because Pyodide already
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
without WebAssembly. `test_markdown.js` covers the parser in full, since it is
a pure function from string to string.

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
