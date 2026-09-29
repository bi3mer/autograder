/**
 * Grading from Node, with real Pyodide.
 *
 * Not part of `npm test`: it needs `npm install`, fetches micropip and
 * flake8 over the network, and takes seconds rather than milliseconds. Run
 * it with `npm run test:api` after changing anything in `api/` or the
 * runner.
 *
 * The sandbox tests matter most. A student's program is untrusted, and in
 * Node, unlike in a browser tab, Pyodide's `import js` reaches `process`.
 * These tests try the ways out and check that each is refused.
 */

import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { RUN_TIMEOUT_MS } from "../../src/constants.js";
import { list_assignments, open_grader } from "../grader.js";

const GOOD_W5P1 = `import random


def get_positive_number(prompt):
    answer = input(prompt)
    while not answer.isdigit() or int(answer) <= 0:
        answer = input(prompt)
    return int(answer)


def play_game(secret):
    guess = get_positive_number("Guess: ")
    while guess != secret:
        if guess > secret:
            print("Too high.")
        else:
            print("Too low.")
        guess = get_positive_number("Guess: ")
    print("Correct!")


secret = random.randint(1, 100)
play_game(secret)
`;

// A path outside the repository, where the worker may neither read nor write.
const PROBE_PATH = path.join(tmpdir(), `autograder-sandbox-probe-${process.pid}.txt`);

let grader;
before(async () => {
  rmSync(PROBE_PATH, { force: true });
  grader = await open_grader();
});
after(() => {
  grader.close();
  rmSync(PROBE_PATH, { force: true });
});

/** Every line the program printed in the first example, from the output row's diff. */
function printed_lines(result) {
  const row = result.rows.find((candidate) => candidate.name === "Correct output");
  assert.ok(row, "the assignment has a Correct output row");
  const text = row.detail.replace(/<[^>]+>/g, "\n").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return text.split("\n").filter((line) => line.includes("got:")).map((line) => line.split("got:")[1].trim());
}

test("every assignment module is listed", () => {
  const ids = list_assignments();
  assert.ok(ids.includes("w5p1") && ids.includes("a1"), ids.join(" "));
});

test("a full w5p1 solution scores full marks, with flake8", async () => {
  assert.ok(grader.flake8_ready, `flake8 did not install: ${grader.flake8_error}`);
  const result = await grader.grade("w5p1", GOOD_W5P1);
  assert.equal(result.zero_reason, null);
  assert.equal(result.total_points, 80);
  assert.ok(result.summary.startsWith("w5-1.py — Autograder Summary\nScore: 80 / 80\n"));
  assert.ok(result.submission.startsWith(`"""\n${result.summary}\n`));
});

test("a syntax error scores zero", async () => {
  const result = await grader.grade("w5p1", "def f(:\n    pass\n");
  assert.equal(result.zero_reason, "syntax error");
  assert.ok(result.summary.includes("Score: 0 (syntax error — see below)"));
});

test("an unknown assignment is refused before anything runs", async () => {
  await assert.rejects(grader.grade("w9p9", "print(1)\n"), /no assignment "w9p9"/);
  await assert.rejects(grader.grade("../x", "print(1)\n"), /not an assignment id/);
});

test("student code cannot run commands, touch the disk, or evaluate its way out", async () => {
  const source = `import js
attempts = [
    ("shell", lambda: js.process.getBuiltinModule("child_process").execSync("id").toString()),
    ("write", lambda: js.process.getBuiltinModule("fs").writeFileSync(${JSON.stringify(PROBE_PATH)}, "x")),
    ("read", lambda: js.process.getBuiltinModule("fs").readFileSync("/etc/hosts", "utf8")),
    ("binding", lambda: js.process.binding("fs")),
    ("eval", lambda: js.eval("process.getBuiltinModule('child_process').execSync('id')")),
]
for name, attempt in attempts:
    try:
        attempt()
        print(name, "ESCAPED")
    except Exception:
        print(name, "blocked")
`;
  const result = await grader.grade("w1p1", source);
  const lines = printed_lines(result).slice(0, 5);
  assert.deepEqual(lines, ["shell blocked", "write blocked", "read blocked", "binding blocked", "eval blocked"]);
  assert.ok(!existsSync(PROBE_PATH), "the write reached the disk");
});

test("a file saved on Windows grades like the same file saved anywhere else", async () => {
  // Notepad's byte order mark and \r\n line endings: Node's readFile keeps
  // both, where the page's FileReader drops the mark.
  const windows = `﻿${GOOD_W5P1.replace(/\n/g, "\r\n")}`;
  assert.equal((await grader.grade("w5p1", windows)).total_points, 80);
  assert.equal((await grader.grade("w5p1", GOOD_W5P1.replace(/\n/g, "\r"))).total_points, 80);
});

test("os._exit ends the program with a score, not the worker without one", async () => {
  const result = await grader.grade("w5p1", "import os\nos._exit(0)\n");
  assert.equal(result.zero_reason, null);
  assert.equal(result.total_points, 8, "only flake8 scores");
});

test("what one submission does to Python does not reach the next one's grade", async () => {
  const sabotage = [
    "import builtins\nbuiltins.print = lambda *args, **kwargs: None\n",
    "import builtins\nbuiltins.int = lambda value: 0\n",
    "import json\njson.dumps = lambda *args, **kwargs: 'nope'\n",
    "import sys\nsys.setrecursionlimit(50)\n",
  ];
  for (const source of sabotage) {
    // The saboteur's own grade may fail; the next student's may not.
    await grader.grade("w5p1", source).catch(() => {});
    const next = await grader.grade("w5p1", GOOD_W5P1);
    assert.equal(next.total_points, 80, `after ${JSON.stringify(source)}`);
  }
});

test("a while True loop is stopped by the runner's timeout, run by run, and scored", async () => {
  const cases = (await import("../../cs230/w1p1.js")).assignment.cases.length;
  const started = performance.now();
  const result = await grader.grade("w1p1", "while True:\n    pass\n");
  const elapsed_ms = performance.now() - started;
  // Every run, the syntax probe and each case, goes the full timeout, and
  // none of them hangs the grade: it comes back scored, well before the
  // worker's own deadline would have killed it.
  assert.ok(
    elapsed_ms >= (cases + 1) * RUN_TIMEOUT_MS,
    `finished in ${Math.round(elapsed_ms)}ms, before every run could time out`,
  );
  assert.equal(result.zero_reason, null, "a loop compiles, so nothing zeroes it");
  const output = result.rows.find((row) => row.name === "Correct output");
  assert.equal(output.score, "0 / 20", "a program stopped mid-loop printed nothing");
  assert.equal(result.total_points, 10, "only flake8, which the loop passes, scores");
  const next = await grader.grade("w5p1", GOOD_W5P1);
  assert.equal(next.total_points, 80, "the file after the loop still grades");
});

test("a hang the runner cannot stop kills the worker, and the next grade still runs", async () => {
  const impatient = await open_grader({ grade_timeout_ms: 5000 });
  try {
    await assert.rejects(impatient.grade("w1p1", "print(sum(range(10 ** 13)))\n"), /timed out/);
    const result = await impatient.grade("w5p1", "def f(:\n    pass\n");
    assert.equal(result.zero_reason, "syntax error");
  } finally {
    impatient.close();
  }
});
