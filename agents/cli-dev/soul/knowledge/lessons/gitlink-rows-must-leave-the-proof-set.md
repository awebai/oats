---
type: Lesson
title: Gitlink index rows must be excluded from a superproject object-presence proof
description: A mode 160000 row names a commit that legitimately does not exist in the superproject's object store, so including gitlinks in a "nothing staged is missing" check makes the check fail on every submodule.
tags: [git, submodules, retirement, kernel]
timestamp: 2026-09-05
---

`git ls-files --stage` emits gitlink rows as mode `160000` whose object id is
the **nested repository's commit**, not a blob of the superproject. That
commit is normally absent from the superproject's object database entirely.

Two consequences, both live in `restoreStandaloneGitState`:

1. The old per-row loop ran `cat-file blob <id>` on such a row, which fails
   with *not a blob* — so retirement of any work tree containing a nested
   repository would have thrown. The bug was latent only because no fixture
   with a gitlink reached that loop.
2. A presence proof built over the staged set must skip mode `160000`, or it
   reports "still missing" for every submodule and no such retirement can ever
   verify. Gitlink content is restored on a different path
   (`materializeNestedRepositories`, which clones each nested root and recurses
   into `restoreStandaloneGitState` for it).

The general shape: **a proof set must contain only things the destination is
supposed to have.** An id that is correct to be absent belongs to a different
mechanism's contract, and folding it into the proof turns a real guarantee
into one that cannot hold.

See [batch existence check](/lessons/batch-existence-check-is-a-measurement.md).
