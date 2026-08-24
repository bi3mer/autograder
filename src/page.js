/**
 * The page skeleton, built in JavaScript.
 *
 * Every assignment page used to carry the same forty lines of markup: a
 * header, a drop zone, a button, an empty rubric container, and a summary
 * box. That markup is boilerplate, and boilerplate copied per assignment
 * drifts per assignment. {@link render_skeleton} builds it instead, so an
 * assignment page is a title, a stylesheet, and its data.
 *
 * A page that already provides the markup keeps working: `grader_app.init`
 * only renders when the elements are absent.
 *
 * @module page
 */

import { assert, assert_string } from "./assert.js";
import { NEEDLE_CHARS_MAX } from "./constants.js";
import { escape_html } from "./html.js";

/**
 * @typedef {import("./grader.js").ElementIds} ElementIds
 */

/**
 * @typedef {object} SkeletonOptions
 * @property {ElementIds} ids Element ids to stamp onto the generated markup.
 * @property {string} title Heading text.
 * @property {string} [subtitle] Sub-heading under the title.
 * @property {string} [headline_label] Caption under the score, e.g. `"/ 45 auto"`.
 * @property {string} [drop_prompt] Bold line in the drop zone.
 * @property {string} [drop_hint] Small line under the drop prompt.
 * @property {string} [accept=".py"] `accept` attribute for the file input.
 * @property {string} [footer] Footer text; omitted when absent.
 * @property {HTMLElement} mount Element the skeleton renders into.
 */

/** Small line under the drop prompt, when the caller supplies none. */
const DROP_HINT_DEFAULT = "or click to choose a file · runs entirely in your browser";

/**
 * URL of the script tag that loaded this bundle, or `""` when unknown.
 *
 * Read at module evaluation, which for the IIFE bundle is while its own
 * `<script>` is executing, so `currentScript` is that tag. It is the anchor
 * for finding `css/a1.css` next to `dist/`, which is what lets a page skip
 * the stylesheet link. Module builds report `null` here, so an ES module
 * consumer passes `styles_href` explicitly or links the stylesheet itself.
 */
const BUNDLE_SRC = typeof document !== "undefined" && document.currentScript instanceof HTMLScriptElement
  ? document.currentScript.src
  : "";

/**
 * Resolve the stylesheet that ships beside the bundle.
 *
 * @returns {string} Absolute URL of `css/a1.css`, or `""` when the bundle's
 *   own location is unknown.
 */
export function default_styles_href() {
  if (BUNDLE_SRC === "") return "";
  const href = new URL("../css/a1.css", BUNDLE_SRC).href;
  assert(href.endsWith("a1.css"), "default_styles_href: must resolve to the stylesheet");
  return href;
}

/**
 * Add a stylesheet link, unless the page already loads that same file.
 *
 * @param {string} href Stylesheet URL; `""` is a no-op.
 * @returns {boolean} True when a link was added.
 */
export function ensure_stylesheet(href) {
  assert(typeof href === "string", "ensure_stylesheet: href must be a string");
  if (href === "") return false;
  const absolute = new URL(href, document.baseURI).href;
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  for (let index = 0; index < links.length; index++) {
    const link = /** @type {HTMLLinkElement} */ (links[index]);
    if (link.href === absolute) return false;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = absolute;
  link.dataset.autograderStyles = "";
  document.head.appendChild(link);
  assert(document.head.contains(link), "ensure_stylesheet: link must be attached");
  return true;
}

/**
 * Build the header: title, subtitle, and the running score.
 *
 * @param {SkeletonOptions} options Skeleton options.
 * @returns {string} Header markup.
 */
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

/**
 * Build the body: drop zone, grade button, rubric, and summary box.
 *
 * @param {SkeletonOptions} options Skeleton options.
 * @returns {string} Body markup.
 */
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
 * Render the page skeleton into `options.mount`.
 *
 * The markup is appended rather than assigned, so a page may put its own
 * content (a course banner, a link back to the syllabus) around the grader.
 *
 * @param {SkeletonOptions} options Skeleton options.
 * @returns {void}
 */
export function render_skeleton(options) {
  assert(options != null && typeof options === "object", "render_skeleton: options must be an object");
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
