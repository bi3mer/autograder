// w3p2's grading rules: its cases, its rubric, and the file and points
// they grade. assignment.html?id=w3p2 grades with them in the browser, and
// api/worker.js imports them to grade from the terminal, so a submission
// scores the same either way.

// The prompt drives both the input() needle the rubric looks
// for and the stdin each case feeds, so the wording is written
// once here. The handout quotes it again in w3p2.md, which is
// the one place the two can drift.
const PROMPTS = ["Enter a positive number: "];

function sum_to(n) {
    let total = 0;
    for (let i = 1; i <= n; i++) total += i;
    return total;
}

// `attempts` is every value the user types, in order: all but
// the last are rejected (0 or negative) and reprompted, and the
// last is the N the sum is computed from. A single valid entry
// is just an attempts array of length 1.
function make_case(name, attempts) {
    const n = attempts[attempts.length - 1];
    return {
        name,
        stdin_lines: attempts.map(String),
        expected_lines: [
            ...attempts.map((a) => `Enter a positive number: ${a}`),
            `Sum: ${sum_to(n)}`,
        ],
    };
}

// Examples 1-4 are the handout's. The rest each catch a
// wrong-but-plausible implementation, and the comment on each
// says which one.
const CASES = [
    make_case("Example 1 — sum 1 to 3", [3]),
    make_case("Example 2 — sum 1 to 1", [1]),
    // Catches a check that only rejects negatives — 0 is not
    // positive either, and must be reprompted too.
    make_case("Example 3 — 0 is not positive, reprompted", [0, 3]),
    make_case("Example 4 — one negative attempt before a valid N", [-2, 3]),
    // Catches an off-by-one that stops the loop before adding N
    // itself, e.g. `range(1, n)` or `while i < n`.
    make_case("Example 5 — off-by-one on the last term", [5]),
    // Several invalid attempts (negative and zero) in a row, so
    // a loop bound to a fixed number of retries falls short here.
    make_case("Example 6 — several invalid attempts before a valid N", [-1, 0, -3, 5]),
    // A larger N, so a loop that works by coincidence on tiny
    // inputs (or a hardcoded lookup for the handout's examples)
    // still has to actually compute the sum.
    make_case("Example 7 — larger N", [100]),
    // 100 invalid attempts (negative and zero, alternating)
    // before a valid one, so any reprompt loop capped at a
    // fixed retry count falls short here — only an unbounded
    // loop passes.
    make_case("Example 8 — 100 invalid attempts before a valid N", [
        ...Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? -(i + 1) : 0)),
        7,
    ]),
];

// Both quote styles, and with or without the trailing space, so a
// student is graded on the prompt's wording rather than on which
// quote character they reached for.
function prompt_needles(prompt) {
    const trimmed = prompt.trimEnd();
    return [
        `input("${prompt}")`,
        `input('${prompt}')`,
        `input("${trimmed}")`,
        `input('${trimmed}')`,
    ];
}

function build_criteria(results) {
    return [
        {
            id: "input",
            name: "Input handling",
            points: 10,
            description:
                "Source calls input() with the exact prompt text from the handout.",
            type: "code",
            needles: PROMPTS.map(prompt_needles),
            mode: "all",
        },
        {
            id: "output",
            name: "Correct output",
            points: 15,
            description:
                "15 points split evenly across all examples, prorated by the % of lines that match exactly.",
            type: "output-diff",
            cases: CASES,
        },
        {
            // Only requires a `for` somewhere in the source. Unlike
            // w3p1, this does not ban `while` outright: the reprompt
            // loop for a non-positive N is naturally a `while`, so a
            // correct submission has both keywords present. This
            // can't tell which loop is which, so it is really "used a
            // for loop at all," not "the sum used a for loop" — a
            // regex, not a parser.
            id: "for_loop",
            name: "Uses a for loop",
            points: 5,
            description:
                "The summing loop must be a `for` loop.",
            type: "code-regex",
            regex: /\bfor\b/,
        },
        {
            id: "flake8",
            name: "flake8",
            points: 10,
            description:
                "−1 point per flake8 finding, down to a floor of 0.",
            type: "flake8",
            partial: true,
        },
    ];
}

export const assignment = {
    filename: "w3-2.py",
    cases: CASES,
    build_criteria,
    max_auto_points: 40,
};

// What cs230/assignment.html?id=w3p2 shows around the grader.
export const page = {
    title: "Sum 1 to N Autograder",
    editor: true,
};
