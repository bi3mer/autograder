/**
 * Assertions, always enabled.
 *
 * TigerBeetle keeps assertions on in release builds: a grader that crashes
 * loudly in front of one instructor is cheaper than a grader that silently
 * awards the wrong score to two hundred students. Every bundle in `dist/`
 * ships these checks live, minified builds included.
 *
 * @module assertions
 */

/**
 * Thrown by {@link assert} when an invariant is violated.
 *
 * A distinct class so callers can tell a grader bug (AssertionError, our
 * fault, always a defect) from a student-submission problem (a Python
 * SyntaxError string, expected, part of normal grading).
 */
export class AssertionError extends Error {
  /** @param {string} message Description of the violated invariant. */
  constructor(message) {
    super(`assertion failed: ${message}`);
    this.name = "AssertionError";
  }
}

/**
 * Assert that `condition` holds, throwing {@link AssertionError} otherwise.
 *
 * @param {unknown} condition Value tested for truthiness.
 * @param {string} message What the caller believed to be true.
 * @returns {asserts condition}
 * @throws {AssertionError} If `condition` is falsy.
 */
export function assert(condition, message) {
  if (typeof message !== "string" || message.length === 0) {
    throw new AssertionError("assert() requires a non-empty message");
  }
  if (!condition) throw new AssertionError(message);
}

/**
 * Assert that `value` is a string, and that its length fits `max_length_chars`.
 *
 * Bounding the length at the boundary keeps every downstream loop over the
 * string finite, which is what lets the scanning helpers assert their own
 * iteration limits.
 *
 * @param {unknown} value Candidate string.
 * @param {string} name Identifier used in the failure message.
 * @param {number} max_length_chars Inclusive upper bound on `value.length`.
 * @returns {string} `value`, now known to be a bounded string.
 */
export function assert_string(value, name, max_length_chars) {
  assert(typeof name === "string" && name.length > 0, "name must be a non-empty string");
  assert(Number.isInteger(max_length_chars), `${name}: max_length_chars must be an integer`);
  assert(max_length_chars > 0, `${name}: max_length_chars must be positive`);
  assert(typeof value === "string", `${name} must be a string, got ${typeof value}`);
  const text = /** @type {string} */ (value);
  assert(
    text.length <= max_length_chars,
    `${name} exceeds ${max_length_chars} chars: ${text.length}`,
  );
  return text;
}

/**
 * Assert that `value` is an array of at most `max_count` entries.
 *
 * @template T
 * @param {unknown} value Candidate array.
 * @param {string} name Identifier used in the failure message.
 * @param {number} max_count Inclusive upper bound on `value.length`.
 * @returns {T[]} `value`, now known to be a bounded array.
 */
export function assert_array(value, name, max_count) {
  assert(typeof name === "string" && name.length > 0, "name must be a non-empty string");
  assert(
    Number.isInteger(max_count) && max_count > 0,
    `${name}: max_count must be a positive integer`,
  );
  assert(Array.isArray(value), `${name} must be an array, got ${typeof value}`);
  const items = /** @type {T[]} */ (value);
  assert(items.length <= max_count, `${name} exceeds ${max_count} entries: ${items.length}`);
  return items;
}

/**
 * Assert that `value` is a finite number inside `[min, max]`.
 *
 * @param {unknown} value Candidate number.
 * @param {string} name Identifier used in the failure message.
 * @param {number} min Inclusive lower bound.
 * @param {number} max Inclusive upper bound.
 * @returns {number} `value`, now known to be a bounded finite number.
 */
export function assert_range(value, name, min, max) {
  assert(typeof name === "string" && name.length > 0, "name must be a non-empty string");
  assert(min <= max, `${name}: min ${min} must not exceed max ${max}`);
  assert(typeof value === "number" && Number.isFinite(value), `${name} must be a finite number`);
  const number = /** @type {number} */ (value);
  assert(number >= min && number <= max, `${name} must be within [${min}, ${max}], got ${number}`);
  return number;
}

/**
 * Mark a branch the code believes is impossible.
 *
 * @param {string} message What the caller believed could not happen.
 * @returns {never}
 * @throws {AssertionError} Always.
 */
export function unreachable(message) {
  assert(typeof message === "string" && message.length > 0, "unreachable() requires a message");
  throw new AssertionError(`unreachable: ${message}`);
}
