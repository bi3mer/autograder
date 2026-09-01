# Week 2 - Problem 2: Hardcoded Username and Password

Write an authenticator for a username and a password where you take as input the user's username and password. The output will differ based on whether the user's username and password are valid or not. For this assignment, we have two valid accounts:

_Admin Account_

- username: admin
- password: bentley123!

_Normal Account_

- username: user
- password: !123Password

So, if the user enters either combination above, login was successful. If not, login failed.

Hard-coded means writing fixed values or data directly into your program instead of getting them from external sources or dynamic inputs. Given that definition, the following sentence should make sense: you should hardcode the usernames and passwords above as constants.

_(Consider what good variable names for these would be. I would also encourage you to form an opinion on whether you think hardcoding usernames and passwords is bad or good.)_

## Input

Prompt the user for two strings: username and password.

- `"Username: "`
- `"Password: "`

## Output and Processing

You need to figure out if the username and password entered was correct for either the admin account or the normal account. If so, output the username, then `" logged in."`, so `"admin logged in."` or `"user logged in."`

If login failed, you need to say why it failed. There are two ways to fail:

- The username matched an account but the password did not. Output `Invalid password for: ` followed by that username, so `"Invalid password for: user"` for the normal account and `"Invalid password for: admin"` for the admin account.
- The username matched neither account. Output `"No valid user found."`

## Examples

```
Username: user
Password: !123Password
user logged in.
```

```
Username: admin
Password: bentley123
Invalid password for: admin
```

```
Username: Admin
Password: bentley123!
No valid user found.
```

## How to Submit

Submit on BrightSpace as a **text submission**: copy and paste your code into the text box, with the autograder summary as a docstring at the top of your code.

```python
"""
w2-2.py — Autograder Summary
Score: 16.67 / 40

- Compiles without syntax errors: OK
- Input handling: 0 / 10
- Correct output: 6.67 / 20
- flake8: 10 / 10
"""

# ... your submission code here
```

A docstring has to be the first statement, so put it above your code, not below it.

**Failure to include the summary will result in -10 points.**

## Note

If you used `if` for the previous problem, I encourage you to use `match` for this problem. If you used `match` for the previous problem, I encourage you to use `if` for this problem. However, there is one problem with `match` that is worth knowing if you decide to use `match` for this practice assignment:

```python
CONSTANT_EXAMPLE = "hi"
match username:
    case CONSTANT_EXAMPLE: # SYNTAX ERROR
        print("matched")
    case _:
        print("did not match")
```

The code above will have a syntax error and force you instead to use the string literal `"hi"`.

```python
match username:
    case "hi":
        # etc.
```

Lastly, this program is meant to help you learn decision making in Python, but it is not meant to show you how a login would actually be implemented. First, hardcoding constants for username and passwords would mean that login would only ever work for those two accounts. If you wanted to change the password, add an account, etc., you would have to have a programmer modify the code itself. It would also be insecure because hackers could find the username and password in the code.

The other part that is insecure about this is that the output tells you if the username is correct but that password is not. In practice, this would be a terrible thing to do because it would allow hackers to validate usernames prior to finding valid passwords for the validated usernames.
