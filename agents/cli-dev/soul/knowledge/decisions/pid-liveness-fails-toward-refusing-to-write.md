---
type: Decision
title: Pid-liveness locking should fail toward refusing to write
description: Judging lock staleness by process liveness leaves a pid-reuse-after-reboot hole; the chosen resolution is to block and time out loudly rather than add an age ceiling that would restore the theft bug.
tags: [locking, concurrency, record-store, failure-modes]
timestamp: 2026-09-05
---

# Pid-liveness locking should fail toward refusing to write

Replacing age-based lock staleness with `process.kill(pid, 0)` liveness
(see [the owner-token lock lesson](/lessons/ownership-token-lock-beats-threshold-ordering.md)) leaves one hole: after
a reboot, a dead holder's pid may be reused by an unrelated live process, so
its abandoned lock reads as held forever.

The tempting patch — keep an age ceiling that reclaims *any* lock past
`lockStaleMs` regardless of liveness — is exactly the defect being fixed. It
would restore live-lock theft for every holder whose critical section runs
longer than the threshold.

**Decision:** accept the hole and fail toward refusing to write. Contenders on
such a stream time out, and the timeout message names the lock path and the
recorded holder (pid, host, acquisition time) so the operator can delete it.

The asymmetry that decides it: **refusing to write is recoverable; writing
concurrently with a live holder is not.** A timeout costs an operator one
`rm`; a stolen lock lets two writers run a read-truncate-write repair against
one journal, which is the data loss the lock exists to prevent.

Note the direction of the residual risk in the *other* liveness case too: pid
reuse while the machine is up makes a dead holder look alive, which also only
causes waiting. Every uncertainty in this design resolves toward waiting.
