/**
 * Escaping, which is what stands between a student's source and the rubric's
 * innerHTML. A submission containing `<script>` must render as text.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { escape_html } from "../src/html.js";

test("escape_html neutralises every character that could open a tag", () => {
  assert.equal(escape_html("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
});

test("escape_html renders a script tag as text", () => {
  assert.equal(
    escape_html('<script>alert("x")</script>'),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
  );
});

test("escape_html escapes quotes, so the output is safe inside an attribute", () => {
  assert.equal(escape_html('" onload="steal()'), "&quot; onload=&quot;steal()");
});

test("escape_html leaves ordinary text alone", () => {
  assert.equal(escape_html("Habit Costs for 2026"), "Habit Costs for 2026");
  assert.equal(escape_html(""), "");
});

test("escape_html escapes the ampersand once, not twice", () => {
  assert.equal(escape_html("&amp;"), "&amp;amp;");
});

test("escape_html coerces a non-string rather than throwing", () => {
  assert.equal(escape_html(42), "42");
  assert.equal(escape_html(null), "null");
  assert.equal(escape_html(undefined), "undefined");
});
