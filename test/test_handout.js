/**
 * Fetching a handout, minus the browser.
 *
 * `load_handout` needs `fetch` and a real `document`, so it belongs to the
 * browser rather than to Node, the same call `test_page.js` makes about
 * `render_skeleton`. What is testable here is where a handout path resolves
 * to and what a failure puts on the page, which are the two halves that break
 * silently.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../src/assert.js";
import { HANDOUT_HREF_CHARS_MAX } from "../src/constants.js";
import { handout_error_html, resolve_handout_url } from "../src/handout.js";

const PAGE = "https://example.com/cs230/w1p1.html";

test("a bare filename resolves beside the assignment page, not beside src/", () => {
  assert.equal(resolve_handout_url("w1p1.md", PAGE), "https://example.com/cs230/w1p1.md");
});

test("relative and absolute paths resolve against the page's origin", () => {
  assert.equal(resolve_handout_url("../shared/x.md", PAGE), "https://example.com/shared/x.md");
  assert.equal(resolve_handout_url("/x.md", PAGE), "https://example.com/x.md");
});

test("an absolute URL is left as it stands", () => {
  const url = "https://other.example/handout.md";
  assert.equal(resolve_handout_url(url, PAGE), url);
});

test("an empty or missing href fails rather than resolving to the page itself", () => {
  assert.throws(() => resolve_handout_url("", PAGE), /must not be empty/);
  assert.throws(() => resolve_handout_url(null, PAGE), AssertionError);
  assert.throws(() => resolve_handout_url(undefined, PAGE), AssertionError);
});

test("an href past the character ceiling fails at the boundary", () => {
  assert.throws(
    () => resolve_handout_url("x".repeat(HANDOUT_HREF_CHARS_MAX + 1), PAGE),
    /exceeds/,
  );
});

test("a failure names both the reason and the URL it tried", () => {
  const html = handout_error_html("the server answered 404 Not Found", "https://x/y.md");
  assert.match(html, /404 Not Found/);
  assert.match(html, /https:\/\/x\/y\.md/);
});

test("a failure message escapes whatever the error carried", () => {
  const html = handout_error_html("<script>alert(1)</script>", "https://x/y.md");
  assert.ok(!html.includes("<script>"), html);
  assert.match(html, /&lt;script&gt;/);
});
