## Changed

- A failed or unparseable Git version probe now refuses the remote read with
  `E_REMOTE_UNREADABLE` and an existing reason instead of falling back to a
  whole-tree fetch. Only a successfully parsed version below Git 2.45 triggers
  a version-driven rebuild of a partial cache. Existing full caches stay full.

## Fixed

- Git version probe failures preserve existing partial remote caches and all
  their commit pins. Failed probes are not cached, so later reads can retry;
  timeout and cancellation bounds are preserved for each caller sharing a
  probe, including reads without a session.
