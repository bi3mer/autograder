# Practice Problem: Search My Notes

A student keeps class notes as text files in a folder. Before an exam, they want to know which notes used a certain substring. This program asks which folder to search and which word to look for, then prints every note in the folder with how many of its lines hold the word.

## Starter Code

Start from this code. Replace each `pass` with the function's body, and keep `main` and the last two lines as they are:

```python
import os


def ask_folder():
    pass


def count_matches(path, word):
    pass


def search_notes(folder, word):
    pass


def main():
    folder = ask_folder()
    word = input("Search for: ")
    search_notes(folder, word)


if __name__ == "__main__":
    main()
```

## The Files

Download [os-0.zip](os-0/os-0.zip) and unzip it. Save your program in the `os-0` folder it makes, beside `README.md` and the `notes` folder:

```
os-0/
├── os-0.py
├── README.md
└── notes/
    ├── cs230.txt
    ├── groceries.txt
    ├── history.txt
    ├── todo.md
    └── old/
        └── cs171.txt
```

A note is a file directly in the folder whose name ends in `.txt`. In `notes`, `todo.md` is not a note, and neither is the folder `old` or anything in it.

## Input

The program asks for a folder with the prompt `"Folder: "`, again and again until the answer names a folder. Then it asks for a word with the prompt `"Search for: "`.

## Processing

- `ask_folder()`
  - Asks for a folder until the answer names one, and returns the answer.
    - Hint: [Pick a File (us)](https://bi3mer.github.io/lectures/cs230/11-os-module.html#26).
- `count_matches(path, word)`
  - Takes the path to one note and a word, and returns how many of the note's lines contain the word, ignoring upper and lower case. It prints nothing.
- `search_notes(folder, word)`
  - Takes the folder and the word, and prints each note in the folder with its count from `count_matches`.
  - Goes through the names in the folder in order with `sorted()` and `os.listdir()`, builds each name's path with `os.path.join()`, and skips anything that is not a note, checking with `os.path.isfile()`.
    - Hint: [Total of Every Month (us)](https://bi3mer.github.io/lectures/cs230/11-os-module.html#31).
- `main()`
  - Given in the starter code. It gets the folder and the word, and calls `search_notes` with them.

_Review for quiz: `listdir` already gave `search_notes` the name `cs230.txt`. Why does `search_notes` still need `os.path.join(folder, name)` before it opens the file?_

## Output

An answer that is not a folder prints `No folder named {VARIABLE-NAME}.`, with the answer that was typed. After the word, each note prints on a line of its own, in sorted order: its name, a colon, and its count, as in `cs230.txt: 2`. The line shows the note's name, not its path. A note with no matches prints a count of 0, and a folder with no notes prints nothing after the prompts.

## Examples

```
Folder: notse
No folder named notse.
Folder: README.md
No folder named README.md.
Folder: notes
Search for: exam
cs230.txt: 2
groceries.txt: 0
history.txt: 1
```

The search ignores case in the word and in the notes:

```
Folder: notes
Search for: EXAM
cs230.txt: 2
groceries.txt: 0
history.txt: 1
```

The grader also tries folders that are not in the handout: one holding a folder whose name ends in `.txt`, notes with the word twice on one line, and a folder with no notes.

## How to Submit

Grade your program on this page, then press **Copy for submission**. That puts the autograder summary and your code on the clipboard as one paste, in the shape BrightSpace wants it: the summary inside a docstring, a blank line, then your code. Paste the whole thing into the **text submission** box.

```python
"""
os-0.py — Autograder Summary
Score: 75 / 80

- Compiles without syntax errors: OK
- Input handling: 5 / 5
- Correct output: 35 / 35
- Functions: 10 / 10
- Builds paths with join(): 10 / 10
- Skips folders with isfile(): 10 / 10
- Lists the folder with sorted(): 5 / 5
- Runs from main(): 0 / 5

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
