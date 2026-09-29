// w1p2's grading rules: its cases, its rubric, and the file and points
// they grade. assignment.html?id=w1p2 grades with them in the browser, and
// api/worker.js imports them to grade from the terminal, so a submission
// scores the same either way.

const CASES = [
    {
        name: "Example 1 — 2.5 hours",
        stdin_lines: ["2.5"],
        expected_lines: ["Parking fee: $ 11.25"],
    },
    {
        name: "Example 2 — 10 hours (over the cap)",
        stdin_lines: ["10"],
        expected_lines: ["Parking fee: $ 20.00"],
    },
    {
        name: "Example 3 — 0 hours (flat fee only)",
        stdin_lines: ["0"],
        expected_lines: ["Parking fee: $ 5.00"],
    },
    {
        name: "Example 4 — 6 hours (exactly at the cap)",
        stdin_lines: ["6"],
        expected_lines: ["Parking fee: $ 20.00"],
    },
];

function build_criteria(results) {
    return [
        {
            id: "input",
            name: "Input handling",
            points: 10,
            description:
                "Source calls input() with the exact prompt text from the handout.",
            type: "code",
            needles: [
                [
                    'input("Enter hours parked: ")',
                    "input('Enter hours parked: ')",
                    'input("Enter hours parked:")',
                    "input('Enter hours parked:')",
                ],
            ],
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
            anchor_prefix: "Parking fee: $",
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
    filename: "w1-2.py",
    cases: CASES,
    build_criteria,
    max_auto_points: 40,
};

// What cs230/assignment.html?id=w1p2 shows around the grader.
export const page = {
    title: "Parking Fee Autograder",
    editor: false,
};
