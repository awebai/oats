---
type: Lesson
title: A mutation-killed test can still be measuring one layer below the defect
description: Both mutants of the oats use global fix were killed by assertions on serialized YAML, yet the reported defect was a resolution outcome; killing the mutant proves the pin is real, not that the test measures the behaviour.
tags: [testing, mutation-testing, review, oats-cli]
timestamp: 2026-09-05
---

The `oats use ... --soul` global fix is pinned by a test that reads
oats-config.yaml back and asserts `global: false` on one path and
`global: true` on the other. Mutating the single changed expression in both
directions (always true, the pre-fix behaviour; always false) made each
mutant fail the test, so the pin is real, and the always-false mutant is what
proves the test's second half genuinely exercises the pre-existing
untargeted branch.

But the defect as reported was "the capability is enabled for every soul", a
resolver outcome. The test never resolves for a soul other than the targeted
one, so it asserts the serialization that causes the defect rather than the
defect. Running the resolver by hand closes the gap in one line per soul, and
is worth doing during review even when the test is green.

Two different questions, and mutation testing answers only the first: does
the assertion move when the code moves (mutants answer this); is the
assertion on the same layer as the failure (only reading the bug report
against the assertion answers this). A write-side assertion is a legitimate
pin; it is just not evidence about the read side, and a review that stops at
"the mutants died" has not checked the claim the change makes.
