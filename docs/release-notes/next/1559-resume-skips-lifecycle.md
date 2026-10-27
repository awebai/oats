## Fixed

- **The sweep could bring back a home that was being retired**
  ([#1559](https://github.com/awebai/oats/issues/1559)). A retire ended its
  instance's session without recording the stop, so for a moment the home read
  as lost, and a sweep that ran then (OATS Desktop or `oats tui` opening, or
  `oats session resume`) started it again in the home that the retire then
  removed. Now a home OATS is stopping, upgrading or retiring, or whose retire
  did not finish, is never resumed:
  - `oats session start --resume` holds the home's lifecycle claim for the whole
    start, as a retire, a stop and an upgrade do. Beside a retire it answers
    `E_INSTANCE_RETIRING`; beside a stop, an upgrade or another resume it
    answers `E_LIFECYCLE_BUSY`. A retire, stop or upgrade that meets a resume
    answers `E_LIFECYCLE_BUSY`, and the claim names `action: "resume"`.
  - The sweep reports such a home `skipped`, with the new reason
    `lifecycle-busy`, and starts nothing. What OATS was doing decides what the
    home is next, and a later sweep reads it again.
  - A retire records the stop before it ends the window. A home it was retiring
    reads `stopped`, never `lost`, also when the retire fails afterwards.

  The new reason and the new `action` value are additive. A client that does
  not know them treats the row as skipped and the claim as busy. See
  [Resume after a shutdown](../execution-targets.md#resume-after-a-shutdown).
