/**
 * Assertions, always enabled.
 *
 * TigerBeetle keeps assertions on in release builds: a grader that crashes
 * loudly in front of one instructor is cheaper than a grader that silently
 * awards the wrong score to two hundred students. Every bundle in `dist/`
 * ships these checks live, minified builds included.
 */

/**
 * A distinct class so callers can tell a grader bug (AssertionError, our
 * fault, always a defect) from a student-submission problem (a Python
 * SyntaxError string, expected, part of normal grading).
 */
export class AssertionError extends Error {
  constructor(message: string) {
    super(`assertion failed: ${message}`);
    this.name = "AssertionError";
  }
}

export function assert(condition: unknown, message: string): asserts condition {
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
export function assert_string(value: unknown, name: string, max_length_chars: number): string {
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

export function assert_array<T>(value: unknown, name: string, max_count: number): T[] {
  assert(typeof name === "string" && name.length > 0, "name must be a non-empty string");
  assert(
    Number.isInteger(max_count) && max_count > 0,
    `${name}: max_count must be a positive integer`,
  );
  assert(Array.isArray(value), `${name} must be an array, got ${typeof value}`);
  const items = value as T[];
  assert(items.length <= max_count, `${name} exceeds ${max_count} entries: ${items.length}`);
  return items;
}

export function assert_range(value: unknown, name: string, min: number, max: number): number {
  assert(typeof name === "string" && name.length > 0, "name must be a non-empty string");
  assert(min <= max, `${name}: min ${min} must not exceed max ${max}`);
  assert(typeof value === "number" && Number.isFinite(value), `${name} must be a finite number`);
  const number = value;
  assert(number >= min && number <= max, `${name} must be within [${min}, ${max}], got ${number}`);
  return number;
}

/** Marks a branch the code believes is impossible. */
export function unreachable(message: string): never {
  assert(typeof message === "string" && message.length > 0, "unreachable() requires a message");
  throw new AssertionError(`unreachable: ${message}`);
}
