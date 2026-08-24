// grader.js
// Generic UI + grading-flow glue for a Pyodide-based autograder page: file
// drop/selection, PyRunner init, the Grade button, and rubric rendering.
// Nothing here knows about any specific assignment — a new assignment page
// supplies test cases and a rubric (see rubric.js) via GraderApp.init(),
// reusing the same page skeleton (element ids below) and a1.css.
//
// Expected element ids on the page: status, run, drop, file,
// filename, rubric, zero, headline, summarybox, summary, copy, copystatus.
const GraderApp = (() => {
  const $ = (id) => document.getElementById(id);

  function escapeHTML(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function summaryText({ filename, total, maxAuto, hasSyntaxError, rowsData }) {
    const lines = [`${filename} — Autograder Summary`];
    lines.push(hasSyntaxError ? "Score: 0 (syntax error — see below)" : `Score: ${total} / ${maxAuto}`);
    lines.push("");
    for (const r of rowsData) {
      lines.push(`- ${r.name}: ${r.score}`);
    }
    return lines.join("\n");
  }

  function rowHTML({ mark, state, name, desc, score, detail }) {
    const detailHTML = detail ? `<div class="r-detail">${detail}</div>` : "";
    return `
      <div class="rubric-row">
        <div class="mark ${state}">${mark}</div>
        <div>
          <div class="r-name">${name}</div>
          <div class="r-desc">${desc}</div>
          ${detailHTML}
        </div>
        <div class="r-score">${score}</div>
      </div>`;
  }

  // config:
  //   filename    - expected submission filename, e.g. "program1.py"
  //   cases       - array of { name, stdin, expected } test cases; cases[0].stdin
  //                 is used to probe for a syntax error before grading anything else
  //   buildCriteria(results) -> Rubric criteria array (see rubric.js), where
  //                 `results` is the array of PyRunner.run() outputs, one per case
  //   manualRows  - array of { name, desc, score, detail } shown as-is, not
  //                 auto-graded and not counted toward the total (e.g. rubric
  //                 items this tool can't check, like variable naming)
  //   maxAuto     - denominator shown next to the auto-graded total
  function init(config) {
    const { filename, cases, buildCriteria, manualRows = [], maxAuto } = config;

    let source = null;
    const statusEl = $("status");
    const runBtn = $("run");
    const drop = $("drop");
    const fileInput = $("file");

    (async function boot() {
      await PyRunner.init({ onStatus: (msg) => { statusEl.textContent = msg; } });
      runBtn.disabled = !source || !PyRunner.isReady();
    })();

    function acceptFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        source = reader.result;
        $("filename").textContent = file.name +
          (file.name !== filename ? `  ⚠ Submit this file as ${filename} on BrightSpace` : "  ✓");
        $("rubric").innerHTML = "";
        $("zero").style.display = "none";
        $("summarybox").style.display = "none";
        $("summary").value = "";
        $("headline").textContent = "—";
        runBtn.disabled = !PyRunner.isReady();
        statusEl.textContent = "File loaded. Ready to grade.";
      };
      reader.readAsText(file);
    }

    drop.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => acceptFile(e.target.files[0]));
    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); })
    );
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); })
    );
    drop.addEventListener("drop", (e) => acceptFile(e.dataTransfer.files[0]));

    runBtn.addEventListener("click", async () => {
      if (!source || !PyRunner.isReady()) return;
      runBtn.disabled = true;
      statusEl.textContent = "Grading…";
      $("rubric").innerHTML = "";
      $("zero").style.display = "none";

      const syntaxProbe = await PyRunner.run(source, cases[0].stdin, { filename });
      const hasSyntaxError = syntaxProbe.err.startsWith("SYNTAX:");

      const rowsData = [{
        mark: hasSyntaxError ? "✗" : "✓",
        state: hasSyntaxError ? "fail" : "pass",
        name: "Compiles without syntax errors",
        desc: "Gate: a syntax error forces a total score of zero.",
        score: hasSyntaxError ? "ZERO" : "OK",
        detail: hasSyntaxError ? `<span class="bad">${escapeHTML(syntaxProbe.err.replace("SYNTAX:", ""))}</span>` : "",
      }];

      let total = 0;
      if (hasSyntaxError) {
        $("zero").style.display = "block";
        $("zero").textContent = "Syntax error — score is zero per assignment policy.";
      } else {
        const results = [];
        for (const c of cases) {
          results.push(await PyRunner.run(source, c.stdin, { filename }));
        }

        const report = await Rubric.grade(buildCriteria(results), { source, results });
        total = report.total;

        for (const item of report.items) {
          rowsData.push({
            mark: item.pass ? "✓" : (item.earned > 0 ? "±" : "✗"),
            state: item.pass ? "pass" : (item.earned > 0 ? "pending" : "fail"),
            name: item.name,
            desc: item.desc,
            score: `${item.earned} / ${item.points}`,
            detail: item.raw ? item.detail : escapeHTML(item.detail),
          });
        }

        for (const m of manualRows) {
          rowsData.push({ mark: "—", state: "pending", ...m });
        }
      }

      $("rubric").innerHTML = rowsData.map(rowHTML).join("");
      $("headline").textContent = total;

      $("summary").value = summaryText({ filename, total, maxAuto, hasSyntaxError, rowsData });
      $("summarybox").style.display = "block";
      $("copystatus").textContent = "";

      statusEl.textContent = "Done.";
      runBtn.disabled = false;
    });

    $("copy").addEventListener("click", async () => {
      const text = $("summary").value;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        $("summary").select();
        document.execCommand("copy");
      }
      $("copystatus").textContent = "Copied!";
    });
  }

  return { init, escapeHTML };
})();
