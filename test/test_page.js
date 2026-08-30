/**
 * The page skeleton, minus the DOM.
 *
 * `render_skeleton` and most of `ensure_stylesheet` need a real `document`,
 * so they belong to the browser rather than to Node. What is testable here is
 * how the module locates its own stylesheet, which is pure URL arithmetic and
 * the one piece that breaks silently when `src/` and `css/` move apart, and
 * `rubric_preview_html`, which is a pure function from criteria to markup and
 * is what keeps a handout's point breakdown honest.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../src/assert.js";
import { ensure_stylesheet, default_styles_href, rubric_preview_html } from "../src/page.js";

const CRITERIA = [
  { name: "Input handling", points: 10, description: "Prompts match exactly." },
  { name: "Correct output", points: 20, description: "Lines match exactly." },
  { name: "Use of Tabs", points: 2.5, description: "Formatted with tabs." },
];

test("default_styles_href resolves the stylesheet that ships beside src/", () => {
  const href = default_styles_href();
  assert.ok(href.startsWith("file:"), "an absolute URL, not a relative path");
  assert.ok(href.endsWith("/css/a1.css"));
  assert.equal(href, new URL("../css/a1.css", new URL("../src/page.js", import.meta.url)).href);
});

test("the stylesheet default points at a file that exists", async () => {
  const { existsSync } = await import("node:fs");
  assert.ok(existsSync(new URL(default_styles_href())), default_styles_href());
});

test("ensure_stylesheet adds nothing when the page opts out with an empty href", () => {
  // Checked before the DOM is touched, which is why it runs under Node.
  assert.equal(ensure_stylesheet(""), false);
});

test("ensure_stylesheet rejects a non-string href", () => {
  assert.throws(() => ensure_stylesheet(null), /href must be a string/);
});

test("the generated rubric carries one row per criterion, in order", () => {
  const html = rubric_preview_html({ criteria: CRITERIA });
  const names = [...html.matchAll(/<tr><td>([^<]+)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(names, ["Input handling", "Correct output", "Use of Tabs"]);
});

test("points render without trailing zeros, so 2.5 and 10 both read naturally", () => {
  const html = rubric_preview_html({ criteria: CRITERIA });
  assert.match(html, /<td class="align-right">10<\/td>/);
  assert.match(html, /<td class="align-right">2\.5<\/td>/);
  assert.ok(!html.includes("10.0"), html);
});

test("the total is summed from the criteria rather than taken on trust", () => {
  const html = rubric_preview_html({ criteria: CRITERIA });
  assert.match(html, /<strong>Total<\/strong>/);
  assert.match(html, /<strong>32\.5<\/strong>/);
});

test("the total says auto-graded only when instructor rows follow it", () => {
  assert.match(rubric_preview_html({ criteria: CRITERIA }), /<strong>Total<\/strong>/);
  assert.match(
    rubric_preview_html({
      criteria: CRITERIA,
      manual_rows: [{ name: "Constants", score: "manual / 5", description: "" }],
    }),
    /<strong>Total \(auto-graded\)<\/strong>/,
  );
});

test("a max_auto_points that disagrees with the criteria is a config bug", () => {
  assert.doesNotThrow(() => rubric_preview_html({ criteria: CRITERIA, max_auto_points: 32.5 }));
  assert.throws(
    () => rubric_preview_html({ criteria: CRITERIA, max_auto_points: 40 }),
    /criteria total 32.5 does not match max_auto_points 40/,
  );
});

test("manual rows sit below the total and keep their free-text score", () => {
  const html = rubric_preview_html({
    criteria: CRITERIA,
    manual_rows: [{ name: "Proper constants", score: "manual / 5", description: "Named." }],
  });
  assert.ok(html.indexOf("Total (auto-graded)") < html.indexOf("Proper constants"));
  assert.match(html, /<strong>32\.5<\/strong>/);
  assert.match(html, /<td class="align-right">manual \/ 5<\/td>/);
});

test("an empty rubric still renders a table with a zero total", () => {
  const html = rubric_preview_html({ criteria: [] });
  assert.match(html, /<strong>0<\/strong>/);
});

test("the heading defaults to Rubric and can be overridden", () => {
  assert.match(rubric_preview_html({ criteria: [] }), /<h2>Rubric<\/h2>/);
  assert.match(rubric_preview_html({ criteria: [], heading: "Grading" }), /<h2>Grading<\/h2>/);
});

test("a criterion name and description are escaped, not trusted", () => {
  const html = rubric_preview_html({
    criteria: [{ name: "<script>x</script>", points: 1, description: "a & b" }],
  });
  assert.ok(!html.includes("<script>"), html);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
});

test("a malformed criterion trips an assertion rather than rendering blank", () => {
  assert.throws(() => rubric_preview_html({ criteria: [{ points: 1 }] }), AssertionError);
  assert.throws(() => rubric_preview_html({ criteria: [{ name: "x" }] }), AssertionError);
  assert.throws(() => rubric_preview_html({ criteria: null }), AssertionError);
  assert.throws(() => rubric_preview_html(null), AssertionError);
});
