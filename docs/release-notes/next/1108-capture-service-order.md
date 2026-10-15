## Upgrade

- The bounded periodic capture service follows the already released 0.56.0,
  0.57.0 and 0.58.0; none of those versions ships it. Until a release explicitly
  includes the service, follow the installed version's Upgrade section. For
  the service release, install its compatible Desktop before its CLI, update
  the pi bridge, then run that CLI's setup conversion in each deployment from
  the operator's shell. Owned legacy watchers convert there; foreign or
  disabled definitions need an explicit choice. Use the new diagnostics after
  conversion, never as pre-upgrade checks on old binaries. See
  [capture service release order](../upgrading.md#capture-service-release-order).

## Changed

- The capture reference separates the private service foundation from an
  installed periodic service and documents retained recovery cleanup in
  source-stage fixtures. A cleanup failure remains a current-pass failure
  with confirmed work preserved; a later successful pass retains the earlier
  failure as history. This foundation does not switch the command or manager
  to the periodic service.
