// grader.js
// Generic UI + grading-flow glue for a Pyodide-based autograder page: file
// drop/selection, PyRunner init, the Grade button, and rubric rendering.
// Nothing here knows about any specific assignment — a new assignment page
// supplies test cases and a rubric (see rubric.js) via GraderApp.init(),
// reusing the same page skeleton (element ids below) and a1.css.
//
// Expected element ids on the page: status, run, reset, drop, file,
// filename, rubric, zero, totalbox, totalnum, headline.
const GraderApp = (() => {
  const $ = (id) => document.getElementById(id);

  function escapeHTML(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
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

    $("reset").addEventListener("click", () => {
      source = null;
      fileInput.value = "";
      $("filename").textContent = "";
      $("rubric").innerHTML = "";
      $("totalbox").style.display = "none";
      $("zero").style.display = "none";
      $("headline").textContent = "—";
      runBtn.disabled = true;
      statusEl.textContent = PyRunner.isReady() ? "Ready. Load a file to grade." : "Loading Python runtime…";
    });

    runBtn.addEventListener("click", async () => {
      if (!source || !PyRunner.isReady()) return;
      runBtn.disabled = true;
      statusEl.textContent = "Grading…";
      $("rubric").innerHTML = "";
      $("zero").style.display = "none";

      const syntaxProbe = await PyRunner.run(source, cases[0].stdin, { filename });
      const hasSyntaxError = syntaxProbe.err.startsWith("SYNTAX:");

      const rows = [rowHTML({
        mark: hasSyntaxError ? "✗" : "✓",
        state: hasSyntaxError ? "fail" : "pass",
        name: "Compiles without syntax errors",
        desc: "Gate: a syntax error forces a total score of zero.",
        score: hasSyntaxError ? "ZERO" : "OK",
        detail: hasSyntaxError ? `<span class="bad">${escapeHTML(syntaxProbe.err.replace("SYNTAX:", ""))}</span>` : "",
      })];

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
          rows.push(rowHTML({
            mark: item.pass ? "✓" : (item.earned > 0 ? "±" : "✗"),
            state: item.pass ? "pass" : (item.earned > 0 ? "pending" : "fail"),
            name: item.name,
            desc: item.desc,
            score: `${item.earned} / ${item.points}`,
            detail: item.raw ? item.detail : escapeHTML(item.detail),
          }));
        }

        for (const m of manualRows) {
          rows.push(rowHTML({ mark: "—", state: "pending", ...m }));
        }
      }

      $("rubric").innerHTML = rows.join("");
      $("totalbox").style.display = "flex";
      $("totalnum").textContent = `${total} / ${maxAuto}`;
      $("headline").textContent = total;
      statusEl.textContent = "Done.";
      runBtn.disabled = false;
    });
  }

  return { init, escapeHTML };
})();
