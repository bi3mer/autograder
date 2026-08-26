/**
 * The rubric engine: everything that turns checks into a score.
 *
 * Partial credit, clamping, rounding, and the guards around a broken
 * criterion all live here, and every one of them is a number a student sees.
 *
 * flake8 is never installed in these tests, because nothing calls
 * `py_runner.init()`. That is deliberate: the fallback path is the one a
 * student on a flaky network actually gets, so it is the one under test.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../src/assert.js";
import * as rubric from "../src/rubric.js";

/** The context `grade` expects, with only the fields a test cares about set. */
function context(overrides = {}) {
  return { source: "", results: [], ...overrides };
}

/** Grades one criterion and hands back its row, which is what most tests assert on. */
async function grade_one(criterion, overrides = {}) {
  const report = await rubric.grade([criterion], context(overrides));
  assert.equal(report.items.length, 1);
  return report.items[0];
}

test("a code criterion matches a needle against the source", async () => {
  const found = await grade_one(
    { id: "a", name: "A", points: 5, needle: "input(" },
    { source: 'x = input("a: ")' },
  );
  assert.equal(found.earned, 5);
  assert.equal(found.pass, true);
  assert.equal(found.detail, 'Found "input(".');

  const missing = await grade_one({ id: "a", name: "A", points: 5, needle: "input(" });
  assert.equal(missing.earned, 0);
  assert.equal(missing.detail, 'Missing "input(".');
});

test("type defaults to code, so a criterion may omit it", async () => {
  const item = await grade_one({ id: "a", name: "A", points: 2, needle: "x" }, { source: "x" });
  assert.equal(item.earned, 2);
});

test("mode all awards proportional credit", async () => {
  const item = await grade_one(
    { id: "a", name: "A", points: 10, type: "code", needles: ["x", "y", "z"] },
    { source: "x y" },
  );
  assert.equal(item.earned, 6.67);
  assert.equal(item.pass, false);
  assert.match(item.detail, /found: "x", "y"; missing: "z"/);
});

test("mode any awards full credit for one alternative", async () => {
  const item = await grade_one(
    { id: "a", name: "A", points: 4, type: "code", mode: "any", needles: ["x", "zzz"] },
    { source: "x" },
  );
  assert.equal(item.earned, 4);
  assert.equal(item.pass, true);
});

test("case_sensitive false folds both sides", async () => {
  const strict = await grade_one(
    { id: "a", name: "A", points: 1, needle: "TOTAL" }, { source: "total" },
  );
  assert.equal(strict.earned, 0);
  const folded = await grade_one(
    { id: "a", name: "A", points: 1, needle: "TOTAL", case_sensitive: false },
    { source: "total" },
  );
  assert.equal(folded.earned, 1);
});

test("an output criterion matches the runs' stdout, joined", async () => {
  const item = await grade_one(
    { id: "o", name: "O", points: 3, type: "output", needle: "Total: 12" },
    { results: [{ out: "first\n" }, { out: "Total: 12\n" }] },
  );
  assert.equal(item.earned, 3);
});

test("an explicit combined_output overrides the joined stdout", async () => {
  const item = await grade_one(
    { id: "o", name: "O", points: 3, type: "output", needle: "canned" },
    { results: [{ out: "ignored" }], combined_output: "canned" },
  );
  assert.equal(item.earned, 3);
});

test("a criterion with neither needle nor needles is a rubric bug, and says so", async () => {
  const item = await grade_one({ id: "a", name: "A", points: 1, type: "code" });
  assert.equal(item.earned, 0);
  assert.match(item.detail, /needs a "needle" or "needles"/);
});

