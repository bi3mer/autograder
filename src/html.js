/**
 * HTML text helpers shared by the rubric renderer and the page glue.
 * @module html
 */

import { assert } from "./assert.js";

/** Characters that would otherwise open a tag or an entity. */
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escape text for interpolation into HTML.
 *
 * Student source code lands in the rubric detail column verbatim, so a
 * submission containing `<script>` must render as text rather than run.
 * Quotes are escaped too, so the same function is safe inside an attribute.
 *
 * @param {unknown} value Value to render as text; coerced with `String`.
 * @returns {string} `value` with `&<>"'` replaced by entities.
 */
export function escape_html(value) {
  const text = String(value);
  const escaped = text.replace(/[&<>"']/g, (character) => (
    ESCAPES[/** @type {keyof typeof ESCAPES} */ (character)]
  ));
  assert(escaped.length >= text.length, "escape_html: escaping never shortens text");
  assert(!/[<>]/.test(escaped), "escape_html: no raw angle brackets may survive");
  return escaped;
}
