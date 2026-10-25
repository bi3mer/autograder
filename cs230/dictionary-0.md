# Practice Problem: Coffee Cart

A coffee cart takes orders one at a time until the line is empty. Then it prints a receipt: how many of each item were ordered and what they cost, the best seller, and the total.

## Starter Code

Start from this code. Replace each `pass` with the function's body, and keep the last two lines at the end of the program:

```python
def read_orders(menu):
    pass


def print_receipt(menu, counts):
    pass


def main():
    menu = {"coffee": 3.00, "latte": 4.50, "tea": 2.50, "bagel": 2.75, "muffin": 3.25}


if __name__ == "__main__":
    main()
```

Every line you add belongs inside a function. **Do not change `menu`**.

## Input

Every order is read with the prompt `"Order: "`, and a blank order ends the orders. An order ignores case and any spaces around it, so `Coffee` is an order for `coffee`, and so is `COFFEE` with spaces before it.

## Processing

- `read_orders(menu)`
  - Takes the menu, asks for orders until a blank one, and returns a dictionary of how many of each item were ordered. An order the menu does not have is not counted.
    - Hint: [Counting with a Dictionary](https://bi3mer.github.io/lectures/cs230/12-dictionaries.html#24).
- `print_receipt(menu, counts)`
  - Takes the menu and the counts, and prints the receipt. Goes through the counts with `items()`.
    - Hint: [Best Day (us)](https://bi3mer.github.io/lectures/cs230/12-dictionaries.html#21).
- `main()`
  - Takes no parameters. Reads the orders and prints the receipt.

_Review for quiz: `counts[item] += 1` on its own raises a `KeyError` the first time an item is ordered. Why, and what does the `else` add?_

## Output

An order the menu does not have prints `Not on the menu: hot chocolate`, with the order cleaned up the same way, and the program asks for the next order.

The receipt has one line per item, in the order each item was first ordered: the item, `x` and how many, and the cost with two digits after the decimal point, as in `latte x3: $13.50`. Then come the best seller with its count, `Best seller: latte (3)`, and the total, `Total: $19.25`. When two items tie for best seller, the one ordered first wins. When nothing was counted, the receipt is the one line `No orders.`

## Examples

```
Order: latte
Order: Coffee
Order:  LATTE
Order: hot chocolate
Not on the menu: hot chocolate
Order: bagel
Order: latte
Order:
latte x3: $13.50
coffee x1: $3.00
bagel x1: $2.75
Best seller: latte (3)
Total: $19.25
```

A tie for best seller goes to the item ordered first:

```
Order: tea
Order: muffin
Order: muffin
Order: tea
Order:
tea x2: $5.00
muffin x2: $6.50
Best seller: tea (2)
Total: $11.50
```

Orders that are all off the menu, or no orders at all, print `No orders.`:

```
Order: soup
Not on the menu: soup
Order:
No orders.
```

The grader also tries orders that are not in the handout, including a blank first order, an order of only spaces, and one of every item.

## How to Submit

Grade your program on this page, then press **Copy for submission**. That puts the autograder summary and your code on the clipboard as one paste, in the shape BrightSpace wants it: the summary inside a docstring, a blank line, then your code. Paste the whole thing into the **text submission** box.

```python
"""
dictionary-0.py — Autograder Summary
Score: 75 / 80

- Compiles without syntax errors: OK
- Counts with a dictionary: OK
- Input handling: 5 / 5
- Correct output: 40 / 40
- Functions: 5 / 10
- Starts a new key at 1: 10 / 10
- Loops with items(): 10 / 10
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
