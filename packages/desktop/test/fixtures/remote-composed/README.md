`oats server roster --json` answers with each group's `probe.features` (feature
`server-probe-features`, awebai/oats#795):

- `roster-captured.json`: a real answer from a kernel at 60748f2a (the #795 merge
  commit), redacted. It keeps every key, the kernel's key order, `probe` and `bounds`
  as answered. Identifying values (host, paths, workspace key, teams, souls) are
  replaced and the instance rows are dropped. The host ran an older kernel, so its
  probe reads `{ ok: true, features: null }`.
- `roster.json`: hand-written groups built on the captured group's shape. They differ
  only in identity and `probe`, because no host on a kernel with the feature was
  available to capture:
  - `g-composes`: a list naming `soul-composed-instructions`.
  - `g-other`: a list without it.
  - `g-none`: `[]`, a host that reported no features.
  - `g-older`: `null`, a host older than 0.49.0 or a list the kernel would not relay (unknown).
  - `g-failed`: a failed pull, `{ ok: false, error }` with no `features` key (unknown).
  `test/remote-composed-gating.test.mjs` pins every hand-written group to the captured
  key sets.
