// w3p1's grading rules: its cases, its rubric, and the file and points
// they grade. assignment.html?id=w3p1 grades with them in the browser, and
// api/worker.js imports them to grade from the terminal, so a submission
// scores the same either way.

// The fake input() echoes prompt + value on one line, so every
// retry the loop makes shows up as its own "Yes or no? ..."
// line. That is what lets the output-diff cases below check the
// looping itself, not just the final sentence: a submission
// that stops retrying too soon or too late loses lines here
// even though there is no input-handling criterion to catch it.
const PROMPT = "Yes or no? ";

// Example 1 is the handout's. The rest each catch a
// wrong-but-plausible implementation, and the comment on each
// says which one. No input-handling criterion this time, so
// these cases carry the whole 30 points — every echoed retry
// line counts toward the score, not just the final sentence.
const CASES = [
    {
        name: "Example 1 — invalid attempts before 'no'",
        stdin_lines: ["n", "NO", "nO", "I said no!", "no"],
        expected_lines: [
            `${PROMPT}n`,
            `${PROMPT}NO`,
            `${PROMPT}nO`,
            `${PROMPT}I said no!`,
            `${PROMPT}no`,
            "The user said no.",
        ],
    },
    {
        name: "Example 2 — 'yes' on the first try",
        stdin_lines: ["yes"],
        expected_lines: [`${PROMPT}yes`, "The user said yes."],
    },
    {
        name: "Example 3 — 'no' on the first try",
        stdin_lines: ["no"],
        expected_lines: [`${PROMPT}no`, "The user said no."],
    },
    {
        // Catches a check that strips the input before comparing,
        // which would accept a leading space as "yes".
        name: "Example 4 — leading space is not 'yes'",
        stdin_lines: [" yes", "yes"],
        expected_lines: [
            `${PROMPT} yes`,
            `${PROMPT}yes`,
            "The user said yes.",
        ],
    },
    {
        // Catches .lower()/.upper() normalization the handout
        // says not to bother with — "Yes" must be rejected.
        name: "Example 5 — 'Yes' with a capital is rejected",
        stdin_lines: ["Yes", "yes"],
        expected_lines: [
            `${PROMPT}Yes`,
            `${PROMPT}yes`,
            "The user said yes.",
        ],
    },
    {
        // Catches `"yes" in answer`, which would wrongly accept
        // any string containing "yes" as a substring.
        name: "Example 6 — 'yesterday' is not 'yes'",
        stdin_lines: ["yesterday", "no"],
        expected_lines: [
            `${PROMPT}yesterday`,
            `${PROMPT}no`,
            "The user said no.",
        ],
    },
    {
        // Catches a check that strips the input before comparing,
        // which would accept a trailing space as "no".
        name: "Example 7 — trailing space is not 'no'",
        stdin_lines: ["no ", "no"],
        expected_lines: [
            `${PROMPT}no `,
            `${PROMPT}no`,
            "The user said no.",
        ],
    },
    {
        // A longer run of garbage before a valid answer, so a
        // loop bound to a fixed number of retries (or one that
        // gives up after a couple of tries) falls short here.
        name: "Example 8 — several bad attempts before 'yes'",
        stdin_lines: ["blah", "1", "YES", "Yes", "yes"],
        expected_lines: [
            `${PROMPT}blah`,
            `${PROMPT}1`,
            `${PROMPT}YES`,
            `${PROMPT}Yes`,
            `${PROMPT}yes`,
            "The user said yes.",
        ],
    },
    {
        // 100 bad attempts before a valid one, so any loop
        // capped at a fixed retry count (a `for` loop over a
        // fixed `range`, or a `while` with a hardcoded limit)
        // falls short here — only an unbounded loop passes.
        name: "Example 9 — 100 invalid attempts before 'yes'",
        stdin_lines: [
            ...Array.from({ length: 100 }, (_, i) => `bad${i}`),
            "yes",
        ],
        expected_lines: [
            ...Array.from({ length: 100 }, (_, i) => `${PROMPT}bad${i}`),
            `${PROMPT}yes`,
            "The user said yes.",
        ],
    },
];

function build_criteria(results) {
    return [
        {
            id: "output",
            name: "Correct output",
            points: 25,
            description:
                "25 points split evenly across all examples, prorated by the % of lines that match exactly.",
            type: "output-diff",
            cases: CASES,
        },
        {
            // A regex, not a parser: the lookahead scans the whole source
            // (dotAll, so it crosses lines) for a `for` keyword before
            // requiring a `while` somewhere in the file. A `for` inside a
            // comment or string would also trip this — an acceptable
            // false positive for a grading preview tool on an assignment
            // this small.
            id: "while_loop",
            name: "Uses a while loop",
            points: 5,
            description:
                "The retry loop must be a `while` loop, not a `for` loop.",
            type: "code-regex",
            regex: /^(?![\s\S]*\bfor\b)[\s\S]*\bwhile\b/s,
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
    filename: "w3-1.py",
    cases: CASES,
    build_criteria,
    max_auto_points: 40,
};

// What cs230/assignment.html?id=w3p1 shows around the grader.
export const page = {
    title: "Yes or No Autograder",
    editor: true,
};
