---
type: Lesson
title: To prove a diagnostic carries no signal, diff its output against a deliberately invalid input
description: A failure report that is byte-identical for a correct input and an obviously wrong one tells the operator nothing, and feeding it a known-bad value is the cheap way to demonstrate that rather than assert it.
tags: [verification, diagnostics, acceptance-testing, error-reporting]
timestamp: 2026-09-20
---

When a tool reports a failure that names no offending field, it is tempting to
report "the error message is unhelpful". That is a subjective complaint and is
easy for the author to discount, because the author knows what the message means.

Turn it into a measurement. Supply the input in a form you believe is **correct**,
capture the whole output. Then supply a form that is **unambiguously wrong** — a
nonexistent repository, a nonexistent path, a malformed identifier — and capture
the output again. If the two are byte-identical, you have shown that the consumer
of that report cannot distinguish "my input was accepted and something else is
missing" from "my input was garbage". That is a fact about the interface, not an
opinion about its prose, and it survives the author's familiarity with the code.

State the alternative readings you cannot separate from outside. Identical output
can mean the validator never examined the input at all — for example because an
earlier unrelated failure short-circuited the phase that would have read it. That
distinction matters to whoever fixes it, and claiming the wrong one converts a
solid finding into something they can refute.

Resist the obvious follow-up of removing the interfering requirement to isolate
the phase. On an acceptance route, stripping a declared requirement no longer
tests the route anyone will actually take, and a result obtained that way proves
nothing about the real path.

Related: [green checks do not lift scope holds](/lessons/green-tests-do-not-lift-a-scope-hold.md).
