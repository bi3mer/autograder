// w4i1's grading rules: its cases, its rubric, and the file and points
// they grade. assignment.html?id=w4i1 grades with them in the browser, and
// api/worker.js imports them to grade from the terminal, so a submission
// scores the same either way.

// The one prompt drives both the input() needle the rubric looks
// for and the stdin each case feeds, so the wording is written
// once here. The handout quotes it again in w4i1.md, which is the
// one place the two can drift.
const PROMPT = "Enter a string: ";

// The expected transcript is generated rather than typed out, so
// a case is just the list of answers the user types. Every answer
// is echoed after the prompt, and the last one is the string to
// spell; the ones before it are empty, since that is the only
// thing the loop rejects.
function spell_case(name, answers) {
    const string = answers[answers.length - 1];
    const lines = answers.map((answer) => PROMPT + answer);
    return {
        name,
        stdin_lines: answers,
        expected_lines: [...lines, ...Array.from(string)],
    };
}

// Cases 1-3 are the handout's examples. Case 3 is one character,
// which catches range(1, len(string)) printing nothing and a bound
// copied from an example, like range(5), raising IndexError. Case
// 4 is not in the handout, so a program that prints the examples'
// answers rather than working from the input fails it. Case 5
// rejects twice, which catches an if instead of a while: that
// survives one empty answer but not two.
const CASES = [
    spell_case("Example 1 — hello", ["hello"]),
    spell_case("Example 2 — empty is re-asked, then CS230!", ["", "CS230!"]),
    spell_case("Example 3 — a", ["a"]),
    spell_case("Example 4 — programming", ["programming"]),
    spell_case("Example 5 — two empties, then go", ["", "", "go"]),
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

// Every `for` statement, anchored to the start of a line like the
// while and for regexes in w3i2, so the word inside a comment
// cannot count. Group 1 is the loop target and group 2 the
// iterable up to the colon: `for i in range(len(string)):` yields
// "i" and "range(len(string))", and `for c in string:` yields "c"
// and "string".
const FOR_STATEMENT = /^[ \t]*for\s+(.+?)\s+in\s+(.+?)\s*:/gm;
const RANGE_CALL = /^range\s*\(/;

// Triple-quoted strings are blanked before scanning: the summary
// students paste in as a docstring is prose, and a sentence like
// "for each letter in the string:" at the start of a line would
// otherwise read as a forbidden loop. Only their newlines are
// kept, so the line numbers in the detail still match the editor.
const TRIPLE_QUOTED = /"""[\s\S]*?"""|'''[\s\S]*?'''/g;
function blank_triple_quoted(source) {
    return source.replace(TRIPLE_QUOTED, (text) => text.replace(/[^\n]/g, ""));
}

// Indexing by position is the point of the activity, so a for
// loop over anything other than range() (the string itself,
// enumerate(string), reversed(string)) scores zero even when a
// range() loop is also present. The detail names the line, since
// the student needs to know which loop cost them, not only that
// one did.
function range_loop_check(context) {
    const source = blank_triple_quoted(context.source);
    let range_loop = null;
    for (const match of source.matchAll(FOR_STATEMENT)) {
        const line_number = source.slice(0, match.index).split("\n").length;
        const statement = match[0].trim();
        const iterable = match[2];
        if (!RANGE_CALL.test(iterable)) {
            return {
                pass: false,
                detail:
                    `Line ${line_number} loops directly over "${iterable}" ` +
                    `("${statement}"), which has not been covered. ` +
                    "Loop over range(len(...)) and read each character " +
                    "by index instead.",
            };
        }
        range_loop ??= { line_number, statement };
    }
    if (range_loop === null) {
        return { pass: false, detail: 'No "for ... in range(...)" loop found.' };
    }
    return {
        pass: true,
        detail: `Line ${range_loop.line_number}: "${range_loop.statement}".`,
    };
}

function build_criteria(results) {
    return [
        {
            id: "input",
            name: "Input handling",
            points: 5,
            description:
                "Source calls input() with the exact prompt text from the handout.",
            type: "code",
            needles: [prompt_needles(PROMPT)],
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
            // The examples already fail a program that asks a
            // fixed number of times, so this row is about writing
            // the validation loop. `while` has to open a line,
            // which keeps the word inside a comment or a string
            // from earning the points.
            id: "while",
            name: "Use of a while loop",
            points: 5,
            description:
                "Re-asking for an empty string is done with a while loop rather than an if.",
            type: "code-regex",
            regex: /^[ \t]*while\b/m,
        },
        {
            // The row's name is pasted back into the source as a
            // docstring line, so it must not itself look like a
            // for statement or an index expression; the same
            // goes for the indexing row below.
            id: "range-loop",
            name: "Use of a for loop over range()",
            points: 5,
            description:
                "The for loop counts over range(len(...)).",
            type: "custom",
            check: range_loop_check,
        },
        {
            // A word character has to sit before the `[`, which
            // is what tells `string[i]` from a list literal like
            // `= [1, 2]`. Spaces between are allowed because
            // flake8 already charges for `string [i]` (E211). The
            // contents are left open so `string[i - 1]` under a
            // range(1, len(string) + 1) loop counts too.
            id: "indexing",
            name: "Indexing into the string",
            points: 5,
            description:
                "Each character is read by indexing the string with the loop variable (string[i]).",
            type: "code-regex",
            regex: /\w[ \t]*\[[^\]\n]+\]/,
        },
        {
            id: "flake8",
            name: "flake8",
            points: 5,
            description:
                "−1 point per flake8 finding, down to a floor of 0.",
            type: "flake8",
            partial: true,
        },
    ];
}

export const assignment = {
    filename: "w4-i1.py",
    cases: CASES,
    build_criteria,
    max_auto_points: 40,
};

// What cs230/assignment.html?id=w4i1 shows around the grader.
export const page = {
    title: "Spell It Out Autograder",
    editor: true,
};
