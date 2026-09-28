---
name: adversarial-review
description: The reviewer's method. Find the real bugs in a change by trying to break it, prove each finding, rank by impact, and keep noise out. Use when reviewing a diff as the code-reviewer, including each re-review round.
---

# Adversarial review

You are trying to **break the change**, not to grade it. A good review finds the few things
that would hurt in production and proves them. A bad one lists thirty opinions.

## 1. Understand what it's for
Read the goal and the spec first, then the whole diff, then the code around it that the
diff calls or is called by. Don't judge a line before you know what the change must do.

## 2. Attack it
Go through these deliberately, for every changed path:
- **The spec:** does it do what "done when" says? Every edge case the spec lists?
- **Inputs:** empty, huge, malformed, unicode, negative, duplicate, missing, of the wrong
  type. Values from files, env, network, users.
- **Failure paths:** what happens when each call it makes fails? Is the error surfaced,
  retried, or swallowed? Is state left half-written?
- **State and concurrency:** ordering, retries, re-entrancy, two processes at once,
  check-then-use races, caches that go stale.
- **Contracts:** did an output shape, error code, file format or flag change? Who reads
  it, and do they still work?
- **Resources:** leaks (files, processes, listeners), unbounded growth, timeouts.
- **Tests:** do they prove the behaviour, or just run the code? Would they fail if the
  bug you're thinking of existed?

Then run the `/security-review` pass and the `/simplification-review` pass.

## 3. Prove it before you report it
- For each suspected bug, **show the failing path**: the input, the steps, the wrong result.
- If you can confirm it cheaply, **do**: run the relevant test, or write a small throwaway
  check outside the tree. Run tests **only** to confirm or refute a finding; you are not
  the CI.
- If you can't show how it breaks, it's a **question**, not a bug. Ask it as one.

## 4. Report: signal only
One report per round. Verdict first:
- `CHANGES NEEDED`: at least one **blocker** or **major**.
- `APPROVE WITH NITS`: only minors or simplifications.
- `APPROVE`: nothing worth the author's time.

Then the findings, most severe first, each as:
```
[blocker|major|minor] file:line: what breaks, for which input or state (one sentence)
  proof: <the path, or the test you ran and its output>
  fix:   <the concrete change>
```
- **blocker:** wrong results, data loss, a security hole, a broken contract, a crash on a
  plausible path.
- **major:** a real bug on a less common path; a missing test for a "done when".
- **minor:** a real but low-impact issue.
- Simplifications go in their own short section (see `/simplification-review`).

**Keep out:** style the formatter or linter owns; personal taste; "consider adding
comments"; restating the diff; praise; speculative findings with no path. **At most 3
minors per round.** If you have more, pick the three that matter.

## 5. Re-review rounds
- Check each fix actually fixes the finding, and didn't break something next to it.
- Re-read disputed findings against the author's reason. Withdraw if they're right; say
  why if they aren't.
- Review the delta, not the whole change again, unless the fix changed the design.
- Don't raise new minors on code that didn't change.
