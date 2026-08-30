/**
 * The in-page code editor: a textarea that behaves like one.
 *
 * A plain textarea is unusable for Python. Tab moves focus to the next control
 * instead of indenting, and Enter drops the cursor back to column zero, so a
 * student fights the box on every line of a nested block. This module supplies
 * the four behaviours that fix that, plus a line-number gutter, so an error
 * reported at line 12 names something a student can see.
 *
 * The pure half is separated from the DOM half deliberately, the way `page.js`
 * splits `default_styles_href` from `render_skeleton`: the indent arithmetic is
 * where the bugs would be, and Node can test it without a browser.
 *
 * The shapes this module hands around:
 *
 * - An edit is `{ text, start, end, from, to, insert }`. The first three are
 *   the whole document and where the selection lands after applying it; the
 *   last three are the smallest replacement that produces it, which is what
 *   the DOM half hands to the browser so a student's undo history survives.
 * - `wire_editor` returns a handle, `{ get_value, set_value, focus_line }`.
 */

import { assert, assert_range, assert_string } from "./assert.js";
import {
  DRAFT_BYTES_MAX,
  EDITOR_INDENT_SPACES,
  EDITOR_LINE_COUNT_MAX,
  FILENAME_CHARS_MAX,
  HANDOUT_HREF_CHARS_MAX,
  SOURCE_BYTES_MAX,
  STDIN_LINE_COUNT_MAX,
} from "./constants.js";

const INDENT = " ".repeat(EDITOR_INDENT_SPACES);

/** Spaces at the front of a line. Only spaces: this editor never inserts tabs. */
function leading_spaces(line) {
  assert(typeof line === "string", "leading_spaces: line must be a string");
  const match = /^ */.exec(line);
  assert(match != null, "leading_spaces: the pattern always matches");
  return match[0].length;
}

/**
 * The indent a new line should open with, given the line above it.
 *
 * A line ending in `:` opens a block, so the next line steps in. Everything
 * else keeps the indent it had, which is what makes a run of statements line
 * up without the student pressing space four times per line.
 */
export function next_indent(line) {
  assert_string(line, "next_indent: line", SOURCE_BYTES_MAX);
  const base = " ".repeat(leading_spaces(line));
  // A trailing comment does not cancel the colon that opened the block.
  const code = line.replace(/#.*$/, "").trimEnd();
  return code.endsWith(":") ? base + INDENT : base;
}

/**
 * Tab and Shift+Tab. A collapsed cursor inserts one step; any selection
 * indents or dedents every line it touches, which is how a student moves a
 * whole block into an `if` after writing it flat.
 */
export function indent_selection(text, start, end, dedent = false) {
  assert_string(text, "indent_selection: text", SOURCE_BYTES_MAX);
  assert_range(start, "indent_selection: start", 0, text.length);
  assert_range(end, "indent_selection: end", start, text.length);
  assert(typeof dedent === "boolean", "indent_selection: dedent must be a boolean");

  if (start === end && !dedent) {
    return {
      text: text.slice(0, start) + INDENT + text.slice(start),
      start: start + INDENT.length,
      end: start + INDENT.length,
      from: start,
      to: start,
      insert: INDENT,
    };
  }

  const block_start = text.lastIndexOf("\n", start - 1) + 1;
  const newline_after = text.indexOf("\n", end);
  const block_end = newline_after === -1 ? text.length : newline_after;
  const lines = text.slice(block_start, block_end).split("\n");
  assert(lines.length <= EDITOR_LINE_COUNT_MAX, "indent_selection: selection is too long");

  let head_delta = 0;
  let total_delta = 0;
  const shifted = lines.map((line, index) => {
    const moved = dedent
      ? line.slice(Math.min(EDITOR_INDENT_SPACES, leading_spaces(line)))
      : INDENT + line;
    const delta = moved.length - line.length;
    if (index === 0) head_delta = delta;
    total_delta += delta;
    return moved;
  });

  const insert = shifted.join("\n");
  return {
    text: text.slice(0, block_start) + insert + text.slice(block_end),
    // A dedent must not drag the cursor behind the line it started on.
    start: Math.max(block_start, start + head_delta),
    end: Math.max(block_start, end + total_delta),
    from: block_start,
    to: block_end,
    insert,
  };
}

/** Enter: break the line and open the next one at the right depth. */
export function break_line(text, start, end) {
  assert_string(text, "break_line: text", SOURCE_BYTES_MAX);
  assert_range(start, "break_line: start", 0, text.length);
  assert_range(end, "break_line: end", start, text.length);

  const line_start = text.lastIndexOf("\n", start - 1) + 1;
  const insert = "\n" + next_indent(text.slice(line_start, start));
  const caret = start + insert.length;
  return {
    text: text.slice(0, start) + insert + text.slice(end),
    start: caret,
    end: caret,
    from: start,
    to: end,
    insert,
  };
}

/**
 * Where a one-based line begins, in characters. This is what turns the `line`
 * on a run result into a cursor a student can be sent to. A line past the end
 * clamps rather than throwing: an error can name a line the student has since
 * deleted.
 */
export function line_offset(text, line) {
  assert_string(text, "line_offset: text", SOURCE_BYTES_MAX);
  assert_range(line, "line_offset: line", 1, EDITOR_LINE_COUNT_MAX);
  let offset = 0;
  for (let number = 1; number < line; number++) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  assert(offset <= text.length, "line_offset: offset must fall inside the text");
  return offset;
}

/** The gutter's contents: one number per line, so it lines up with the text. */
export function gutter_text(text) {
  assert_string(text, "gutter_text: text", SOURCE_BYTES_MAX);
  const count = text.split("\n").length;
  assert(count <= EDITOR_LINE_COUNT_MAX, `gutter_text: over ${EDITOR_LINE_COUNT_MAX} lines`);
  const numbers = [];
  for (let number = 1; number <= count; number++) numbers.push(String(number));
  assert(numbers.length === count, "gutter_text: one number per line");
  return numbers.join("\n");
}

/** The stdin box is one line of input per line of text. */
export function stdin_lines_from_text(text) {
  assert_string(text, "stdin_lines_from_text: text", SOURCE_BYTES_MAX);
  const lines = text.replace(/\r/g, "").split("\n");
  // A box the student typed into ends in a newline they did not mean as input.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  assert(
    lines.length <= STDIN_LINE_COUNT_MAX,
    `stdin_lines_from_text: over ${STDIN_LINE_COUNT_MAX} lines`,
  );
  return lines;
}

