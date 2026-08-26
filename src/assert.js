/**
 * Assertions, always enabled.
 *
 * TigerBeetle keeps assertions on in release builds: a grader that crashes
 * loudly in front of one instructor is cheaper than a grader that silently
 * awards the wrong score to two hundred students. Nothing strips these checks
 * on the way to the browser, because nothing processes the source at all.
 */

/**
 * A distinct class so callers can tell a grader bug (AssertionError, our
 * fault, always a defect) from a student-submission problem (a Python
 * SyntaxError string, expected, part of normal grading).
 */
export class AssertionError extends Error {
  constructor(message) {
    super(`assertion failed: ${message}`);
    this.name = "AssertionError";
  }
}

export function assert(condition, message) {
  if (typeof message !== "string" || message.length === 0) {
    throw new AssertionError("assert() requires a non-empty message");
  }
  if (!condition) throw new AssertionError(message);
}

/**
 * Bounding the length at the boundary keeps every downstream loop over the
 * string finite, which is what lets the scanning helpers assert their own
 * iteration limits.
 */
export function assert_string(value, name, max_length_chars) {
  assert(typeof name === "string" && name.length > 0, "name must be a non-empty string");
  assert(Number.isInteger(max_length_chars), `${name}: max_length_chars must be an integer`);
  assert(max_length_chars > 0, `${name}: max_length_chars must be positive`);
  assert(typeof value === "string", `${name} must be a string, got ${typeof value}`);
  const text = value;
  assert(
    text.length <= max_length_chars,
    `${name} exceeds ${max_length_chars} chars: ${text.length}`,
  );
  return text;
}

export function assert_array(value, name, max_count) {
  assert(typeof name === "string" && name.length > 0, "name must be a non-empty string");
  assert(
    Number.isInteger(max_count) && max_count > 0,
    `${name}: max_count must be a positive integer`,
  );
  assert(Array.isArray(value), `${name} must be an array, got ${typeof value}`);
  const items = value;
  assert(items.length <= max_count, `${name} exceeds ${max_count} entries: ${items.length}`);
  return items;
}

export function assert_range(value, name, min, max) {
  assert(typeof name === "string" && name.length > 0, "name must be a non-empty string");
  assert(min <= max, `${name}: min ${min} must not exceed max ${max}`);
  assert(typeof value === "number" && Number.isFinite(value), `${name} must be a finite number`);
  const number = value;
  assert(number >= min && number <= max, `${name} must be within [${min}, ${max}], got ${number}`);
  return number;
}

/** Marks a branch the code believes is impossible. */
export function unreachable(message) {
  assert(typeof message === "string" && message.length > 0, "unreachable() requires a message");
  throw new AssertionError(`unreachable: ${message}`);
}
