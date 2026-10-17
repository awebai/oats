## Fixed

- SIGTERM or SIGINT now stops a capture pass cooperatively, where the worker was
  killed at once before. The supervised pass starts no further worker, asks the
  current worker to stop at its next unit boundary through the lock owner
  record, and kills and reaps the worker if it has not stopped after a 5-second
  grace, capped by the pass's deadline. The worker writes its own
  `failed`/`interrupted` receipt and keeps its committed counts and the previous
  `lastSuccess`. A killed worker leaves its `running` receipt, which the next
  pass records as interrupted. The worker also catches a signal sent to the
  caller's whole process group (Ctrl-C, `timeout`, a service manager), so it
  is not killed mid-unit. An interrupted run's failure message now reads
  "Capture execution was interrupted.", for a stop and for a later recovery
  alike. The lock is released and the command exits 1.
  `capture --home`, `--file` and `--reset-cursors` still run in the calling
  process. They now stop at their safe points (before and after taking the
  lock, before each format's batch, before the index update, and after the
  work before answering), answer their
  existing `failed` receipt with `capture interrupted by SIGTERM` and a
  confirmed `appended`, release the lock and exit 1. Discovery, a format's
  batch and the index update cannot be preempted, so a signal waits for the
  segment it arrived in. See
  [stopping capture](../../packages/record/docs/capture-service.md#stopping-capture-and-the-lock-owner-record).
- The capture lock's `owner.json` now says who took it: `command`, `caller`
  (`entry` and `trigger`) and `ppid`. These are fixed labels and process facts,
  never argv or environment. They are diagnostic only. Records from earlier
  releases are read and reclaimed exactly as before.
