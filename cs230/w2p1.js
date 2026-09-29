// w2p1's grading rules: its cases, its rubric, and the file and points
// they grade. assignment.html?id=w2p1 grades with them in the browser, and
// api/worker.js imports them to grade from the terminal, so a submission
// scores the same either way.

// The prompts drive both the input() needles the rubric looks
// for and the stdin each case feeds, so the wording is written
// once here. The handout quotes them again in w2p1.md, which is
// the one place the two can drift.
const PROMPTS = [
  "How much did you spend? ",
  "Employee (e), member (m), or Enter to skip: ",
];

// The last two cases cover the $10,000 tier, which the first three
// never cross: an employee at exactly the line (30% + 5%) and a
// non-member above it (5% alone). Without them a program that
// ignores the tier still scores full marks on output.
const CASES = [
  {
    name: "Example 1 — $12, employee typed as E",
    stdin_lines: ["12", "E"],
    expected_lines: ["Discount Received: $3.60", "New total: $8.40"],
  },
  {
    name: "Example 2 — $10,000, neither member nor employee",
    stdin_lines: ["10000", "asdf"],
    expected_lines: ["Discount Received: $500.00", "New total: $9500.00"],
  },
  {
    name: "Example 3 — $42, member",
    stdin_lines: ["42", "m"],
    expected_lines: ["Discount Received: $4.20", "New total: $37.80"],
  },
  {
    name: "Example 4 — $10,000, employee (30% + 5%)",
    stdin_lines: ["10000", "e"],
    expected_lines: [
      "Discount Received: $3500.00",
      "New total: $6500.00",
    ],
  },
  {
    name: "Example 5 — $12,500, membership skipped (5% only)",
    stdin_lines: ["12500", ""],
    expected_lines: [
      "Discount Received: $625.00",
      "New total: $11875.00",
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
      points: 15,
      description:
        "15 points split evenly across all examples, prorated by the % of lines that match exactly.",
      type: "output-diff",
      cases: CASES,
      anchor_prefix: "Discount Received: $",
    },
    {
      // A regex, not a parser: the f/rf prefix must sit right before the
      // opening quote (word boundary ahead of it), so a .format() spec like
      // ".2f" ending just before a closing quote does not count.
      id: "fstrings",
      name: "Use of f-strings",
      points: 5,
      description: "Output is formatted with f-strings.",
      type: "code-regex",
      regex: /\b(?:[rR]?[fF]|[fF][rR])["']/,
    },
    {
      id: "flake8",
      name: "flake8",
      points: 10,
      description: "−1 point per flake8 finding, down to a floor of 0.",
      type: "flake8",
      partial: true,
    },
  ];
}

export const assignment = {
  filename: "w2-1.py",
  cases: CASES,
  build_criteria,
  max_auto_points: 40,
};

// What cs230/assignment.html?id=w2p1 shows around the grader.
export const page = {
  title: "Discounts Autograder",
  editor: true,
};
