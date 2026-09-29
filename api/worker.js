/**
 * The sandboxed half of grading from Node: it loads Pyodide and runs student
 * code, and does nothing else. `api/grader.js` forks it under Node's
 * permission model, which is what stands between a submission and this
 * machine. In a browser the tab contains student code, but in Node,
 * Pyodide's `import js` reaches `process`, and through it the shell and the
 * disk. Under the flags `grader.js` passes, this process can read the
 * repository, write Pyodide's package cache, and reach the network, and
 * nothing more.
 *
 * `argv[2]` is the package cache directory. Messages in are
 * `{ id, assignment_id, source }`. Out comes `{ type: "ready", flake8_ready,
 * flake8_error }` or `{ type: "failed", error }` once, then
 * `{ type: "result", id, ok, result | error }` per message, in the order the
 * messages arrived.
 */

import { constants as fs_constants, existsSync } from "node:fs";

import { assert } from "../src/assert.js";
import { ASSIGNMENT_ID_PATTERN } from "../src/constants.js";
import { grade_source } from "../src/grader.js";
import * as py_runner from "../src/pyrunner.js";

assert(typeof process.send === "function", "worker: fork me through api/grader.js");
const package_cache_dir = process.argv[2];
assert(typeof package_cache_dir === "string", "worker: argv[2] must be the package cache directory");

// Pyodide 0.26's Emscripten file system asks `process.binding("constants")`
// for the open() flags at startup, and the permission model denies
// process.binding outright. The same flags are public as fs.constants, so
// that one request is answered from there; every other still meets the
// denial.
const binding = process.binding;
process.binding = (name) =>
  name === "constants" ? { fs: fs_constants } : binding.call(process, name);

function reason_for(error) {
  return error instanceof Error ? error.message : String(error);
}

// A crash inside Pyodide is thrown from its minified runtime, and Node's
// report of an uncaught exception quotes the line it came from: all of
// pyodide.asm.js, over a megabyte of it, on the grader's terminal. The
// parent reports the exit against the submission; one line here says why.
process.on("uncaughtException", (error) => {
  console.error(`grading worker crashed: ${reason_for(error)}`);
  process.exit(1);
});

async function load_interpreter() {
  let pyodide_module;
  try {
    pyodide_module = await import("pyodide");
  } catch {
    throw new Error("pyodide is not installed; run npm install first");
  }
  // Pyodide narrates every package it loads on stdout, which grader.js
  // discards; stderr stays, since that is where a failure says why.
  return pyodide_module.loadPyodide({ packageCacheDir: package_cache_dir });
}

async function grade(message) {
  const { assignment_id, source } = message;
  // grader.js checks the id too; this is the check that holds even if a
  // caller skips it, since the id becomes a path to import.
  assert(
    typeof assignment_id === "string" && ASSIGNMENT_ID_PATTERN.test(assignment_id),
    `worker: not an assignment id: ${assignment_id}`,
  );
  const url = new URL(`../cs230/${assignment_id}.js`, import.meta.url);
  assert(existsSync(url), `worker: no assignment module cs230/${assignment_id}.js`);
  const module = await import(url.href);
  assert(module.assignment != null, `worker: cs230/${assignment_id}.js exports no assignment`);
  return grade_source(module.assignment, source);
}

try {
  const status = await py_runner.init({ load_pyodide: load_interpreter });
  process.send({
    type: "ready",
    flake8_ready: status.flake8_ready,
    flake8_error: status.flake8_error,
  });
} catch (error) {
  process.send({ type: "failed", error: reason_for(error) }, () => process.exit(1));
}

// One interpreter, so one grade at a time: each message waits for the one
// before it, and replies leave in the order messages came in.
let queue = Promise.resolve();
process.on("message", (message) => {
  queue = queue.then(async () => {
    let reply;
    try {
      reply = { type: "result", id: message.id, ok: true, result: await grade(message) };
    } catch (error) {
      reply = { type: "result", id: message.id, ok: false, error: reason_for(error) };
    }
    process.send(reply);
  });
});
