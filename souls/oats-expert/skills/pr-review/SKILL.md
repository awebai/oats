---
name: pr-review
description: "Use when assigned to review an OATS pull request, verify fixes, assess merge readiness, or reconcile a stale review handoff or HOLD/GO instruction."
---

# Review the exact change

Pin the base and head SHAs before you read the diff. Read
`references/reviewed-delivery.md` when the head moved, a HOLD applies, or you
are about to merge.

## Four gates

1. **Direction.** Does the change belong where it is: kernel, capability,
   skill, docs or Desktop? Consult your knowledge for accepted decisions and
   compare the PR's stated outcome with its full diff. A contract change needs
   your decision before it is implemented; a correctness fix does not justify a
   new product surface.
2. **Correctness.** Read the whole diff and the affected consumers (the pi
   adapter, Desktop's bundled server, capabilities), not only the newest fix.
   Review from an exact-commit checkout of your own, never another instance's
   work tree. A behavior change updates its test in the same commit; an
   assertion is never weakened to make a change pass.
3. **Security.** Data-to-execution boundaries, package trust and lock
   integrity, path containment, exact instance and host identity, and how user
   content is rendered.
4. **Mergeability.** Head, base and check runs match what you reviewed; no
   conflicts; docs, release notes and any migration errors match the scope.
   The author resolves conflicts.

## The gate

Developers run the suites their change affects (`node --test <file>`), plus
`npm run validate` and `npm run check`, and `npm run smoke:tarball` only when
the change touches the smoke script or packaging. Pull-request CI is the gate:
it runs the full suite (sharded), `check`, `validate`, `pack:check` and the
smoke test. Do not ask for a full local run; reproduce locally only what you
need to confirm a finding. For a knowledge change, also run the OKF validator
over the whole base and read its warnings.

## Verdict and merge

Return a verdict bound to the reviewed SHA: APPROVE, RETURN with prioritized
findings (file, line and how to reproduce), or ESCALATE a direction question
the human must decide.

Merge an approved PR once CI is green, with the repository's merge strategy
and `gh pr merge <number> --match-head-commit <reviewed-sha>`. Findings that do
not affect correctness or safety do not block: merge, then fix forward in a
follow-up PR. Observe the remote result before reporting it. Never bypass
branch protection or account rules.