/**
 * Where one page's draft lives. The path is in the key because every
 * assignment is a separate page on one origin, and they would otherwise
 * overwrite each other's work.
 */
export function draft_key(path, filename) {
  assert_string(path, "draft_key: path", HANDOUT_HREF_CHARS_MAX);
  assert_string(filename, "draft_key: filename", FILENAME_CHARS_MAX);
  assert(filename.length > 0, "draft_key: filename must not be empty");
  return `autograder:draft:${path}:${filename}`;
}

/**
 * Storage is a convenience, never a requirement: a private window, or a
 * browser set to block site data, throws on access rather than returning
 * empty. A student in that window still gets a working editor, they just do
 * not get their draft back.
 */
export function load_draft(key) {
  assert_string(key, "load_draft: key", HANDOUT_HREF_CHARS_MAX);
  try {
    const value = globalThis.localStorage?.getItem(key);
    return typeof value === "string" && value.length <= DRAFT_BYTES_MAX ? value : null;
  } catch {
    return null;
  }
}

export function save_draft(key, text) {
  assert_string(key, "save_draft: key", HANDOUT_HREF_CHARS_MAX);
  assert_string(text, "save_draft: text", SOURCE_BYTES_MAX);
  if (text.length > DRAFT_BYTES_MAX) return false;
  try {
    globalThis.localStorage?.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

export function clear_draft(key) {
  assert_string(key, "clear_draft: key", HANDOUT_HREF_CHARS_MAX);
  try {
    globalThis.localStorage?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply an edit to a live textarea.
 *
 * `execCommand` is deprecated and used on purpose: it is the only way to
 * change a textarea's contents that leaves the browser's own undo history
 * intact. A student who presses Tab and then Ctrl+Z expects the Tab back, not
 * an empty box. Assigning `.value` wipes that history, so it is the fallback
 * rather than the path.
 */
function apply_edit(textarea, edit) {
  assert(textarea != null, "apply_edit: textarea must not be null");
  assert(edit != null, "apply_edit: edit must not be null");
  textarea.focus();
  textarea.setSelectionRange(edit.from, edit.to);
  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, edit.insert);
  } catch {
    inserted = false;
  }
  if (!inserted || textarea.value !== edit.text) textarea.value = edit.text;
  textarea.setSelectionRange(edit.start, edit.end);
}

/**
 * Wire a textarea and its gutter into an editor.
 *
 * Takes `{ textarea, gutter }` and the hooks `{ on_change, on_run }`, and
 * returns `{ get_value, set_value, focus_line }`. The markup itself comes from
 * `page.js`, the same way the grader's does, so a page that writes its own
 * keeps it.
 */
export function wire_editor(elements, hooks = {}) {
  assert(elements != null && typeof elements === "object", "wire_editor: elements required");
  assert(elements.textarea != null, "wire_editor: a textarea is required");
  assert(elements.gutter != null, "wire_editor: a gutter is required");
  assert(hooks != null && typeof hooks === "object", "wire_editor: hooks must be an object");
  const { textarea, gutter } = elements;
  const on_change = hooks.on_change ?? (() => {});
  const on_run = hooks.on_run ?? (() => {});
  assert(typeof on_change === "function", "wire_editor: on_change must be a function");
  assert(typeof on_run === "function", "wire_editor: on_run must be a function");

  function sync() {
    gutter.textContent = gutter_text(textarea.value);
    on_change(textarea.value);
  }

  textarea.addEventListener("input", sync);
  // The gutter is a separate element, so it has to be told where the text went.
  textarea.addEventListener("scroll", () => {
    gutter.scrollTop = textarea.scrollTop;
  });

  textarea.addEventListener("keydown", (event) => {
    const { value, selectionStart, selectionEnd } = textarea;
    if (event.key === "Tab") {
      event.preventDefault();
      apply_edit(textarea, indent_selection(value, selectionStart, selectionEnd, event.shiftKey));
      sync();
      return;
    }
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      apply_edit(textarea, break_line(value, selectionStart, selectionEnd));
      sync();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      on_run();
    }
  });

  const handle = {
    get_value: () => textarea.value,
    set_value: (text) => {
      assert_string(text, "editor.set_value: text", SOURCE_BYTES_MAX);
      textarea.value = text;
      sync();
    },
    /** Put the cursor on a line an error named, and scroll it into view. */
    focus_line: (line, col) => {
      assert_range(line, "editor.focus_line: line", 1, EDITOR_LINE_COUNT_MAX);
      const offset = line_offset(textarea.value, line)
        + Math.max(0, (col ?? 1) - 1);
      const caret = Math.min(offset, textarea.value.length);
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      // Roughly centre the line rather than leaving it against the top edge.
      const line_height = textarea.scrollHeight / Math.max(1, textarea.value.split("\n").length);
      textarea.scrollTop = Math.max(0, (line - 1) * line_height - textarea.clientHeight / 2);
      gutter.scrollTop = textarea.scrollTop;
    },
  };
  sync();
  return handle;
}
