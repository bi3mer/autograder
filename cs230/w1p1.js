// w1p1's grading rules: its cases, its rubric, and the file and points
// they grade. assignment.html?id=w1p1 grades with them in the browser, and
// api/worker.js imports them to grade from the terminal, so a submission
// scores the same either way.

// The prompts drive both the input() needles the rubric looks
// for and the stdin each case feeds, so the wording is written
// once here. The handout quotes them again in w1p1.md, which is
// the one place the two can drift.
const PROMPTS = [
    "Enter price per item: ",
    "Enter number of items: ",
];

const CASES = [
    {
        name: "Example 1 — 3 items at $10",
        stdin_lines: ["10", "3"],
        expected_lines: [
            "Pre-tax cost= 30.0",
            "Tax paid= 2.25",
            "After-tax cost= 32.25",
        ],
    },
    {
        name: "Example 2 — 7 items at $3.95",
        stdin_lines: ["3.95", "7"],
        expected_lines: [
            "Pre-tax cost= 27.65",
            "Tax paid= 2.07",
            "After-tax cost= 29.72",
        ],
    },
    {
        name: "Example 3 — 12 items at $19.99",
        stdin_lines: ["19.99", "12"],
        expected_lines: [
            "Pre-tax cost= 239.88",
            "Tax paid= 17.99",
            "After-tax cost= 257.87",
        ],
    },
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
            points: 20,
            description:
                "20 points split evenly across all examples, prorated by the % of lines that match exactly.",
            type: "output-diff",
            cases: CASES,
            anchor_prefix: "Pre-tax cost=",
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
    filename: "w1-1.py",
    cases: CASES,
    build_criteria,
    max_auto_points: 40,
};

// What cs230/assignment.html?id=w1p1 shows around the grader.
export const page = {
    title: "Purchase Autograder",
    editor: false,
};
