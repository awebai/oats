---
type: Lesson
title: Never signal a PID you did not verify — a failed spawn reports pid 0, and pid 0 is you
description: process.kill(-child.pid) after a failed spawnSync targets the caller's own process group; guard every kill with a positive safe-integer PID check in one shared helper.
tags: [security, process, kernel, review]
---

# Never signal a PID you did not verify

## What happened

Bounded-custody code killed a detached child's process group on timeout or
failure: `process.kill(-child.pid, "SIGKILL")`. When the child **failed to
spawn** (binary not on PATH → `ENOENT`), `spawnSync` returned `pid: 0`. On
POSIX, `kill(0, sig)` signals **the caller's own process group**, and
`kill(-0)` is the same call. `oats readiness --verify-signatures` on a machine
without `git` would have SIGKILLed the operator's shell, tmux session or the
Desktop backend that ran it. The consumer found it by extracting the exact
helper into an inert VM with a recording `process.kill`; the maintainer's
reproduction then killed the maintainer's own probe shell — proof enough.

## The rule

- **Every** signal goes through one helper that refuses unless
  `Number.isSafeInteger(pid) && pid > 0`, and returns whether it signalled.
  Three copies of the kill line had drifted into two files within a day.
- A failed spawn is the *common* case for the code path that kills
  (timeouts and failures are why the kill exists) — test the `ENOENT` shape,
  not only the happy timeout.
- Prove the negative end to end: run the verifier in a child with an empty
  `PATH` and assert the child exited normally (`signal === null`).

## See also

- `read-only-git-observation-is-a-security-boundary.md` — same family: code
  that runs on behalf of an observation must not be able to hurt the observer.
