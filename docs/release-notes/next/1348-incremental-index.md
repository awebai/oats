## Fixed

- The index update after `capture --home` or `--file` now skips streams it can
  prove current. A stream is skipped when its validation checkpoint names the
  journal's current version and its search cursor agrees with that checkpoint.
  A skipped stream takes no stream lock, no validation and no `capture.db`
  connection of its own. The pass opens `capture.db` once instead of twice per
  stream, so an unchanged record no longer costs two lock cycles and two
  database opens for every stream. Work now follows the streams that changed
  and their new bytes. Backlog from `--no-index` passes, streams changed by
  other writers, and missing or inconsistent evidence are still validated
  under the stream lock, and a stale union still resets and is rebuilt. See
  [the index update](../../packages/record/docs/capture-service.md).
