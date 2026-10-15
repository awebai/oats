## Changed

- Add private capture worker dispatch joining predecessor reconciliation,
  source/index rotation, reset handoff and run accounting. Due retries wait for
  healthy source/index work and discovery; interrupted admissions retain their
  run identity. These foundations keep receipts pending until the remaining
  cleanup and all-stage completion gates are integrated, and do not yet enable
  installed periodic capture or change ordinary command entry points.
