---
type: Lesson
title: A batch existence check turns a preservation assumption into a measurement
description: Replacing per-row object copying with one cat-file --batch-check against the destination is stronger, not weaker, because it measures what the clone actually holds instead of assuming it.
tags: [git, retirement, work-preservation, kernel]
timestamp: 2026-09-05
---

`restoreStandaloneGitState` (lib/core.mjs) used to run `cat-file blob` +
`hash-object -w` for **every** `git ls-files --stage` row, on the reasoning
that copying everything cannot lose anything. On a real 9,569-row index that
was ~19,000 Git launches over 2.2 GiB and read as a hang.

The replacement asks the recovered clone once, with
`cat-file --batch-check=%(objectname) %(objecttype)` over the deduplicated
staged ids, and copies only the ids reported missing.

**Why this is not a weakening.** The old loop's safety came from an
*assumption* about what a clone contains. The batch check does not assume: it
measures the destination directly, so it is correct no matter how the clone
was made (`--no-local`, partial, alternates-bearing). The guarantee is then
pinned by re-running the same check over the **whole** staged set — not just
the copied subset — before the index is installed, and throwing if anything is
still missing. Measure, repair, re-measure, then commit the index.

# Schema

`cat-file --batch-check` with a custom format still prints the fixed
`<input> missing` line for unresolvable ids (verified on git 2.50.1), and
exits 0. So `line.endsWith(" missing")` is a reliable discriminator: no object
type is spelled `missing`, and the trailing empty split element cannot match.

# Citations

1. `git cat-file` docs: a name that cannot be resolved makes cat-file ignore
   the custom format and print `<object> missing`.
