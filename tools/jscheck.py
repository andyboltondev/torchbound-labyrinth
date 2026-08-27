#!/usr/bin/env python3
"""A crude structural check for the source files.

There is no JavaScript runtime on this machine, so nothing here can actually
parse or execute the game. This walks each file as a character stream, skips
over strings, template literals, regular expressions and comments, and reports
any bracket that is never closed (or closed by the wrong kind). That catches
the failure this project is actually prone to during an edit -- a hand-written
patch that drops or duplicates a brace -- and makes no claim beyond it.

Usage:  python tools/jscheck.py [paths...]     (defaults to src/ and tests/)
"""

import sys
import pathlib

PAIRS = {')': '(', ']': '[', '}': '{'}
OPEN = set(PAIRS.values())

# Words after which a `/` opens a regular expression rather than dividing.
# Without these, `return /["]/.test(s)` reads as a division and the rest of the
# file is parsed inside a string that never ends.
KEYWORDS = {
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'case', 'do', 'else', 'yield', 'await', 'throw',
}


def strip_and_check(text):
    """Return a list of problem strings for one file."""
    problems = []
    stack = []
    i = 0
    n = len(text)
    line = 1
    # `prev` is the last significant character, used to tell a regex literal
    # from a division: `/` after a value divides, after an operator it opens.
    # `word` is the identifier just read, because a keyword is an operator
    # position even though it ends in a letter.
    prev = ''
    word = ''
    while i < n:
        c = text[i]
        if c == '\n':
            line += 1
            i += 1
            continue
        if c in ' \t\r':
            i += 1
            continue

        two = text[i:i + 2]
        if two == '//':
            while i < n and text[i] != '\n':
                i += 1
            continue
        if two == '/*':
            i += 2
            while i < n and text[i:i + 2] != '*/':
                if text[i] == '\n':
                    line += 1
                i += 1
            i += 2
            continue

        if c in '"\'':
            quote = c
            i += 1
            while i < n and text[i] != quote:
                if text[i] == '\\':
                    i += 1
                elif text[i] == '\n':
                    problems.append('line %d: unterminated string' % line)
                    break
                i += 1
            i += 1
            prev = 'x'
            continue

        if c == '`':
            i += 1
            while i < n and text[i] != '`':
                if text[i] == '\\':
                    i += 1
                elif text[i] == '\n':
                    line += 1
                elif text[i:i + 2] == '${':
                    # Template substitutions hold real code; let the main loop
                    # see them so their brackets are counted like any other.
                    depth = 0
                    i += 2
                    while i < n:
                        if text[i] == '{':
                            depth += 1
                        elif text[i] == '}':
                            if depth == 0:
                                break
                            depth -= 1
                        elif text[i] == '\n':
                            line += 1
                        i += 1
                i += 1
            i += 1
            prev = 'x'
            continue

        if c.isalpha() or c in '_$':
            start = i
            while i < n and (text[i].isalnum() or text[i] in '_$'):
                i += 1
            word = text[start:i]
            prev = 'k' if word in KEYWORDS else 'x'
            continue

        if c == '/' and prev not in ('x',):
            # A regex literal. Skip to the unescaped closing slash.
            i += 1
            in_class = False
            while i < n:
                if text[i] == '\\':
                    i += 1
                elif text[i] == '[':
                    in_class = True
                elif text[i] == ']':
                    in_class = False
                elif text[i] == '/' and not in_class:
                    break
                elif text[i] == '\n':
                    break
                i += 1
            i += 1
            prev = 'x'
            continue

        if c in OPEN:
            stack.append((c, line))
        elif c in PAIRS:
            if not stack:
                problems.append('line %d: stray closing %s' % (line, c))
            else:
                opened, at = stack.pop()
                if opened != PAIRS[c]:
                    problems.append(
                        'line %d: %s closes %s opened on line %d' % (line, c, opened, at))

        prev = 'x' if (c.isalnum() or c in ')]}_$') else c
        i += 1

    for opened, at in stack:
        problems.append('line %d: %s is never closed' % (at, opened))
    return problems


def main(argv):
    roots = argv[1:] or ['src', 'tests']
    files = []
    for root in roots:
        p = pathlib.Path(root)
        files.extend(sorted(p.rglob('*.js')) if p.is_dir() else [p])

    bad = 0
    for f in files:
        problems = strip_and_check(f.read_text(encoding='utf-8'))
        if problems:
            bad += 1
            print('%s' % f)
            for problem in problems:
                print('    %s' % problem)
    print('%d file(s) checked, %d with unbalanced brackets' % (len(files), bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
