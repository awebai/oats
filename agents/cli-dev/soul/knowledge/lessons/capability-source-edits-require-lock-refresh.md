---
type: Lesson
title: Editing marketplace capability sources requires a version bump and lock refresh
description: Edits under capabilities/<pkg>/ change capabilityIntegrity, so clean-clone CI fails restore unless the package version and matching oats-lock.json source/version/integrity are refreshed in the same commit.
tags: [lock, integrity, capabilities, ci, marketplace]
timestamp: 2026-07-24
---

# Lesson

The spawn-lineage recipe migration edited `capabilities/oats-review/injects/review.md`
and `capabilities/oats-okf/bin/oats-okf.mjs` but did not update `oats-lock.json`.
Local worktrees with an installed store kept passing because they did not
re-verify the marketplace install, but clean-clone CI failed during `oats install`
restore with integrity mismatches for both packages.

# Rule

A commit touching `capabilities/<pkg>/**` must also:

1. Bump that package's `oats.json` version.
2. Refresh the package's `oats-lock.json` entry, including `source:
   marketplace:<id>@<version>`, `version`, and `integrity` from
   `capabilityIntegrity(dir)`.
3. Verify from a clean clone with `npm ci`, `oats install`, and `npm test`.

Precedent: commit `7269497` established that lock sources must stay
`marketplace:`, never `path:`, for CI portability.
