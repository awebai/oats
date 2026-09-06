---
type: Lesson
title: A non-execution test proves nothing without a positive control on the same fixture
description: The --help-never-executes test's "the executable did not run" assertions were vacuous while its marker fixture could not write its marker, and only the positive run at the end of the test distinguishes the two.
tags: [testing, fixtures, cli, review, vacuous-assertions]
timestamp: 2026-09-06
---

# What happened

Reviewing `help-never-executes`, the test asserts that `oats <ns> <cmd> --help`
never runs a capability executable. It does so with a marker: the fixture
executable writes a file, and the test asserts `existsSync(marker) === false`
after each `--help` invocation.

At the first tip (91b4376) the fixture was written as

    require("node:fs").writeFileSync(marker, "ran")

in a file named `ping.mjs`. `require` is not defined in an ES module, so the
executable threw on its first line and **could never write the marker whether or
not it ran**. Every negative assertion in the loop was vacuous.

That commit was RED, and only by luck: the test also ends with a positive run
(`oats ops ping` with no `--help`) asserting `existsSync(marker) === true`, and
that is the assertion that failed. The amended tip (6d2216e) changes one line to
`import { writeFileSync } from "node:fs"` and the file goes 11/11.

# The lesson

A test that proves a **negative** — "this side effect did not happen" — measures
nothing on its own. `existsSync(marker) === false` passes identically when the
guard works, when the fixture is broken, when the marker path is wrong, and when
the capability never dispatched at all. The assertion cannot fail for the right
reason unless something else in the same test proves the marker CAN be written.

So: **every non-execution assertion needs a positive control on the same fixture,
in the same test.** Here the control is the final unflagged run. Had the author
written only the `--help` loop, the suite would have been GREEN and the guard
completely unverified — the failure mode is silent, and it is the normal one,
because a broken fixture and a working guard are the same observation.

Watch for this shape wherever a test names an absence: no file written, no
process spawned, no lock created, no request sent. Ask what else in the test
would fail if the *measuring apparatus* were dead. If the answer is "nothing",
the test is decoration.

Related: [mutation-killed-but-measuring-the-wrong-layer](/lessons/mutation-killed-but-measuring-the-wrong-layer.md),
[unreachable-guards-cannot-be-mutation-verified](/lessons/unreachable-guards-cannot-be-mutation-verified.md),
[try-finally-promise-fixture-teardown](/lessons/try-finally-promise-fixture-teardown.md).
