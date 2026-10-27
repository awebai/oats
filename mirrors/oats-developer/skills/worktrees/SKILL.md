---
name: worktrees
description: When and how to use extra worktrees (workflow paths that touch the same files, a spike, another branch or base), consolidate them before review and clean them up before handing back. Use when your execution strategy needs more than one checkout.
---

# Extra worktrees

Your work-mode briefing gives the command. Create as many as the work needs, on new or
existing branches; by default they live in your home as `.work-<purpose>`.

## When
- Workflow paths that touch the same files: one worktree per path. Paths on different
  files share one.
- A spike you may throw away, kept apart from the real branch.
- Another branch: a fix on another base, a stacked change, an open PR you're asked to
  rework.

## Use
Base each worktree on the branch it will merge back into; each path builds and tests in
its own.

## Consolidate before review
Before you launch the reviewer, bring everything into one worktree, the one whose branch
becomes the PR:
1. Merge each path in, in the planned order, resolving conflicts yourself.
2. Run the full verification there.
3. Launch the reviewer on it; the other worktrees are no longer part of the work.

## Before handing back
- Every other worktree is merged, or its branch is pushed and named in your handback, or
  it was deliberately abandoned.
- Remove every extra worktree you created that no instance is attached to.
- Retire the instances attached to a worktree before you remove it. One with an instance
  attached (usually the reviewer) stays until that instance is retired after your expert
  accepts (Close of `/run-the-review-loop`). In the end the worktree list shows only your
  main tree.
