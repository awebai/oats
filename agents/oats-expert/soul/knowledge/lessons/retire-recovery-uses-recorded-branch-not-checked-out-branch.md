---
type: Lesson
title: Retirement recovery clones the branch recorded in instance.json, not the branch the worktree actually has checked out
description: `oats retire` fails closed with "recovered Git index/status disagreed with the source" when an instance's worktree was switched to a different branch than its `instance.json` records — the recovery clone checks out the stale recorded branch, so the status comparison against the real worktree cannot agree. Nothing is lost, but the home cannot be removed by the normal path until the kernel derives the branch from the worktree.
tags: [lessons, retire, work-preservation, instance-json, worktree, kernel-defect]
timestamp: 2026-09-21
---

# What happened

A developer instance in worktree mode had, during its task, ended up on a
different branch (`docs/<topic>`) than the one recorded at spawn in
`instance.json` (`feat/<original>`). Both branches existed and were pushed;
the worktree was clean; every deliverable was merged upstream. The instance
followed the rules — it flagged the drift in its retirement note and did not
perform metadata or branch surgery itself.

`oats retire <instance> --self` (and the spawner's plain retry) failed closed:

    E_WORK_PRESERVATION_FAILED: recovery could not be verified:
    recovered Git index/status disagreed with the source

# Why

`preserveRetirementWork` (`lib/core.mjs`) builds the recovery clone with
`git clone --branch <meta.branch> <meta.repo>` where `meta.branch` comes from
`instance.json`. It then copies the real worktree's files over the clone and
compares `git status --porcelain` of both. With HEAD on the *recorded* branch
but files from the *checked-out* branch, the clone's status shows every
differing path as modified while the real worktree is clean — the
comparison can never agree. The final `recoveredHead === sourceHead` guard
would also compare against the recorded branch's tip.

The failure is fail-closed and correct in spirit (never delete a home whose
recovery cannot be verified); the defect is that the source of truth for the
branch is metadata rather than the worktree itself (`git -C <work>
symbolic-ref --short HEAD`, or `git worktree list --porcelain`).

# What to do

- **Do not** switch the peer's branch, edit its `instance.json`, or force-clean
  the home to make retirement pass. That is exactly the "unverified force
  cleanup" the instance warned against, and it destroys the evidence.
- Verify by hand that nothing is unpreserved (all branches pushed, worktree
  clean, nested scratch clones' dirt already merged upstream) and record that
  on the board; leave the instance `RETIRING` until the kernel fix ships.
- Kernel fix (0.25, lifecycle lane): derive the branch for recovery from the
  worktree when it exists and record the drift as a typed observation;
  fall back to `instance.json` only when the worktree is gone. Regression:
  spawn worktree instance, `git switch -c` inside its work, retire → succeeds
  and the recovery clone is on the switched branch.
- Root cause to close separately: a worktree-mode instance should not be able
  to drift branches silently — either `oats` records the switch or the mode
  block forbids it. Propose as a Decision, not a patch.
