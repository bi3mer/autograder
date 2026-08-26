/**
 * The page skeleton, built in code rather than markup.
 *
 * Every assignment page used to carry the same forty lines of markup: a
 * header, a drop zone, a button, an empty rubric container, and a summary
 * box. That markup is boilerplate, and boilerplate copied per assignment
 * drifts per assignment. `render_skeleton` builds it instead, so an
 * assignment page is a title, a stylesheet, and its data.
 *
 * A page that already provides the markup keeps working: `grader_app.init`
 * only renders when the elements are absent.
 */

import { assert, assert_string } from "./assert.js";
import { NEEDLE_CHARS_MAX } from "./constants.js";
import { escape_html } from "./html.js";

/**
 * `render_skeleton` takes one options object: `ids` (the element ids the
 * grader wires up), `mount` (the element the sheet is appended to), `title`
 * (the heading), and the optional `subtitle`, `headline_label` (the caption
 * under the score, e.g. `"/ 45 auto"`), `drop_prompt` (the bold line in the
 * drop zone), `drop_hint` (the small line under it), `accept` (the file
 * input's `accept` attribute), and `footer`, which is omitted when absent.
 */

const DROP_HINT_DEFAULT = "or click to choose a file · runs entirely in your browser";

/**
 * This module's own URL, which is the anchor for finding `css/a1.css` beside
 * `src/`, and what lets an assignment page skip the stylesheet link. The
 * browser resolves `import.meta.url` for a module the same way whether the
 * page loaded it directly or another module imported it.
 */
const MODULE_SRC = import.meta.url;

/** The stylesheet that ships with the grader, as an absolute URL. */
export function default_styles_href() {
  const href = new URL("../css/a1.css", MODULE_SRC).href;
  assert(href.endsWith("a1.css"), "default_styles_href: must resolve to the stylesheet");
  return href;
}

/** Adds nothing when the page already loads that same file, or when `href` is `""`. */
export function ensure_stylesheet(href) {
  assert(typeof href === "string", "ensure_stylesheet: href must be a string");
  if (href === "") return false;
  const absolute = new URL(href, document.baseURI).href;
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  for (let index = 0; index < links.length; index++) {
    if (links[index].href === absolute) return false;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = absolute;
  link.dataset.autograderStyles = "";
  document.head.appendChild(link);
  assert(document.head.contains(link), "ensure_stylesheet: link must be attached");
  return true;
}

function header_html(options) {
  assert_string(options.title, "page: title", NEEDLE_CHARS_MAX);
  assert(options.title.length > 0, "page: title must not be empty");
  const subtitle = options.subtitle
    ? `<div class="sub">${escape_html(options.subtitle)}</div>`
    : "";
  const label = options.headline_label ?? "";
  return `
    <header>
      <div class="title-block">
        <h1>${escape_html(options.title)}</h1>
        ${subtitle}
      </div>
      <div class="points-of">
        <div class="big" id="${options.ids.headline}">—</div>
        <div class="lbl">${escape_html(label)}</div>
      </div>
    </header>`;
}

function body_html(options) {
  const { ids } = options;
  const prompt = options.drop_prompt ?? "Drop your submission here";
  const hint = options.drop_hint ?? DROP_HINT_DEFAULT;
  return `
    <div class="body">
      <label class="drop" id="${ids.drop}">
        <strong>${escape_html(prompt)}</strong>
        <span>${escape_html(hint)}</span>
        <div class="filename" id="${ids.filename}"></div>
        <input type="file" id="${ids.file}" accept="${escape_html(options.accept ?? ".py")}" />
      </label>

      <div class="actions">
        <button id="${ids.run}" disabled>Grade submission</button>
        <span class="status" id="${ids.status}">Loading Python runtime…</span>
      </div>

      <div class="rubric" id="${ids.rubric}"></div>

      <div id="${ids.zero}" style="display:none" class="zero-banner"></div>

      <div class="summarybox" id="${ids.summary_box}" style="display:none">
        <div class="summarybox-head">
          <span class="word">Summary</span>
          <span class="copy-wrap">
            <span class="status" id="${ids.copy_status}"></span>
            <button id="${ids.copy}" class="ghost">Copy to clipboard</button>
          </span>
        </div>
        <textarea id="${ids.summary}" readonly spellcheck="false"></textarea>
      </div>
    </div>`;
}

/**
 * The markup is appended rather than assigned, so a page may put its own
 * content (a course banner, a link back to the syllabus) around the grader.
 */
export function render_skeleton(options) {
  assert(
    options != null && typeof options === "object",
    "render_skeleton: options must be an object",
  );
  assert(options.mount != null, "render_skeleton: mount must be an element");
  assert(options.ids != null, "render_skeleton: ids must be provided");

  const footer = options.footer
    ? `<footer>${escape_html(options.footer)}</footer>`
    : "";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.innerHTML = header_html(options) + body_html(options);
  options.mount.appendChild(sheet);
  if (footer !== "") options.mount.insertAdjacentHTML("beforeend", footer);

  assert(
    document.getElementById(options.ids.run) != null,
    "render_skeleton: the grade button must exist after rendering",
  );
  assert(
    document.getElementById(options.ids.summary) != null,
    "render_skeleton: the summary box must exist after rendering",
  );
}
