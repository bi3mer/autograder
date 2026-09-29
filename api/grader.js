/**
 * Grading from Node, for the terminal command in `api/cli.js` now and a
 * BrightSpace script later:
 *
 *   import { open_grader } from "./api/grader.js";
 *
 *   const grader = await open_grader();
 *   const result = await grader.grade("w5p1", source);
 *   console.log(result.summary);
 *   grader.close();
 *
 * `result` is what `grade_source` in `src/grader.js` returns, the object the
 * page renders: `{ total_points, max_auto_points, zero_reason, rows,
 * summary, submission }`, with each row's `detail` in HTML. `summary` is the
 * text the page's summary box shows and `submission` is the paste its Copy
 * button builds, so a score here is the score the student saw.
 *
 * Student code never runs in this process. It runs in `api/worker.js`,
 * forked under Node's permission model with the flags below, so this side
 * stays free to read submissions from anywhere and, later, to hold
 * BrightSpace credentials the worker can never reach.
 */

import { fork } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { assert, assert_string } from "../src/assert.js";
import { ASSIGNMENT_ID_PATTERN, RUN_TIMEOUT_MS, SOURCE_BYTES_MAX } from "../src/constants.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKER = fileURLToPath(new URL("worker.js", import.meta.url));
const CACHE_DIR = fileURLToPath(new URL(".pyodide-cache/", import.meta.url));
const ASSIGNMENTS_URL = new URL("../cs230/", import.meta.url);

/**
 * What the worker may do beyond running JavaScript: read the repository (its
 * own code, the assignment modules, Pyodide), write Pyodide's package cache,
 * and reach the network, which it needs to fetch micropip and flake8. Not
 * granted: child processes, worker threads, native addons, WASI, or any
 * other path on disk.
 */
const WORKER_EXEC_ARGV = [
  "--permission",
  `--allow-fs-read=${ROOT}`,
  `--allow-fs-write=${CACHE_DIR}`,
  "--allow-net",
  // --allow-net is still experimental and says so on every start.
  "--disable-warning=ExperimentalWarning",
];

/**
 * The runner stops each run at `RUN_TIMEOUT_MS`, and a grade is a syntax
 * probe plus one run per case, so a grade's deadline is that sum plus this.
 * It is for the hang the runner cannot stop: a single call into C, like an
 * enormous `**`, that never hands control back to Python's tracer.
 */
const GRADE_OVERHEAD_MS = 30_000;

/** The ids `grade` accepts: every `cs230/<id>.js`, sorted. */
export function list_assignments() {
  return readdirSync(ASSIGNMENTS_URL)
    .filter((name) => name.endsWith(".js"))
    .map((name) => name.slice(0, -".js".length))
    .filter((id) => ASSIGNMENT_ID_PATTERN.test(id))
    .sort();
}

/**
 * The id is checked here as well as in the worker, so a typo fails at once
 * with a readable message instead of after a worker has started.
 */
async function load_assignment(assignment_id) {
  if (typeof assignment_id !== "string" || !ASSIGNMENT_ID_PATTERN.test(assignment_id)) {
    throw new Error(`not an assignment id: ${assignment_id}`);
  }
  const url = new URL(`${assignment_id}.js`, ASSIGNMENTS_URL);
  if (!existsSync(url)) {
    throw new Error(`no assignment "${assignment_id}"; there is no cs230/${assignment_id}.js`);
  }
  const module = await import(url.href);
  assert(module.assignment != null, `cs230/${assignment_id}.js exports no assignment`);
  return module.assignment;
}

