### Fixed

- Capture streams transcript content, stores per-input cursors and journal IDs on
  disk, and indexes only new journal bytes in bounded transactions ([#1108](https://github.com/awebai/oats/issues/1108)).
  Background input logs share an append-only assumption: an edit to an old
  aweb-log line is no longer picked up merely because the log grows. Use
  `capture --reset-cursors [--source aw|cc|pi|codex]` to request reprocessing.
  Detected native-transcript prefix changes are set aside before appending, to
  preserve v0.53.0 downgrade/re-upgrade compatibility. Restore the prefix and
  use `capture --retry-set-aside`, or exclude the source through the existing
  ignore list (which also excludes its later turns). `capture --health` reports
  these inputs. This changes capture algorithms; it introduces no service
  schedule, record-size policy, or bounded-runner guarantee.
