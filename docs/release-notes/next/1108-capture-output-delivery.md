## Fixed

- Capture CLI reporting now finishes naturally so piped stdout and stderr can
  drain before exit. This preserves complete health samples, truncation banners,
  JSON receipts and error messages instead of forcing exit with queued writes.
  Usage, recovery, hook launch, explicit-file, status and ordinary error paths
  use the same returning dispatch with their existing exit codes. Health remains
  read-only and cannot fall through to capture; hook acknowledgement still means
  launched, not completed. No receipt, diagnosis or sample limit changes.

  Upgrade: update the CLI before relying on complete piped health output. This
  output correction does not establish installed-manager lifecycle, storage,
  synchronization, current-main integration or full service qualification.
