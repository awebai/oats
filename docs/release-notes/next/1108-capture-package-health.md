## Changed

- Package capture health now distinguishes no installation, unknown evidence,
  missing/invalid status, stale or absent success, newer failures, unfinished
  execution and owned legacy watcher definitions. It shares setup's parsed
  service/hook recognition, keeps historical receipts separate from current
  database issues, and reads no source content or manager state. Reader failures
  remain nonzero; valid warning diagnoses exit zero without repair or mutation.
  The shared status schema and nullable old receipt history are unchanged.
- Installation reads have finite candidate/byte guards and a cooperative deadline;
  the existing isolated SQLite reader keeps its timeout and fail-closed runtime,
  busy, WAL and schema behavior. Kernel doctor uses a separate command boundary;
  real manager lifecycle and full service/storage qualification remain gates. Definition files
  or an `ok` receipt diagnosis do not certify enabled scheduling.

## Upgrade

- In the service A release after 0.56–0.58, use `turn-record capture --health`
  against the intended root after authorized setup conversion. Preserve existing
  owner/root selection in suggested recovery. A missing success can reflect sleep
  or off-host execution; progress and cleared issues alone do not certify success.
  Do not interpret older health implementations as this service qualification.
