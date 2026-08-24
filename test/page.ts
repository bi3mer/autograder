/**
 * DOM tests for the generated page skeleton.
 *
 * jsdom stands in for the browser: it parses the generated markup the same
 * way, which is enough to check that every element the grader wires up
 * exists, that a hand-written page keeps its own markup, and that a missing
 * element fails loudly rather than silently.
 */

import assert_node from "node:assert/strict";
import { JSDOM } from "jsdom";
import { AssertionError } from "../src/assert.ts";
import type { GraderConfig } from "../src/grader.ts";

let passed = 0;

/** Each test gets a fresh document, with the globals restored afterwards. */
async function test(
  name: string,
  body: (dom: JSDOM) => void | Promise<void>,
  html = "<!doctype html><title>Habit Cost</title>",
): Promise<void> {
  const dom = new JSDOM(html, { url: "https://example.test/cs230/a1.html" });
  const global_scope = globalThis as unknown as {
    document: Document,
    HTMLElement: typeof HTMLElement,
    HTMLScriptElement: typeof HTMLScriptElement,
  };
  const previous = {
    document: global_scope.document,
    HTMLElement: global_scope.HTMLElement,
  };
  global_scope.document = dom.window.document;
  global_scope.HTMLElement = dom.window.HTMLElement;
  global_scope.HTMLScriptElement = dom.window.HTMLScriptElement;
  try {
    await body(dom);
  } finally {
    Object.assign(globalThis, previous);
  }
  passed++;
  console.log(`  ok  ${name}`);
}

const { grader_app } = await import("../src/index.ts");

const CONFIG: GraderConfig = {
  filename: "program1.py",
  cases: [{ name: "one", stdin_lines: ["x"], expected_lines: ["x"] }],
  build_criteria: () => [],
  max_auto_points: 45,
  subtitle: "Assignment 1 · program1.py",
  footer: "Runs in your browser.",
};

await test("init renders every element the grader wires up", (dom) => {
  grader_app.init({ ...CONFIG });
  const ids = ["status", "run", "drop", "file", "filename", "rubric", "zero",
    "headline", "summarybox", "summary", "copy", "copystatus"];
  for (const id of ids) {
    assert_node.ok(dom.window.document.getElementById(id) != null, `missing #${id}`);
  }
  assert_node.equal(dom.window.document.querySelectorAll(".sheet").length, 1);
});

await test("the heading defaults to the document title", (dom) => {
  grader_app.init({ ...CONFIG });
  assert_node.equal(dom.window.document.querySelector("h1")?.textContent, "Habit Cost");
  assert_node.equal(
    dom.window.document.querySelector(".sub")?.textContent,
    "Assignment 1 · program1.py",
  );
  assert_node.equal(
    dom.window.document.querySelector("footer")?.textContent,
    "Runs in your browser.",
  );
});

await test("the drop prompt and score caption come from the config", (dom) => {
  grader_app.init({ ...CONFIG });
  assert_node.equal(
    dom.window.document.querySelector(".drop strong")?.textContent,
    "Drop program1.py here",
  );
  assert_node.equal(
    dom.window.document.querySelector(".points-of .lbl")?.textContent,
    "/ 45 auto",
  );
  assert_node.equal(dom.window.document.getElementById("headline")?.textContent, "—");
});

await test("a title containing markup is escaped, not injected", (dom) => {
  grader_app.init({ ...CONFIG, title: "<img src=x onerror=alert(1)>" });
  assert_node.equal(dom.window.document.querySelectorAll("img").length, 0);
  assert_node.equal(
    dom.window.document.querySelector("h1")?.textContent,
    "<img src=x onerror=alert(1)>",
  );
});

await test("a page that supplies its own markup keeps it", (dom) => {
  grader_app.init({ ...CONFIG });
  assert_node.equal(dom.window.document.querySelectorAll(".sheet").length, 0);
  assert_node.equal(dom.window.document.getElementById("run")?.textContent, "Mine");
}, `<!doctype html><title>T</title><body>
  <button id="run" disabled>Mine</button><span id="status"></span>
  <label id="drop"><span id="filename"></span><input type="file" id="file"></label>
  <div id="rubric"></div><div id="zero"></div><div id="headline"></div>
  <div id="summarybox"><span id="copystatus"></span><button id="copy"></button>
  <textarea id="summary"></textarea></div></body>`);

await test("a half-written page fails loudly on the missing element", () => {
  assert_node.throws(() => grader_app.init({ ...CONFIG }), (error: unknown) => {
    assert_node.ok(error instanceof AssertionError);
    assert_node.match(error.message, /page is missing an element with id "status"/);
    return true;
  });
}, `<!doctype html><title>T</title><body><button id="run"></button></body>`);

await test("mount places the skeleton inside the given element", (dom) => {
  grader_app.init({ ...CONFIG, mount: "#here" });
  const host = dom.window.document.getElementById("here");
  assert_node.equal(host?.querySelectorAll(".sheet").length, 1);
  assert_node.equal(dom.window.document.body.querySelector(":scope > .sheet"), null);
}, `<!doctype html><title>T</title><body><div id="here"></div></body>`);

await test("styles_href adds one stylesheet link, and only one", (dom) => {
  grader_app.init({ ...CONFIG, styles_href: "../css/a1.css" });
  const links = dom.window.document.querySelectorAll('link[rel="stylesheet"]');
  assert_node.equal(links.length, 1);
  assert_node.equal(links[0].getAttribute("href"), "https://example.test/css/a1.css");
});

await test("a stylesheet the page already links is not added twice", (dom) => {
  grader_app.init({ ...CONFIG, styles_href: "../css/a1.css" });
  assert_node.equal(dom.window.document.querySelectorAll('link[rel="stylesheet"]').length, 1);
}, '<!doctype html><title>T</title><link rel="stylesheet" href="/css/a1.css"><body></body>');

await test("styles_href false adds no link", (dom) => {
  grader_app.init({ ...CONFIG, styles_href: false });
  assert_node.equal(dom.window.document.querySelectorAll("link").length, 0);
});

await test("a page with no Pyodide reports it instead of hanging", async (dom) => {
  grader_app.init({ ...CONFIG, styles_href: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = dom.window.document.getElementById("status")?.textContent ?? "";
  assert_node.match(status, /Python runtime failed to load/);
  const run = dom.window.document.getElementById("run") as HTMLButtonElement;
  assert_node.equal(run.disabled, true);
});

console.log(`\n${passed} DOM tests passed`);
