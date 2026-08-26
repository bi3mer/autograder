/**
 * The assertion layer everything else is built on.
 *
 * These are the checks that turn a grader bug into a loud crash instead of a
 * wrong score, so they are worth testing directly: a bound that silently
 * accepts a bad value would disarm every caller downstream.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assert as assert_engine, assert_array, assert_range, assert_string, AssertionError, unreachable,
} from "../src/assert.js";

test("AssertionError is an Error with a prefixed message", () => {
  const error = new AssertionError("things went wrong");
  assert.ok(error instanceof Error);
  assert.equal(error.name, "AssertionError");
  assert.equal(error.message, "assertion failed: things went wrong");
});

test("assert passes a true condition and throws on a false one", () => {
  assert_engine(true, "holds");
  assert.throws(() => assert_engine(false, "does not hold"), /assertion failed: does not hold/);
});

test("assert refuses to run without a message", () => {
  assert.throws(() => assert_engine(true), AssertionError);
  assert.throws(() => assert_engine(true, ""), AssertionError);
  assert.throws(() => assert_engine(true, 42), AssertionError);
});

test("assert_string returns the text and rejects a non-string", () => {
  assert.equal(assert_string("abc", "value", 8), "abc");
  assert.throws(() => assert_string(7, "value", 8), /value must be a string, got number/);
  assert.throws(() => assert_string(null, "value", 8), /value must be a string, got object/);
});

test("assert_string enforces the length ceiling", () => {
  assert.equal(assert_string("abc", "value", 3), "abc");
  assert.throws(() => assert_string("abcd", "value", 3), /value exceeds 3 chars: 4/);
});

test("assert_string rejects a bad ceiling rather than trusting the caller", () => {
  assert.throws(() => assert_string("a", "value", 0), /must be positive/);
  assert.throws(() => assert_string("a", "value", 1.5), /must be an integer/);
  assert.throws(() => assert_string("a", "", 8), /name must be a non-empty string/);
});

test("assert_array returns the items and rejects a non-array", () => {
  const items = ["a", "b"];
  assert.equal(assert_array(items, "items", 4), items);
  assert.throws(() => assert_array("ab", "items", 4), /items must be an array, got string/);
});

test("assert_array enforces the count ceiling", () => {
  assert.throws(() => assert_array([1, 2, 3], "items", 2), /items exceeds 2 entries: 3/);
  assert.throws(() => assert_array([], "items", 0), /max_count must be a positive integer/);
});

test("assert_range returns the number and rejects one outside the bounds", () => {
  assert.equal(assert_range(5, "n", 1, 10), 5);
  assert.equal(assert_range(1, "n", 1, 10), 1, "the bounds are inclusive");
  assert.equal(assert_range(10, "n", 1, 10), 10, "the bounds are inclusive");
  assert.throws(() => assert_range(11, "n", 1, 10), /n must be within \[1, 10\], got 11/);
});

test("assert_range rejects a non-finite value and an inverted range", () => {
  assert.throws(() => assert_range(Number.NaN, "n", 1, 10), /n must be a finite number/);
  assert.throws(() => assert_range(Infinity, "n", 1, 10), /n must be a finite number/);
  assert.throws(() => assert_range("5", "n", 1, 10), /n must be a finite number/);
  assert.throws(() => assert_range(5, "n", 10, 1), /min 10 must not exceed max 1/);
});

test("unreachable always throws, and needs a message to do it", () => {
  assert.throws(() => unreachable("this branch is impossible"), (error) => (
    error instanceof AssertionError &&
    error.message === "assertion failed: unreachable: this branch is impossible"
  ));
  assert.throws(() => unreachable(""), /unreachable\(\) requires a message/);
});
