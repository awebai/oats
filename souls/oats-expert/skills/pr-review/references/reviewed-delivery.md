# Immutable-target review and scoped freezes

Use this reference for moving-head reviews, handbacks and freeze reconciliation.

1. Identify the repository, PR, base ref, intended head ref and authorized actor. Observe the remote SHA; `git ls-remote` does not refresh a local tracking ref.
2. When fetching is authorized, fetch the intended ref, resolve the fetched commit and compare it with the observation. If they differ, report movement and repin before reviewing. Inspect explicit SHAs with `git show <sha>:<path>` and `git diff <base-sha>...<head-sha> -- <paths>`.
3. Do not assume an old commit is an ancestor after rewritten history. Check `git merge-base --is-ancestor <old-sha> <head-sha>` and report its result. Counts and grep absence do not prove behavior; distinguish negated documentation from a live API.
4. Honor the actual scope of HOLD. If unclear, stop mutation and clarify. Some holds prohibit local edits as well as pushes. Report already-pushed, unpushed and uncommitted state without undoing it merely to recreate an expected timeline. GO lifts only the scope it actually names.
5. A fix handoff names the fix SHA and new reviewed target, the full delta from the prior target, reproducible evidence, test results and unresolved work. Do not tell a reviewer to approve an unpinned moving tip.
6. Before an authorized merge, compare the PR API head, remote branch and check-run head. Ensure reviewer-driven changes have settled. Use `gh pr merge <number> --match-head-commit <reviewed-sha>` with the explicitly approved strategy, after verifying the installed command supports the guard. If head or relevant base changed, review/retest the resulting delta. A head guard alone does not prove base integration.
7. Observe the resulting remote state before reporting success. A failed client response may follow a completed mutation. Do not blindly retry or delete a branch to repair uncertainty.

Handoff template:

```text
Repository / PR:
Observed base / head SHA:
Prior reviewed SHA / ancestry result:
Full merge-range scope and fix delta:
Tests executed / unrun gates:
Findings and verification commands:
HOLD/GO scope / authorized next actor and action:
Verdict at SHA (not permission to merge):
```

Knowledge custody is external and provider-owned. No post-commit source-branch harvest or blanket instruction to delay capture belongs in this review procedure.
