/**
 * The assignments themselves: every `cs230/<id>.js`, and the pages that
 * reach them.
 *
 * `cs230/assignment.html?id=<id>` and the terminal grader both find an
 * assignment by nothing but its id, so the ways that can break are all
 * mismatches between files: a module the index never links, a link to a
 * module that is not there, a page module without its handout, or rules
 * `grade_source` would reject. Each is a missing file or a typo, cheap to
 * catch here and invisible until a student opens the page otherwise.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { ASSIGNMENT_ID_PATTERN } from "../src/constants.js";
import { check_assignment } from "../src/grader.js";

const CS230 = new URL("../cs230/", import.meta.url);

const IDS = readdirSync(CS230)
  .filter((name) => name.endsWith(".js"))
  .map((name) => name.slice(0, -".js".length))
  .sort();

const MODULES = new Map();
for (const id of IDS) MODULES.set(id, await import(new URL(`${id}.js`, CS230).href));

test("there are assignments, and every id is one the page and the terminal accept", () => {
  assert.ok(IDS.length > 0);
  for (const id of IDS) assert.ok(ASSIGNMENT_ID_PATTERN.test(id), id);
});

test("every assignment's rules pass the checks grade_source makes", () => {
  for (const [id, module] of MODULES) {
    assert.doesNotThrow(() => check_assignment(module.assignment), id);
    // The handout's rubric is built from no results at all.
    assert.ok(Array.isArray(module.assignment.build_criteria([])), id);
  }
});

test("every assignment has a page: the shared one, with a handout, or its own", () => {
  for (const [id, module] of MODULES) {
    if (module.page === undefined) {
      assert.ok(existsSync(new URL(`${id}.html`, CS230)), `${id} has no page export and no ${id}.html`);
      continue;
    }
    assert.equal(typeof module.page.title, "string", id);
    assert.ok(module.page.title.length > 0, id);
    assert.equal(typeof module.page.editor, "boolean", id);
    assert.ok(existsSync(new URL(`${id}.md`, CS230)), `${id} has no handout ${id}.md`);
  }
});

test("the index links every shared-page assignment, and only ones that exist", () => {
  const index = readFileSync(new URL("index.html", CS230), "utf8");
  const linked = [...index.matchAll(/href="assignment\.html\?id=([^"]+)"/g)].map((m) => m[1]);
  for (const id of linked) {
    assert.ok(MODULES.get(id)?.page !== undefined, `index links ${id}, which has no page export`);
  }
  for (const [id, module] of MODULES) {
    if (module.page !== undefined) assert.ok(linked.includes(id), `index does not link ${id}`);
  }
});

test("the 404 page redirects old links by the same id pattern", () => {
  const not_found = readFileSync(new URL("../404.html", import.meta.url), "utf8");
  const body = ASSIGNMENT_ID_PATTERN.source.replace(/^\^/, "").replace(/\$$/, "");
  assert.ok(not_found.includes(body), "404.html's copy of ASSIGNMENT_ID_PATTERN has drifted");
});
