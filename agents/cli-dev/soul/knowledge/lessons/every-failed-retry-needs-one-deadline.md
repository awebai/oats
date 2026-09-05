---
type: Lesson
title: A retry loop's deadline must sit on the path every failure takes
description: Fixing the record-store lock introduced a bounded-retry regression because the deadline was checked on one branch while unreadable and dangling locks retried through continue paths forever.
tags: [locking, concurrency, retry-loops, review-findings]
timestamp: 2026-09-05
---

# A retry loop's deadline must sit on the path every failure takes

The ownership-token lock fix
([ownership-token-lock-beats-threshold-ordering](/lessons/ownership-token-lock-beats-threshold-ordering.md)) rewrote the acquire loop
as: try to create; if it exists, read it; if stale, remove it; else check the
deadline and sleep. Review caught that the deadline check sat on the **last
branch only**, while the other two reached the top of the loop through
`continue`. Two conditions therefore retried forever, hot:

- `readLock` caught *every* error as "the lock vanished", so a permission
  error or a directory in the lock's place read as vanished on every pass;
- a lock judged stale whose `unlink` kept failing was re-proven stale and
  re-attempted on every pass.

Neither is exotic, and both burn a core rather than failing.

## Two deterministic ways to reproduce a lock pathology in a test

Permission tricks are the obvious tool and they are bad ones — they need
`chmod`, they behave differently as root, and the same directory permission
governs both creating the temp file and removing the lock, so you cannot
isolate the unlink failure. Two file shapes are better:

- **A directory where the lock file belongs.** `link()` fails `EEXIST` (the
  name exists), `readFileSync` fails `EISDIR` on both macOS and Linux. This
  is the non-ENOENT read error, deterministically.
- **A dangling symlink where the lock file belongs.** `link()` still fails
  `EEXIST` because the *name* exists, but `stat` follows the link and reports
  `ENOENT` — so the lock reads as *genuinely vanished* on every single pass,
  forever. This is the one that catches a "retry at once, it just vanished"
  fast path, which no amount of error-handling care will catch.

## What the fix should be

Not more careful branches — **fewer**. Every iteration that fails to acquire
falls through to one deadline check and one sleep, with no `continue` above
them and no branch that retries for free. The tempting exception is retrying
immediately after a successful reclaim (it saves one sleep on the crash
recovery path); it buys ~25ms and reopens the hole, so it is not worth it.

## The honest gap

Mutation testing killed the mutants for both branches above, but a mutant
adding a free `continue` after a *successful* reclaim survives: making it
loop forever needs a second process recreating a dead-holder lock faster than
we reclaim it, which is not deterministically reproducible in-process.
Recorded as a comment in the loop rather than a test that does not exist —
see [unreachable-guards-cannot-be-mutation-verified](/lessons/unreachable-guards-cannot-be-mutation-verified.md) for why a fake test
would be worse than a named gap.
