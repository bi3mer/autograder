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

import { assert, assert_array, assert_range, assert_string } from "./assert.js";
import {
  CRITERION_COUNT_MAX,
  MANUAL_ROW_COUNT_MAX,
  NEEDLE_CHARS_MAX,
  POINTS_MAX,
} from "./constants.js";
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

/**
 * An element, a CSS selector, or nothing at all (which means the body). Both
 * `grader.init` and `load_handout` take a mount, so the resolution lives here
 * rather than twice; `name` is the caller, so a bad selector names the call
 * that carried it.
 */
export function resolve_mount(mount, name) {
  assert(
    typeof name === "string" && name.length > 0,
    "resolve_mount: name must be a non-empty string",
  );
  if (mount == null) return document.body;
  if (typeof mount === "string") {
    const found = document.querySelector(mount);
    assert(found != null, `${name}: no element matches the mount selector "${mount}"`);
    return found;
  }
  assert(mount instanceof HTMLElement, `${name}: mount must be an element or a selector`);
  return mount;
}

/** Heading the generated rubric sits under, inside the handout column. */
const RUBRIC_HEADING_DEFAULT = "Rubric";

/** 2.5 stays "2.5", and 10 stays "10" rather than becoming "10.0". */
function points_text(points, name) {
  assert_range(points, name, 0, POINTS_MAX);
  return String(Math.round(points * 100) / 100);
}

function criterion_row_html(criterion, index) {
  assert(criterion != null, `rubric_preview_html: criteria[${index}] must not be null`);
  assert_string(criterion.name, `rubric_preview_html: criteria[${index}].name`, NEEDLE_CHARS_MAX);
  const points = points_text(criterion.points, `rubric_preview_html: criteria[${index}].points`);
  const description = criterion.description ?? "";
  assert_string(
    description,
    `rubric_preview_html: criteria[${index}].description`,
    NEEDLE_CHARS_MAX,
  );
  return `<tr><td>${escape_html(criterion.name)}</td>`
    + `<td class="align-right">${points}</td>`
    + `<td>${escape_html(description)}</td></tr>`;
}

/**
 * A manual row carries its points as free text (`"manual / 5"`), so it cannot
 * be added up and sits below the auto-graded total rather than inside it.
 */
function manual_row_html(row, index) {
  assert(row != null, `rubric_preview_html: manual_rows[${index}] must not be null`);
  assert_string(row.name, `rubric_preview_html: manual_rows[${index}].name`, NEEDLE_CHARS_MAX);
  const score = row.score ?? "";
  assert_string(score, `rubric_preview_html: manual_rows[${index}].score`, NEEDLE_CHARS_MAX);
  const description = row.description ?? "";
  return `<tr><td>${escape_html(row.name)}</td>`
    + `<td class="align-right">${escape_html(score)}</td>`
    + `<td>${escape_html(description)}</td></tr>`;
}

/**
 * The rubric a student reads, built from the same `build_criteria` the grader
 * scores with.
 *
 * A handout that writes its own point breakdown can promise points the grader
 * does not award, and that drift is invisible until someone compares the two
 * by hand. Generating the table removes the second copy: there is one source
 * for what each row is worth, and it is the source the grading runs against.
 *
 * Takes `{ criteria, manual_rows, max_auto_points, heading }` and returns
 * markup for the handout column, styled by the `.prose table` rules.
 */
export function rubric_preview_html(options) {
  assert(
    options != null && typeof options === "object",
    "rubric_preview_html: options must be an object",
  );
  const criteria = assert_array(
    options.criteria,
    "rubric_preview_html: criteria",
    CRITERION_COUNT_MAX,
  );
  const manual_rows = assert_array(
    options.manual_rows ?? [],
    "rubric_preview_html: manual_rows",
    MANUAL_ROW_COUNT_MAX,
  );
  const heading = options.heading ?? RUBRIC_HEADING_DEFAULT;

  let total = 0;
  const rows = criteria.map((criterion, index) => {
    total += criterion.points;
    return criterion_row_html(criterion, index);
  });
  total = Math.round(total * 100) / 100;
  // The denominator beside the score and the rows above it come from the same
  // config, so a mismatch means a student is shown a total they cannot reach.
  assert(
    options.max_auto_points === undefined || total === options.max_auto_points,
    `rubric_preview_html: criteria total ${total} does not match `
      + `max_auto_points ${options.max_auto_points}`,
  );
  // The qualifier earns its place only when instructor-graded rows follow the
  // total; without them "Total" is unambiguous and does not wrap the column.
  const total_label = manual_rows.length > 0 ? "Total (auto-graded)" : "Total";
  rows.push(
    `<tr><td><strong>${escape_html(total_label)}</strong></td>`
    + `<td class="align-right"><strong>${points_text(total, "rubric total")}</strong></td>`
    + `<td></td></tr>`,
  );
  for (let index = 0; index < manual_rows.length; index++) {
    rows.push(manual_row_html(manual_rows[index], index));
  }

  return `<h2>${escape_html(heading)}</h2>\n<table>\n`
    + `<thead><tr><th>Criterion</th><th class="align-right">Points</th>`
    + `<th>Description</th></tr></thead>\n`
    + `<tbody>\n${rows.join("\n")}\n</tbody>\n</table>`;
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
