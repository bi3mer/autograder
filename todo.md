# To Do

## Syntax Highlighting for Python Code Blocks in Handouts

A ```` ```python ```` fence in a handout renders as plain text. The two halves
of the fix already exist and only need joining: `render_fence` in
`src/markdown.js` already emits `<pre class="io lang-python">` for a fence
with an info string, and `highlight_html` in `src/highlight.js` is the
editor's colouriser (Python in, escaped HTML with `<span class="tok-...">`
per token out). The token colours in `css/a1.css` were chosen against
`#010409`, which is also `pre.io`'s background, so the palette transfers.

About 30 lines across four files:

- `src/markdown.js`: import `highlight_html` and, in `render_fence`, use it
  instead of `escape_html` when the info string is `python` or `py`. No
  import cycle: `highlight.js` depends only on `assert`, `constants`, and
  `html`.
- `src/markdown.js`: add `"span"` to `TAGS_ALLOWED`, or the
  `assert_tags_allowed` postcondition throws on the first highlighted fence.
  The "every tag was emitted by a rule here" proof stays sound because
  `highlight_html` escapes every character of text; say so in the comment.
- `css/a1.css`: the `.tok-*` rules are scoped to `.editor .highlight`. Drop
  the scope, or add `.prose pre.io` to each selector.
- `test/test_markdown.js`: the fence test expects
  `<pre class="io lang-python">print(1)</pre>` and needs the span-wrapped
  form. Add one test that a bare fence stays plain and one that a `python`
  fence containing `<script>` is still escaped inside the spans. One sentence
  in the README's markdown section.

Only fences with an info string get colour; the terminal transcripts are bare
fences and stay as they are. Every handout's "How to Submit" block is a
`python` fence, so all the docstring summaries turn string-coloured at once.
Sources past `HIGHLIGHT_BYTES_MAX` fall back to plain escaping.

Do it inside `render_markdown`, which keeps the parser a pure string-to-string
function that `test_markdown.js` covers in Node, rather than walking
`pre.lang-python` elements in `handout.js` after `innerHTML`, which would put
it in the DOM code the tests do not reach.

## Starter Code in the Editor

The editor opens with the saved draft or nothing (`initial_source` in
`src/grader.js`), so a student on w4i2 copies the starter out of the handout
and pastes it in. A `starter` option on the editor config would open the
editor with it already there. The draft still wins, so a refresh keeps the
student's edits; the starter shows only on a blank slate.

About 15 lines in one file, plus the README:

- `src/grader.js`: `editor_options` returns `{ download, starter }` with
  `starter` defaulting to `""`, and the config check asserts it is a string
  under `SOURCE_BYTES_MAX`. `initial_source` returns
  `draft ?? session.editor_config.starter`. Add the field to the `editor`
  entry in the config comment near the top of the file.
- `README.md`, "The Editor": the paragraph that says there is no starter file
  and the editor opens empty needs rewriting, since it will be true only by
  default.
- No Node test reaches `grader.js`, so verify by loading `cs230/w4i2.html`,
  clearing the page's draft in `localStorage`, and reloading: the starter
  appears; type a character, reload, and the draft appears instead.

Example, `cs230/w4i2.html`. The prompts are already page constants, so the
starter is built from them and the rubric and the starter cannot disagree on
the prompt text; the handout's copy in `w4i2.md` stays the one place left to
keep in sync by hand:

```js
const STARTER = `word = input("${PROMPT_WORD}")
substring = input("${PROMPT_SUBSTRING}")
found = False

for i in range(len(word) - len(substring) + 1):
    candidate = ""
    for j in range(len(substring)):
        candidate += word[i + j]

    if candidate == substring:
        found = True
        break

print(found)
`;

grader_app.init({
    filename: "w4-i2.py",
    editor: { starter: STARTER },
    // ...as now
});
```

Once a draft exists there is no way back to the starter short of clearing
`localStorage`; a "Reset to starter" button is the follow-up. Until then a
student who mangles the starter re-copies it from the handout, which is what
they do today, so nothing is lost.

## Click-to-Reveal Hints in Handouts

A handout hint is plain text today (`cs230/w3p1.md:3`, `cs230/w4i1.md:15`),
so the student reads it whether they wanted it or not. The browser's
`<details><summary>Hint</summary>...</details>` hides its body until the
summary is clicked, with no JavaScript, and the grader already uses it for
diffs (`details.diff` in `css/a1.css`). Writing it into the `.md` does not
work: `src/markdown.js` escapes raw HTML, and `assert_tags_allowed` rejects
any tag outside `TAGS_ALLOWED`. The renderer needs a syntax of its own.

Use GitHub's callout form on a blockquote, so the `.md` still reads as plain
text. Text after the marker, if any, becomes the summary label:

```markdown
> [!HINT]
> `len()` gives the number of characters in a string.

> [!HINT] Stuck on the loop?
> Read the guess again at the bottom of the loop body.
```

About 25 lines across four files:

- `src/markdown.js`: in `render_blockquote`, after `inner` is collected,
  test `inner[0]` against `/^\[!HINT\][ \t]*(.*)$/i`. On a match, emit
  `<details class="hint">`, a `<summary>` holding `inline(label)` (default
  `Hint`), and `render_blocks(inner.slice(1), depth + 1)`, then return
  `scan`. Any other blockquote renders as now.
- `src/markdown.js`: add `"details"` and `"summary"` to `TAGS_ALLOWED`, or
  the postcondition throws on the first hint. Add the syntax to the
  supported-subset list in the module comment.
- `css/a1.css`: a `.prose details.hint` rule beside the other `.prose` rules,
  with `cursor: pointer` on its `summary`, as `details.diff summary` has.
- `test/test_markdown.js`: next to the blockquote test, cover a hint with
  the default label, one with a custom label, a hint indented under a list
  item, and a plain `>` quote that still renders as `<blockquote>`. One
  sentence in the README's "Handouts in Markdown" section.

A hint works inside a list item already: an item longer than one line goes
back through `render_blocks` (`render_item`), so a quote indented under the
item renders as a hint. That covers the bullet in `w4i1.md`. The hint in
`w3p1.md` sits mid-paragraph in parentheses and has to move into its own
block. Verify the click in the browser, since `test_markdown.js` checks only
the markup.
