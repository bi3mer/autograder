// rubric.js
// Declarative rubric engine. Define criteria as plain objects — "does the
// source contain this substring", "does the output contain this substring" —
// and Rubric.grade() runs them against a submission and totals the score.
// Built on Checks (substring matching). Doesn't run Python itself: callers
// pass in results already produced by PyRunner.run().
//
// Criterion shape:
//   {
//     id: "prompt-habit-name",      // unique key
//     name: "Prompts for habit name",
//     desc: "shown under the rubric row",
//     points: 3,
//     type: "code" | "output" | "output-diff" | "flake8" | "custom",
//     needle: 'input("Habit name: ")',   // single substring, OR:
//     needles: ["Spend per day:", ['input("x: ")', "input('x: ')"]],  // multiple
//                                    // substrings; an entry can itself be an
//                                    // array of alternatives (any one matches)
//     mode: "all" | "any",          // default "all": needles are independent,
//                                    // credit ∝ how many were found (not
//                                    // all-or-nothing). "any": needles are
//                                    // alternatives for the same thing —
//                                    // finding one is full credit.
//     caseSensitive: true,          // default true
//     // type: "flake8" options:
//     filename: "program1.py",      // default "submission.py"
//     maxLineLength: 99,
//     partial: false,               // false: 0 findings = full points, else 0.
//                                    // true: earned = max(0, points - findings.length)
//     maxShown: 12,                 // findings listed in the detail text
//     // type: "output-diff" options: line-diffs each test case's actual
//     // output against its expected lines. Credit per case is proportional
//     // to the fraction of matching lines (not all-or-nothing), with a
//     // collapsible diff shown for anything that doesn't match exactly.
//     cases: [{ name, expected }],  // expected: array of lines; aligned by
//                                    // index with ctx.results
//     anchor: "Habit Costs for",    // skip output lines before this (e.g.
//                                    // echoed input prompts), optional
//     pointsPerCase: 10,            // default: points / cases.length
//     check: (ctx) => ({ pass, detail }) | { earned, detail, raw },  // for type: "custom"
//                                    // (may return a Promise). Set raw: true
//                                    // if `detail` is already HTML.
//   }
//
// ctx passed to checks:
//   ctx.source           - the submitted source code (string)
//   ctx.results          - array of PyRunner.run() results, one per test case
//   ctx.combinedOutput   - results.map(r => r.out).join("\n"), for convenience
//
// Rubric.grade() is async (flake8 checks run through Pyodide) and awaits
// criteria one at a time — Pyodide is a single shared interpreter, so
// concurrent calls into it could interleave and clobber each other's state.
const Rubric = (() => {
  function escapeHTML(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function textFor(item, ctx) {
    if (item.type === "code") return ctx.source || "";
    if (item.type === "output") return ctx.combinedOutput ?? (ctx.results || []).map((r) => r.out || "").join("\n");
    throw new Error(`Rubric: type "${item.type}" has no default text source; use type: "custom".`);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function matchText(text, item) {
    const opts = { caseSensitive: item.caseSensitive !== false };
    if (item.needle != null) {
      const ok = Checks.contains(text, item.needle, opts);
      return { pass: ok, detail: ok ? `Found "${item.needle}".` : `Missing "${item.needle}".` };
    }
    if (item.needles != null) {
      const mode = item.mode || "all";
      const { pass, matched, missing } = Checks.containsSet(text, item.needles, { ...opts, mode });
      const parts = [];
      if (matched.length) parts.push(`found: ${matched.map((n) => `"${n}"`).join(", ")}`);
      if (missing.length) parts.push(`missing: ${missing.map((n) => `"${n}"`).join(", ")}`);
      const detail = parts.join("; ");
      // mode "all": each needle matters independently — credit is proportional
      // to how many were found, not all-or-nothing on the whole set.
      // mode "any": needles are alternatives for the same thing (e.g. the two
      // f-string quote styles) — matching one means full credit, not partial.
      if (mode === "all") {
        const points = item.points ?? 0;
        const earned = item.needles.length ? round2(points * (matched.length / item.needles.length)) : 0;
        return { earned, detail };
      }
      return { pass, detail };
    }
    throw new Error(`Rubric: criterion "${item.id}" needs a "needle" or "needles".`);
  }

  async function flake8Check(item, ctx) {
    const points = item.points ?? 0;
    const filename = item.filename || "submission.py";
    const maxLineLength = item.maxLineLength ?? 99;
    let findings;
    let engine;
    try {
      if (PyRunner.isFlake8Ready()) {
        findings = await PyRunner.lint(ctx.source, { filename, maxLineLength });
        engine = "flake8 7.x";
      } else {
        findings = PyRunner.regexLint(ctx.source);
        engine = "built-in (flake8 unavailable)";
      }
    } catch (e) {
      findings = PyRunner.regexLint(ctx.source);
      engine = "built-in (flake8 errored)";
    }
    const earned = item.partial ? Math.max(0, points - findings.length) : (findings.length === 0 ? points : 0);
    const shown = findings.slice(0, item.maxShown ?? 12);
    const detail = findings.length === 0
      ? `Clean — no ${engine} findings.`
      : `${engine}: ${findings.length} finding(s).\n${shown.join("\n")}`;
    return { earned, pass: findings.length === 0, detail };
  }

  // Credit is proportional to the fraction of matching lines within each
  // case (not all-or-nothing) — a submission that gets 9 of 15 lines right
  // earns 60% of that case's points, not zero. Accumulate with full
  // precision and only round once at the end — rounding each case first and
  // summing the rounded values can overshoot the total (e.g. three cases at
  // 6.666.../each round to 6.67, which sums to 20.01, not 20).
  function outputDiffCheck(item, ctx) {
    const cases = item.cases || [];
    const points = item.points ?? 0;
    const perCase = item.pointsPerCase ?? (cases.length ? points / cases.length : 0);
    let earned = 0;
    const detail = (ctx.results || []).map((r, i) => {
      const c = cases[i] || { name: `case ${i + 1}`, expected: [] };
      const cmp = Checks.diffLines(r.out, c.expected, { anchor: item.anchor });
      const total = cmp.rows.length || 1;
      const matched = cmp.rows.filter((row) => row.ok).length;
      const pct = matched / total;
      const casePts = perCase * pct;
      earned += casePts;
      const casePtsLabel = round2(casePts);
      const status = cmp.allMatch
        ? `<span class="good">✓ ${c.name} — exact match (+${casePtsLabel})</span>`
        : `<span class="bad">${pct > 0 ? "±" : "✗"} ${c.name} — ${Math.round(pct * 100)}% of lines match (+${casePtsLabel} / ${round2(perCase)})</span>`;
      let diff = "";
      if (!cmp.allMatch) {
        const body = cmp.rows.map((row) => row.ok
          ? `  ${escapeHTML(row.g)}`
          : `<span class="miss">- expected: ${escapeHTML(row.e)}</span>\n<span class="miss">+ got:      ${escapeHTML(row.g)}</span>`
        ).join("\n");
        diff = `<details class="diff"><summary>show diff</summary><pre class="io">${body}</pre></details>`;
      }
      return status + diff;
    }).join("<br>");
    return { earned: round2(earned), detail, raw: true };
  }

  async function runCheck(item, ctx) {
    if (item.type === "flake8") return flake8Check(item, ctx);
    if (item.type === "output-diff") return outputDiffCheck(item, ctx);
    if (item.type === "custom") {
      if (typeof item.check !== "function") {
        throw new Error(`Rubric: criterion "${item.id}" has type "custom" but no check().`);
      }
      return (await item.check(ctx)) || {};
    }
    return matchText(textFor(item, ctx), item);
  }

  // Grade `criteria` (array of items) against `ctx`. Returns:
  //   { items: [{ id, name, desc, points, earned, pass, detail, raw }], total, max }
  // `raw: true` on an item means `detail` is already HTML (built by rubric.js
  // itself, e.g. "output-diff"'s collapsible diff) — renderers should not
  // escape it. Async — checks run one at a time (see note above on Pyodide
  // concurrency).
  async function grade(criteria, ctx) {
    const fullCtx = {
      ...ctx,
      combinedOutput: ctx.combinedOutput ?? (ctx.results || []).map((r) => r.out || "").join("\n"),
    };
    const items = [];
    for (const item of criteria) {
      const points = item.points ?? 0;
      let result;
      try {
        result = await runCheck(item, fullCtx);
      } catch (e) {
        result = { pass: false, detail: `Check error: ${e.message}` };
      }
      // Clamped and rounded once here — the single place every check type's
      // score passes through — so no check has to worry about float drift
      // pushing earned past points (or leaving a stray .01 behind).
      const rawEarned = result.earned != null ? result.earned : (result.pass ? points : 0);
      const earned = round2(Math.min(Math.max(rawEarned, 0), points));
      items.push({
        id: item.id,
        name: item.name,
        desc: item.desc || "",
        points,
        earned,
        pass: earned >= points,
        detail: result.detail || "",
        raw: !!result.raw,
      });
    }
    const total = round2(items.reduce((sum, i) => sum + i.earned, 0));
    const max = criteria.reduce((sum, i) => sum + (i.points || 0), 0);
    return { items, total, max };
  }

  return { grade };
})();
