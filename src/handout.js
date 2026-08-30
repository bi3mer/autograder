/**
 * Fetching a handout and putting it on the page.
 *
 * An assignment page names a `.md` file; this fetches it, hands it to
 * `markdown.js`, and writes the result into a mount element. That is the whole
 * module: the parsing lives next door, and nothing here knows what a rubric is.
 *
 * The two pure halves, `resolve_handout_url` and `handout_error_html`, are
 * exported so Node can test them without a browser, the same split
 * `page.js` uses for `default_styles_href`.
 */

import { assert, assert_string, AssertionError } from "./assert.js";
import { HANDOUT_HREF_CHARS_MAX, MARKDOWN_BYTES_MAX } from "./constants.js";
import { escape_html } from "./html.js";
import { render_markdown } from "./markdown.js";
import { resolve_mount } from "./page.js";

/**
 * Handout paths are written relative to the assignment page, so `"w1p1.md"`
 * beside `cs230/w1p1.html` resolves against the page rather than against this
 * module. That is the opposite of how `page.js` finds its stylesheet, and it
 * is deliberate: the stylesheet ships with the engine, the handout ships with
 * the assignment.
 */
export function resolve_handout_url(href, base) {
  assert_string(href, "resolve_handout_url: href", HANDOUT_HREF_CHARS_MAX);
  assert(href.length > 0, "resolve_handout_url: href must not be empty");
  assert_string(base, "resolve_handout_url: base", HANDOUT_HREF_CHARS_MAX);
  const url = new URL(href, base).href;
  assert(url.length > 0, "resolve_handout_url: must resolve to a URL");
  return url;
}

/**
 * A failed handout names its reason in the space the prose would have taken.
 * A silent empty column would leave a student reading an assignment with no
 * statement and no clue that one was meant to be there.
 */
export function handout_error_html(reason, url) {
  assert_string(reason, "handout_error_html: reason", MARKDOWN_BYTES_MAX);
  assert_string(url, "handout_error_html: url", HANDOUT_HREF_CHARS_MAX);
  return `<p class="handout-error">Could not load the handout from `
    + `<code>${escape_html(url)}</code>: ${escape_html(reason)}</p>`;
}

/**
 * `load_handout` takes `{ href, mount }`, where `mount` is an element or a
 * selector. It resolves rather than throws, so a missing handout leaves the
 * grader beside it working.
 *
 * An `AssertionError` is re-raised rather than rendered: that is a defect in
 * the engine, not a fetch that went wrong, and the repository keeps those
 * loud.
 */
export async function load_handout(options) {
  assert(
    options != null && typeof options === "object",
    "load_handout: options must be an object",
  );
  assert(options.mount != null, "load_handout: mount is required");
  const mount = resolve_mount(options.mount, "load_handout");
  const url = resolve_handout_url(options.href, document.baseURI);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`the server answered ${response.status} ${response.statusText}`.trim());
    }
    mount.innerHTML = render_markdown(await response.text());
    return { ok: true, url };
  } catch (error) {
    if (error instanceof AssertionError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    mount.innerHTML = handout_error_html(reason, url);
    return { ok: false, url, reason };
  }
}
