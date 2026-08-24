// checks.js
// Generic substring-matching utilities for grading. Works on any string —
// student source code, captured stdout, whatever — so the same functions
// cover "does the code contain X" and "does the output contain X".
// No pyodide/DOM dependency; pairs with pyrunner.js but doesn't need it.
const Checks = (() => {
  function normalize(text, caseSensitive) {
    return caseSensitive ? text : text.toLowerCase();
  }

  // Does `text` contain `needle`?
  function contains(text, needle, { caseSensitive = true } = {}) {
    return normalize(text, caseSensitive).includes(normalize(needle, caseSensitive));
  }

  // Check `text` against a list of needles. Each needle is a string, or an
  // array of alternative strings — any one of them counts as a match (e.g.
  // `['input("x: ")', "input('x: ')"]` to accept either quote style).
  // mode: "all" (default, every needle must be present) or "any" (at least one).
  // Returns { pass, matched, missing } (as the needle, or its alt-array joined
  // with " | ") so callers can render exactly what hit.
  function containsSet(text, needles, { mode = "all", caseSensitive = true } = {}) {
    const hay = normalize(text, caseSensitive);
    const matched = [];
    const missing = [];
    for (const needle of needles) {
      const alts = Array.isArray(needle) ? needle : [needle];
      const found = alts.some((alt) => hay.includes(normalize(alt, caseSensitive)));
      const label = alts.length > 1 ? alts.join(" | ") : alts[0];
      (found ? matched : missing).push(label);
    }
    const pass = mode === "any" ? matched.length > 0 : missing.length === 0;
    return { pass, matched, missing };
  }

  // 1-indexed line numbers where `needle` appears in multi-line `text`.
  // Useful for pointing at exactly where a required/forbidden substring is
  // (or should be) in source code or output.
  function findLines(text, needle, { caseSensitive = true } = {}) {
    const n = normalize(needle, caseSensitive);
    return normalize(text, caseSensitive)
      .split("\n")
      .reduce((lines, line, i) => {
        if (line.includes(n)) lines.push(i + 1);
        return lines;
      }, []);
  }

  // Line-diff `text` against an `expected` array of lines. If `anchor` is
  // given, skips any lines before the first one starting with it (e.g. to
  // ignore echoed input prompts preceding the real program output). Ignores
  // trailing blank lines. Returns { allMatch, rows: [{ g, e, ok }] } where g
  // is the got line, e the expected line ("∅" for either when missing).
  function diffLines(text, expected, { anchor } = {}) {
    let lines = (text || "").replace(/\r/g, "").split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (anchor) {
      const idx = lines.findIndex((l) => l.startsWith(anchor));
      if (idx > 0) lines = lines.slice(idx);
    }
    const got = lines;
    const rows = [];
    const max = Math.max(got.length, expected.length);
    let allMatch = got.length === expected.length;
    for (let i = 0; i < max; i++) {
      const g = got[i] ?? "∅";
      const e = expected[i] ?? "∅";
      const ok = g === e;
      if (!ok) allMatch = false;
      rows.push({ g, e, ok });
    }
    return { allMatch, rows };
  }

  return { contains, containsSet, findLines, diffLines };
})();
