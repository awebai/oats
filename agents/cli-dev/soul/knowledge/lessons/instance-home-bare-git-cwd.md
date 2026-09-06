---
type: Lesson
title: Instance homes sit inside the operator checkout, so bare git can hit the wrong tree
description: OATS review turns alternate between instance home for aw/oats and work/ for git; a bare git command from the home walks up into the main checkout instead of the attached worktree.
tags: [review, git, worktree, instance-boundary]
timestamp: 2026-09-05
---

# What happened

A review briefing gave branch-update commands as bare `git fetch` and `git merge
--ff-only`. They are correct only when the shell is in `work/`. The review turn
had last run from the instance home, because `aw` and `oats` operational commands
must run there.

The instance home (`<repo>/agents/<agent>/instances/<instance>/`) is gitignored,
but it is still inside the main checkout. Bare `git` walked up to that checkout
and fast-forwarded the operator's live `main` to the branch under review. Nothing
was overwritten because the checkout was clean and the move was a pure
fast-forward, but it moved a shared branch other agents use.

# Why it is easy to miss

Being gitignored can make an instance home feel outside the repository. It is
not. The attached worktree is reached only by being inside `work/` or by naming
it explicitly.

# The rule

Never run bare `git` from an instance home during review or development. Address
the intended tree in the command:

```bash
git -C "$OATS_INSTANCE_HOME/work" fetch origin
git -C "$OATS_INSTANCE_HOME/work" merge --ff-only origin/<branch>
```

`-C` is immune to whichever cwd the previous turn used, and it documents the
claim about which tree the command may mutate. Do not rely on `cd` in one
parallel tool call to affect a `git` command in another; their relative order is
not guaranteed.

# If it happens

Report it before further work. Give the exact restore command and the SHA the
checkout had at session start, because the sandbox may block running the repair
locally. `git status --porcelain` before and after is what makes "nothing was
overwritten" a checked fact. This is the git analogue of
[the npm cwd trap](/lessons/npm-prefix-in-worktree-instances.md).
