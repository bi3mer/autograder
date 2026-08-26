/**
 * The page skeleton, minus the DOM.
 *
 * `render_skeleton` and most of `ensure_stylesheet` need a real `document`,
 * so they belong to the browser rather than to Node. What is testable here is
 * how the module locates its own stylesheet, which is pure URL arithmetic and
 * the one piece that breaks silently when `src/` and `css/` move apart.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ensure_stylesheet, default_styles_href } from "../src/page.js";

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
