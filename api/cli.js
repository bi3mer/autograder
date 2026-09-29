/**
 * Grade from the terminal:
 *
 *   npm run grade -- w5p1 w5-1.py                 the summary
 *   npm run grade -- w5p1 submissions/*.py        one summary per file
 *   npm run grade -- --submission w5p1 w5-1.py    the paste Copy builds
 *   npm run grade -- --json w5p1 w5-1.py          everything, as JSON
 *
 * Results go to stdout and progress to stderr, so the output pipes cleanly.
 * Exits 0 when every file was graded, 1 when any could not be, and 2 on a
 * usage error.
 */

import { readFile } from "node:fs/promises";

import { list_assignments, open_grader } from "./grader.js";

const USAGE = `usage: npm run grade -- [--submission | --json] <assignment> <file.py> [more.py ...]
assignments: ${list_assignments().join(" ")}`;

function usage_error(message) {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

function parse_args(args) {
  const flags = args.filter((arg) => arg.startsWith("--"));
  const positional = args.filter((arg) => !arg.startsWith("--"));
  for (const flag of flags) {
    if (flag !== "--submission" && flag !== "--json") usage_error(`unknown option ${flag}`);
  }
  if (flags.length > 1) usage_error("pick one of --submission and --json");
  if (positional.length < 2) usage_error("name an assignment and at least one file");
  const [assignment_id, ...files] = positional;
  if (!list_assignments().includes(assignment_id)) {
    usage_error(`no assignment "${assignment_id}"`);
  }
  return { mode: flags[0] ?? "--summary", assignment_id, files };
}

const { mode, assignment_id, files } = parse_args(process.argv.slice(2));
console.error("Loading Python…");
const grader = await open_grader();
if (!grader.flake8_ready) {
  console.error(`flake8 unavailable (${grader.flake8_error}); using the built-in style checks.`);
}

let failures = 0;
const results = [];
for (let index = 0; index < files.length; index++) {
  const file = files[index];
  try {
    const source = await readFile(file, "utf8");
    const result = await grader.grade(assignment_id, source);
    if (mode === "--json") {
      results.push({ file, ...result });
      continue;
    }
    if (files.length > 1) console.log(`${index > 0 ? "\n" : ""}==> ${file} <==`);
    // The paste already ends in a newline; the summary does not.
    if (mode === "--submission") process.stdout.write(result.submission);
    else console.log(result.summary);
  } catch (error) {
    failures++;
    const reason = error instanceof Error ? error.message : String(error);
    if (mode === "--json") results.push({ file, error: reason });
    console.error(`${file}: ${reason}`);
  }
}
grader.close();
if (mode === "--json") console.log(JSON.stringify(results, null, 2));
process.exit(failures === 0 ? 0 : 1);
