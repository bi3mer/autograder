import { assert } from "./assert.ts";

/** Characters that would otherwise open a tag or an entity. */
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Student source code lands in the rubric detail column verbatim, so a
 * submission containing `<script>` must render as text rather than run.
 * Quotes are escaped too, so the same function is safe inside an attribute.
 */
export function escape_html(value: unknown): string {
  const text = String(value);
  const escaped = text.replace(/[&<>"']/g, (character) => (
    ESCAPES[character as keyof typeof ESCAPES]
  ));
  assert(escaped.length >= text.length, "escape_html: escaping never shortens text");
  assert(!/[<>]/.test(escaped), "escape_html: no raw angle brackets may survive");
  return escaped;
}
