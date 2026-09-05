---
type: Lesson
title: A retry hint fixed at one site leaves its siblings refusing
description: Deferred retirement writes its "run this to recover" advice at three sites; a review round that fixed the ambiguity in one left two emitting a command that now fails closed.
tags: [oats-cli, kernel, retire, diagnostics, review]
timestamp: 2026-09-05
---

`oats retire` gained an ambiguity refusal: a name that resolves to several
homes under one agents root is `E_AMBIGUOUS_INSTANCE` unless `--home` says
which. That single guard retroactively invalidated every stored string of
the form `oats retire <name>`, and deferred self-retirement stored three of
them, all reaching the operator through the same `oats status`
`retireFailures[].retry` field:

- the completion's failure record (`completeDeferredRetirement`, catch branch),
- the completion's incomplete-rollback record, one line below it, and
- the scheduler's async `child.on("error")` record.

Review round 2 found the first, and the fix landed exactly there. The other
two were byte-identical strings written by adjacent code, and both had the
home in scope. Nothing failed: behaviour was correct, tests were green, and
the advice was wrong only in the one scenario the feature exists for.

The generalisation: when a new refusal narrows what a command accepts, the
review question is not "did the caller pass the new argument" but "grep
every stored string that invokes this command, and check each against the
new guard". A remedy that is data (written to a file, read back later by a
different process) outlives the code path that wrote it, so it cannot be
validated by the test that covers the refusal.

Related: [guard-the-projection-not-just-the-action](guard-the-projection-not-just-the-action.md).
