---
type: Lesson
title: A lockfile's threshold ordering cannot substitute for an owner token
description: RecordStore assumed lockTimeoutMs < lockStaleMs prevented lock theft; the two clocks start at different events, so the invariant never held and a late contender stole a live holder's lock.
tags: [locking, concurrency, record-store, invariants]
timestamp: 2026-09-05
---

# A lockfile's threshold ordering cannot substitute for an owner token

`packages/record/lib/store.mjs` guarded its exclusive-create stream lock with
a constructor check requiring `lockTimeoutMs < lockStaleMs`, whose comment
claimed this "guarantees a contender errors out loudly before it could ever
steal a live holder's lock".

It guarantees nothing, because **the two thresholds are measured from
different events**:

- the waiter's timeout starts when the *contender arrives*;
- staleness was measured from the *lock's creation*.

A contender that arrives more than `lockStaleMs` after the lock was created
therefore finds it already stale on its first probe and steals it, without
ever consuming its own timeout. With timeout 100 ms and stale 500 ms, a
holder in a 1600 ms critical section and a contender arriving at 700 ms, both
ended up inside. The old holder then unlinked `.lock` unconditionally on its
way out, deleting the *new* holder's lock — so the damage compounded.

## What actually fixes it

Judge staleness against the **holder**, not the lock's age, and make release
ownership-checked:

- the lock carries an owner token (pid + hostname + random nonce), written to
  a temp file and hard-linked into place so the lock is never observable with
  partial content;
- a live pid on this host is never stealable at any age; a pid gone from this
  host is provably stale and reclaimed at once (crash recovery gets *faster*,
  not slower, than the age rule it replaces);
- age survives only as the fallback where liveness is unknowable — a lock
  created on another host (file sync copies one in) or one with no readable
  token (older version, hand-written);
- release unlinks only while the file still carries the releaser's nonce;
- a contender re-checks inode+mtime immediately before removing a lock it
  proved stale, which DETECTS a replacement that landed while the old lock
  was being proven stale. It is a detection, not an exclusion: a replacement
  landing between that recheck and the unlink is still removed. That window
  is a documented limit of the design, not something the recheck closes.

The threshold-ordering check was then removed rather than kept: it constrains
legitimate configurations while providing none of the safety its own error
message claimed. The residual liveness uncertainty is handled by making
uncertain cases wait rather than write; see [Pid-liveness locking should fail toward refusing to write](/decisions/pid-liveness-fails-toward-refusing-to-write.md).

## The generalisable shape

When a safety argument rests on comparing two durations, check what event
each one is measured from. Two clocks that start at different events cannot
be ordered by comparing their lengths. See also
[a guard no mutant can kill](/lessons/unreachable-guards-cannot-be-mutation-verified.md) — this guard was worse
than unreachable, it was reachable and wrong.
