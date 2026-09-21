---
type: Lesson
title: Reading an exit status after a pipe measures the last stage, not the command under test
description: Piping a command into head or grep to trim its output replaces its exit status with the filter's, which silently turns a failing command into an apparent success in the very check meant to catch it.
tags: [shell, verification, gotcha]
timestamp: 2026-09-20
---

Trimming noisy output with `| head` is habitual, and it quietly destroys the
thing being verified. In a POSIX shell `$?` after a pipeline is the status of the
**last** stage. `some-command | head -5; echo "EXIT=$?"` reports head's status,
which is almost always 0. A command that failed correctly, with a correct nonzero
status, is then recorded as having exited 0.

This is worse than an ordinary mistake because it manufactures a second, false
finding on top of the real one: the real failure is still visible in the text, so
it looks like the tool "printed an error but exited 0" — a contract violation that
was never there. Reporting that to the tool's authors wastes their time and costs
credibility on the findings that are real.

When the exit status is part of what you are checking, do not pipe. Redirect to
files and inspect them separately:

```sh
cmd > out.txt 2> err.txt; echo "EXIT=$?"
```

Check stdout and stderr separately too. A JSON-contract CLI that promises exactly
one object on stdout and prose on stderr can only be verified if they were never
merged with `2>&1`.

Related: [green checks do not lift scope holds](/lessons/green-tests-do-not-lift-a-scope-hold.md), [version bumps sweep test pins](/lessons/version-bump-grep-tests-before-push.md).