test("code-regex reports the match and the miss", async () => {
  const hit = await grade_one(
    { id: "f", name: "F", points: 1, type: "code-regex", regex: /f["']/ },
    { source: 'f"x"' },
  );
  assert.equal(hit.earned, 1);
  assert.match(hit.detail, /^Matched /);

  const miss = await grade_one(
    { id: "f", name: "F", points: 1, type: "code-regex", regex: /f["']/ },
    { source: "print(1)" },
  );
  assert.equal(miss.earned, 0);
  assert.match(miss.detail, /^No match for /);
});

test("code-regex resets lastIndex between submissions", async () => {
  // The same criterion object is reused for every submission graded in one
  // page session, and a "g" regex carries lastIndex across calls.
  const criterion = { id: "f", name: "F", points: 1, type: "code-regex", regex: /f["']/g };
  const first = await grade_one(criterion, { source: 'f"x"' });
  const second = await grade_one(criterion, { source: 'f"x"' });
  assert.equal(first.earned, 1);
  assert.equal(second.earned, 1);
});

test("a regex from another realm still counts as a regex", async () => {
  const vm = await import("node:vm");
  const foreign = vm.runInNewContext('/f["\']/');
  assert.equal(foreign instanceof RegExp, false, "precondition: foreign realm");
  const item = await grade_one(
    { id: "f", name: "F", points: 1, type: "code-regex", regex: foreign },
    { source: 'f"x"' },
  );
  assert.equal(item.earned, 1);
});

test("code-regex without a regex costs the criterion, not the run", async () => {
  const item = await grade_one({ id: "f", name: "F", points: 1, type: "code-regex" });
  assert.equal(item.earned, 0);
  assert.match(item.detail, /needs a RegExp/);
});

test("output-diff prorates credit by matching lines", async () => {
  const item = await grade_one(
    {
      id: "out", name: "Out", points: 6, type: "output-diff",
      cases: [{ name: "case 1", expected_lines: ["1", "2", "3"] }],
    },
    { results: [{ out: "1\n9\n3\n", err: "", prompts: [] }] },
  );
  assert.equal(item.earned, 4);
  assert.equal(item.detail_is_html, true);
  assert.match(item.detail, /67% of lines match/);
});

test("output-diff pays a case in full when every line matches", async () => {
  const item = await grade_one(
    {
      id: "out", name: "Out", points: 6, type: "output-diff",
      cases: [{ name: "case 1", expected_lines: ["1", "2"] }],
    },
    { results: [{ out: "1\n2\n" }] },
  );
  assert.equal(item.earned, 6);
  assert.match(item.detail, /exact match/);
  assert.doesNotMatch(item.detail, /<details/, "an exact match needs no diff block");
});

test("output-diff escapes a case name and the diff lines", async () => {
  const item = await grade_one(
    {
      id: "out", name: "Out", points: 2, type: "output-diff",
      cases: [{ name: "<b>case</b>", expected_lines: ["safe"] }],
    },
    { results: [{ out: "<script>alert(1)</script>\n" }] },
  );
  assert.match(item.detail, /&lt;b&gt;case&lt;\/b&gt;/);
  assert.match(item.detail, /&lt;script&gt;/);
  assert.doesNotMatch(item.detail, /<script>/);
});

test("output-diff rounds once at the end, not per case", async () => {
  // Three cases at 6.666… each: rounding first and summing gives 13.32,
  // which is a cent short of the score the student earned.
  const expected_lines = ["1", "2", "3"];
  const item = await grade_one(
    {
      id: "out", name: "Out", points: 20, type: "output-diff",
      cases: [
        { name: "c1", expected_lines }, { name: "c2", expected_lines },
        { name: "c3", expected_lines },
      ],
    },
    { results: [{ out: "1\n2\nX\n" }, { out: "1\n2\nX\n" }, { out: "1\n2\nX\n" }] },
  );
  assert.equal(item.earned, 13.33);
});

test("output-diff honours an explicit points_per_case", async () => {
  const item = await grade_one(
    {
      id: "out", name: "Out", points: 10, type: "output-diff", points_per_case: 2,
      cases: [{ name: "c1", expected_lines: ["1"] }, { name: "c2", expected_lines: ["2"] }],
    },
    { results: [{ out: "1\n" }, { out: "2\n" }] },
  );
  assert.equal(item.earned, 4);
});

test("flake8 criterion falls back to the regex linter", async () => {
  const item = await grade_one(
    { id: "style", name: "Style", points: 10, type: "flake8", partial: true },
    { source: "x = 1   \ny = 2\t\n" },
  );
  assert.equal(item.earned, 8, "one point per finding, two findings");
  assert.match(item.detail, /built-in/);
  assert.match(item.detail, /W291 trailing whitespace/);
});

test("a flake8 criterion without partial is clean-or-nothing", async () => {
  const dirty = await grade_one(
    { id: "style", name: "Style", points: 10, type: "flake8" },
    { source: "x = 1   \n" },
  );
  assert.equal(dirty.earned, 0);

  const clean = await grade_one(
    { id: "style", name: "Style", points: 10, type: "flake8" },
    { source: "x = 1\n" },
  );
  assert.equal(clean.earned, 10);
  assert.match(clean.detail, /^Clean/);
});

test("flake8 partial credit stops at zero rather than going negative", async () => {
  const source = Array.from({ length: 12 }, (_, index) => `x${index} = 1   `).join("\n");
  const item = await grade_one(
    { id: "style", name: "Style", points: 3, type: "flake8", partial: true },
    { source },
  );
  assert.equal(item.earned, 0);
});

test("flake8 lists at most max_findings_shown findings", async () => {
  const source = Array.from({ length: 8 }, (_, index) => `x${index} = 1   `).join("\n");
  const item = await grade_one(
    { id: "style", name: "Style", points: 10, type: "flake8", max_findings_shown: 2 },
    { source },
  );
  assert.match(item.detail, /8 finding\(s\)/);
  assert.equal(item.detail.split("\n").length, 3, "one header line plus two findings");
});

test("a custom check supplies its own verdict", async () => {
  const item = await grade_one({
    id: "c", name: "C", points: 4, type: "custom",
    check: (ctx) => ({ earned: ctx.source.length, detail: "counted" }),
  }, { source: "abc" });
  assert.equal(item.earned, 3);
  assert.equal(item.detail, "counted");
});

test("a custom check that returns nothing earns nothing", async () => {
  const item = await grade_one({
    id: "c", name: "C", points: 4, type: "custom", check: () => undefined,
  });
  assert.equal(item.earned, 0);
  assert.equal(item.detail, "");
});

test("a custom criterion without a check() costs the criterion", async () => {
  const item = await grade_one({ id: "c", name: "C", points: 4, type: "custom" });
  assert.equal(item.earned, 0);
  assert.match(item.detail, /needs a check\(\)/);
});

test("a throwing custom check costs its criterion, not the run", async () => {
  const report = await rubric.grade([
    {
      id: "boom", name: "Boom", points: 5, type: "custom",
      check: () => { throw new Error("nope"); },
    },
    { id: "fine", name: "Fine", points: 5, type: "code", needle: "x" },
  ], context({ source: "x" }));
  assert.equal(report.items[0].earned, 0);
  assert.equal(report.items[0].detail, "Check error: nope");
  assert.equal(report.items[1].earned, 5);
  assert.equal(report.total, 5);
});

test("an unknown type is a rubric bug, reported in its own row", async () => {
  const item = await grade_one({ id: "x", name: "X", points: 2, type: "bogus" });
  assert.equal(item.earned, 0);
  assert.match(item.detail, /has no default text source; use type "custom"/);
});

test("earned points are clamped to the criterion's points", async () => {
  const over = await grade_one(
    { id: "over", name: "Over", points: 3, type: "custom", check: () => ({ earned: 99 }) },
  );
  assert.equal(over.earned, 3);

  const under = await grade_one(
    { id: "under", name: "Under", points: 3, type: "custom", check: () => ({ earned: -99 }) },
  );
  assert.equal(under.earned, 0);
});

test("a non-finite earned stops the run rather than scoring NaN", async () => {
  // Scoring happens outside the per-criterion try/catch: a check that throws
  // costs one row, but a check that returns a number no rubric can add is a
  // grader bug, and a grader bug should be loud rather than partly graded.
  await assert.rejects(() => grade_one(
    { id: "nan", name: "NaN", points: 3, type: "custom", check: () => ({ earned: Number.NaN }) },
  ), /earned must be finite/);
});

test("a row carries its description and defaults the rest", async () => {
  const item = await grade_one(
    { id: "d", name: "D", description: "why this row exists", points: 1, needle: "x" },
    { source: "x" },
  );
  assert.deepEqual(item, {
    id: "d", name: "D", description: "why this row exists", points: 1,
    earned: 1, pass: true, detail: 'Found "x".', detail_is_html: false,
  });
});

test("a zero-point row always passes, since there is nothing to lose", async () => {
  const item = await grade_one({ id: "z", name: "Z", points: 0, needle: "absent" });
  assert.equal(item.earned, 0);
  assert.equal(item.pass, true);
});

test("grade totals every row and reports the rubric maximum", async () => {
  const report = await rubric.grade([
    { id: "a", name: "A", points: 5, needle: "x" },
    { id: "b", name: "B", points: 3, needle: "absent" },
    { id: "c", name: "C", points: 2, needles: ["x", "absent"] },
  ], context({ source: "x" }));
  assert.equal(report.total, 6);
  assert.equal(report.max, 10);
  assert.deepEqual(report.items.map((item) => item.id), ["a", "b", "c"]);
});

test("an empty rubric grades to zero out of zero", async () => {
  assert.deepEqual(await rubric.grade([], context()), { items: [], total: 0, max: 0 });
});

test("grade fills in a missing source and results", async () => {
  const report = await rubric.grade([{ id: "a", name: "A", points: 1, needle: "x" }], {});
  assert.equal(report.items[0].earned, 0);
});

test("a malformed criterion trips an assertion", async () => {
  const cases = [
    { id: "", name: "No id", points: 1 },
    { id: "a", name: "A", points: -1 },
    { id: "a", name: "A", points: 1, mode: "some" },
    { id: "a", points: 1 },
    null,
  ];
  for (const criterion of cases) {
    await assert.rejects(() => rubric.grade([criterion], context()), AssertionError);
  }
});

test("grade rejects a context it cannot grade against", async () => {
  await assert.rejects(() => rubric.grade([], null), AssertionError);
  await assert.rejects(() => rubric.grade([], { source: 42 }), AssertionError);
  await assert.rejects(() => rubric.grade(null, context()), AssertionError);
});
