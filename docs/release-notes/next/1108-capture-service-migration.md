## Changed

- Setup converts supported legacy capture watchers to the finite service entry
  and periodic definitions. It preflights all named service files, applicable
  manager state and proposed hook edits before any setup mutation. Foreign,
  disabled/masked and unknown state refuse safely; explicit replacement never
  overrides read failures, failed backups or changed identities. Replacement
  saves reported nonoverwriting backups under the selected record root.
- Add setup `--root` and `--replace-service`, preserving owner/root and stable
  Node quoting in installed arguments and recovery. `--no-service` skips service
  inspection/actions; `--dry-run` writes nothing, calls no manager and discloses
  unexamined state. Healthy unchanged schedules preserve active work. Successful
  activation reports periodic scheduling, never a permanent PID. Manager failure
  can leave partial apply and reports recovery without claiming atomic rollback.
  Real-manager lifecycle, health/doctor and full service qualification remain
  separate from isolated fixture coverage.

## Upgrade

- Service A follows 0.56.0–0.58.0, which shipped without it. Install the service
  release's compatible Desktop, CLI and pi bridge in that order, then run its
  setup conversion from the operator's shell per deployment. Retain the printed
  backups. For a foreign/disabled refusal choose the printed same-owner/root
  `--replace-service` command or `--no-service` to preserve the operator's service;
  repair unknown state before retrying. A CLI upgrade alone does not convert
  persisted manager definitions or hooks. Do not use these flags/diagnostics as
  pre-upgrade prerequisites on 0.56–0.58. See
  [capture service release order](../upgrading.md#capture-service-release-order).