function start_worker() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const child = fork(WORKER, [CACHE_DIR], {
    execArgv: WORKER_EXEC_ARGV,
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const ready = new Promise((resolve, reject) => {
    child.once("message", (message) => {
      if (message.type === "ready") resolve(message);
      else reject(new Error(`the grading worker failed to start: ${message.error}`));
    });
    child.once("exit", (code, signal) => {
      reject(new Error(`the grading worker exited while starting (${signal ?? `code ${code}`})`));
    });
  });
  // A spare killed by close() before it was ever used rejects with nobody
  // waiting, and an unhandled rejection would take the caller down with it.
  ready.catch(() => {});
  return { child, ready };
}

/**
 * Send one grade to the worker and wait for its reply. Past the deadline,
 * or if the worker dies, the worker is killed and this rejects.
 */
function send(worker, message, timeout_ms) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.child.off("message", on_message);
      worker.child.off("exit", on_exit);
    };
    const timer = setTimeout(() => {
      cleanup();
      worker.child.kill("SIGKILL");
      reject(new Error(`grading timed out after ${Math.round(timeout_ms / 1000)}s`));
    }, timeout_ms);
    const on_message = (reply) => {
      if (reply.type !== "result" || reply.id !== message.id) return;
      cleanup();
      if (reply.ok) resolve(reply.result);
      else reject(new Error(reply.error));
    };
    const on_exit = (code, signal) => {
      cleanup();
      reject(new Error(`the grading worker exited mid-grade (${signal ?? `code ${code}`})`));
    };
    worker.child.on("message", on_message);
    worker.child.on("exit", on_exit);
    worker.child.send(message);
  });
}

/**
 * Start a grader, which grades one submission at a time. Calls to `grade`
 * queue, so a caller may fire them all at once. `flake8_ready` is false when
 * flake8 could not be installed, in which case style is scored by the
 * built-in checks, as it is on a page offline.
 *
 * Every submission is graded by a worker of its own, which is killed after.
 * The page's interpreter is one student's; a batch's would be everyone's, and
 * a submission can change the interpreter it runs in for whatever runs next:
 * replace `builtins.print` and the next student's output vanishes, replace
 * `json.dumps` and every grade after it fails. Checking for that is a race
 * with whatever the check misses, so no interpreter grades twice. Starting
 * one takes a few seconds, so one spare is always starting while the current
 * submission grades.
 *
 * `options.grade_timeout_ms` replaces each grade's deadline, which otherwise
 * scales with the assignment's case count (see `GRADE_OVERHEAD_MS`).
 */
export async function open_grader(options = {}) {
  assert(options != null && typeof options === "object", "open_grader: options must be an object");
  const grade_timeout_ms = options.grade_timeout_ms ?? null;
  assert(
    grade_timeout_ms === null || (Number.isInteger(grade_timeout_ms) && grade_timeout_ms > 0),
    "open_grader: grade_timeout_ms must be a positive integer",
  );
  let spare = start_worker();
  // The first worker to start sets what the batch grades with: in
  // particular, whether style is scored by flake8 or by the built-in checks.
  const first = await spare.ready;
  let active = null;
  let tail = Promise.resolve();
  let next_id = 1;
  let closed = false;

  async function take_worker() {
    const worker = spare;
    spare = start_worker();
    let status;
    try {
      status = await worker.ready;
    } catch (error) {
      worker.child.kill();
      throw error;
    }
    // PyPI failing mid-batch would otherwise score this one submission's
    // style with the built-in checks and everyone else's with flake8.
    if (first.flake8_ready && !status.flake8_ready) {
      worker.child.kill();
      throw new Error(
        `flake8 failed to install for this submission (${status.flake8_error}); ` +
          "grade it again rather than with different style checks from the rest",
      );
    }
    return worker;
  }

  async function grade_now(assignment_id, source) {
    if (closed) throw new Error("the grader was closed before this grade ran");
    const assignment = await load_assignment(assignment_id);
    assert_string(source, "grade: source", SOURCE_BYTES_MAX);
    const timeout_ms = grade_timeout_ms ??
      (assignment.cases.length + 1) * RUN_TIMEOUT_MS + GRADE_OVERHEAD_MS;
    active = await take_worker();
    try {
      return await send(active, { id: next_id++, assignment_id, source }, timeout_ms);
    } finally {
      active.child.kill();
      active = null;
    }
  }

  return {
    flake8_ready: first.flake8_ready,
    flake8_error: first.flake8_error,
    grade(assignment_id, source) {
      assert(!closed, "grade: the grader is closed");
      const job = tail.then(() => grade_now(assignment_id, source));
      tail = job.catch(() => {});
      return job;
    },
    /** Stop every worker. Grades still queued reject. */
    close() {
      closed = true;
      spare.child.kill();
      if (active !== null) active.child.kill();
    },
  };
}
