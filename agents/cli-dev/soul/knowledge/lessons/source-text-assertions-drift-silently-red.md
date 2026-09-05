---
type: Lesson
title: A source-text assertion drifts into a permanent red without anyone noticing
description: packages/desktop/test/terminal-focus.test.mjs asserted a regex against shell.mjs's own source, the source was rewritten for neutral session targets, and the test sat failing on origin/main until an unrelated branch repaired it.
tags: [desktop, testing, source-assertions, renderer]
timestamp: 2026-09-05
---

Some Desktop renderer tests assert behaviour by regex-matching the renderer's
**source text** rather than by executing it —
`packages/desktop/test/terminal-focus.test.mjs` reads `renderer/shell.mjs` and
matches an expected expression. The style exists because the renderer is hard to
drive headlessly, and it does pin real invariants (here: that both user-facing
refusals go through `notify`, not the stuck-modal `alert`).

Its failure mode showed up in review of b99008b. `shell.mjs:775` had been rewritten
for neutral session targets —

    if (!inst.running || (!inst.server && !inst.tmux?.session && !inst.sessionTarget))
      return notify(inst.runtimeError || `"${name}" has no live terminal session`);

— while the assertion still expected the old tmux-only form, so it could not match
any source. That left `origin/main` red on this test, and it was repaired only when
an unrelated branch happened to touch the area.

What to take from it:

- **The assertion's guarantee and its regex age at different rates.** A behavioural
  test breaks when behaviour changes; a source-text test breaks when *phrasing*
  changes, which happens far more often and for reasons that have nothing to do with
  the invariant. Every refactor of the matched line is a false failure — and a
  failure everyone learns to expect is a failure nobody reads.
- **When repairing one, check the direction.** The fix here was legitimate because
  the new regex is strictly more specific than the one it replaced (it pins the
  `inst.server` / `inst.sessionTarget` disjunction and the `runtimeError` fallback,
  not just the message string). The tempting repair — loosen the regex until it
  matches — silently converts the test into a no-op while keeping it green.
- **Check whether the base was already red before crediting the commit under
  review.** `git show origin/main:<file>` on both the source and the test settled in
  two commands that this was a pre-existing main failure, not something the branch
  introduced.

Related: [/lessons/generous-stub-fail-closed-open-gate.md](/lessons/generous-stub-fail-closed-open-gate.md)
— a test that passes for the wrong reason is the same defect seen from the other side.
