---
name: worktrees
description: When and how to use extra worktrees for a piece of work: workflow paths that touch the same files, a spike, another branch or base. Consolidate them into one worktree before review, and clean them up before handing back. Use when your execution strategy needs more than one checkout.
---

# Extra worktrees

Your work-mode briefing gives the command. Create as many worktrees as the work needs, on
new or existing branches; by default they live in your home as `.work-<purpose>`. What you
create, you clean up. This skill is about using them well.

## When
- **Workflow paths that touch the same files:** one worktree per path, so agents don't
  overwrite each other.
- **A spike** you may throw away, kept apart from the real branch.
- **Another branch** the work needs: a fix on another base, a stacked change, an open PR
  you've been asked to rework.

Paths that touch different files share one worktree (`/execution-strategy`).

## Use
- Base each worktree on the branch it will merge back into.
- Each path builds and tests inside its own worktree.

## Consolidate before review
**Before you launch the reviewer, bring everything into ONE worktree**, the one whose
branch becomes the PR:
1. Merge each path in, in the planned order, resolving conflicts yourself.
2. Run the full verification on the consolidated result.
3. Launch the reviewer on that worktree. It reviews the whole piece of work in one place;
   the other worktrees are no longer part of it.

## Before handing back
- Every other worktree is merged, or its branch is pushed and named in your handback, or it
  was deliberately abandoned.
- Then remove them all; the worktree list shows only your main tree.
