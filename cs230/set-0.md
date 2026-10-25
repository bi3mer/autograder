# Practice Problem: Course Planner

A student picking next term's classes needs to know which ones they can take now. This program reads a course catalog, asks which courses the student has taken, and prints every other course with whether it is ready or which prerequisites are still missing.

The program is three functions, and the whole program fits in about 35 lines.

## Starter Code

Start from this code. Replace each `pass` with the function's body, and keep the last two lines at the end of the program:

```python
import sys


def read_catalog(filename):
    pass


def print_plan(catalog, taken):
    pass


def main():
    pass


if __name__ == "__main__":
    main()
```

Every line you add belongs inside a function.

## The File

The first line is a header that names the columns. Every line after it is a course, its credits, and then its prerequisites, separated by commas:

```
course,credits,prerequisites
CS 101,4
CS 102,4,CS 101
CS 201,4,CS 102,MATH 101
CS 210,3,CS 102
MATH 101,4
MATH 102,4,MATH 101
ART 100,3
```

A course can have any number of prerequisites, including none: `CS 101` has none, and `CS 201` has two. Download the file and save it in the same folder as your program:

- [courses.csv](set-0/courses.csv)

## Input

The program asks for the file's name with the prompt `"File name: "`. If no file has that name, the program stops there. Otherwise it asks for the courses taken with the prompt `"Courses taken: "`.

Courses taken are typed on one line, separated by commas with no spaces after them, as in `CS 101,MATH 101`. Case does not matter, so `cs 101` is `CS 101`. A blank answer means no courses taken.

## Processing

- `read_catalog(filename)`
  - Reads the file and returns a dictionary of records, one per course, keyed by the course: `{"CS 102": {"credits": 4, "needs": {"CS 101"}}, ...}`. The credits are an int, and the prerequisites are a set. It prints nothing.
    - Hint: [A Dictionary of Dictionaries](https://bi3mer.github.io/lectures/cs230/13-records-and-sets.html#7).
- `print_plan(catalog, taken)`
  - Takes the catalog and a set of the courses taken, and prints the plan. Finds what each course still needs with `-`, and prints it with `sorted()`.
    - Hint: [Combining Sets](https://bi3mer.github.io/lectures/cs230/13-records-and-sets.html#16).
- `main()`
  - Takes no parameters. Asks for the file's name and reads the catalog, then asks for the courses taken, makes a set of them, and calls `print_plan`.
  - Handles a file that does not exist by ending the program with [`sys.exit(1)`](https://bi3mer.github.io/lectures/cs230/exit.html) after its message.
    - Hint: [Shared Hobbies (us)](https://bi3mer.github.io/lectures/cs230/13-records-and-sets.html#17).

Each `except` names the exception it catches.

_Review for quiz: `taken` is a set. What happens to `record["needs"] - taken` if `main` passes the list from `split(",")` instead?_

## Output

A file that does not exist prints `Could not open missing.csv.`, with the name that was typed, and nothing after it.

Otherwise the program prints one line per course not taken, in the file's order. A course whose prerequisites have all been taken prints as ready, as in `CS 102 (4 credits): ready`. Any other course prints the prerequisites it is missing, in sorted order, as in `CS 201 (4 credits): needs ['CS 102', 'MATH 101']`. The last line adds up the credits of every ready course: `Ready credits: 11`.

## Examples

```
File name: courses.csv
Courses taken: cs 101,MATH 101
CS 102 (4 credits): ready
CS 201 (4 credits): needs ['CS 102']
CS 210 (3 credits): needs ['CS 102']
MATH 102 (4 credits): ready
ART 100 (3 credits): ready
Ready credits: 11
```

With nothing taken, every course with prerequisites is waiting on them:

```
File name: courses.csv
Courses taken:
CS 101 (4 credits): ready
CS 102 (4 credits): needs ['CS 101']
CS 201 (4 credits): needs ['CS 102', 'MATH 101']
CS 210 (3 credits): needs ['CS 102']
MATH 101 (4 credits): ready
MATH 102 (4 credits): needs ['MATH 101']
ART 100 (3 credits): ready
Ready credits: 11
```

There is no file named `missing.csv`:

```
File name: missing.csv
Could not open missing.csv.
```

The grader also tries answers and a catalog that are not in the handout, including every course taken, a course the catalog does not have, and a course with three prerequisites.

## How to Submit

Grade your program on this page, then press **Copy for submission**. That puts the autograder summary and your code on the clipboard as one paste, in the shape BrightSpace wants it: the summary inside a docstring, a blank line, then your code. Paste the whole thing into the **text submission** box.

```python
"""
set-0.py — Autograder Summary
Score: 75 / 80

- Compiles without syntax errors: OK
- Does not import csv or pandas: OK
- Input handling: 5 / 5
- Correct output: 35 / 35
- Stores each course as a record: 5 / 10
- Finds missing prerequisites with -: 10 / 10
- Prints the missing courses sorted: 5 / 5
- Functions: 5 / 5
- Exits on a missing file: 5 / 5
- Runs from main(): 5 / 5

AI prompts, one per line (write none if you asked none):
-
-
-
"""

# ... your submission code here
```

A docstring has to be the first statement, so it goes above your code, not below it. **Your grade drops by 50% if the summary is missing, or if it sits anywhere other than a docstring at the top.** These all cost you half the points:

- No summary anywhere in the submission.
- The summary pasted below the code.
- The summary above the code but outside the `"""` quotes.

Fill in the `AI prompts` lines before you submit: one question per line, or `none` if you asked none. They stay inside the docstring, under the summary.

Indentation is yours to protect. BrightSpace's editor drops the leading spaces when you paste, and Python without its indentation does not run. Paste as plain text with `Ctrl+Shift+V` (`Cmd+Shift+V` on a Mac), or put the whole submission in a code block.
