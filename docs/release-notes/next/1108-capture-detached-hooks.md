## Changed

- Forthcoming service-A capture hooks use explicit `--hook` to launch the fixed
  detached supervisor without inherited harness pipes. Exit zero acknowledges
  **capture launched**, not initialization or completion; launch/usage errors
  exit one, never Claude's Stop-blocking exit two. Ordinary quiet calls retain
  manual attribution.
- Setup refreshes recognized owned Stop/SessionEnd commands and persisted fields
  from `async:true` to `async:false` and `timeout:120` to `timeout:10`, including
  entries whose command already matches. The harness waits for the short launch
  result before shutdown while capture remains detached; no latency measurement
  is implied. Foreign hooks/groups and unrelated fields remain intact. The
  install hint uses the same fields and retains sessions-only/append-only flags.
  This does not complete periodic manager/setup first-pass/health-doctor migration
  or hosted qualification, and does not describe behavior shipped in 0.56–0.58.
