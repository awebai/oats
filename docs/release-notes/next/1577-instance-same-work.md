## Added

- **An instance can record that it does the same work as its parent**
  (feature `instance-same-work`,
  [#1577](https://github.com/awebai/oats/issues/1577)). Clients draw the
  parent→child line for an instance that carries the flag.
  `oats spawn … --same-work` sets it on the new instance, bound to the
  parent the new home records (a child, a sibling of an anchor with a
  parent, a `--relation parent` over an anchor with a parent, an attached
  spawn); a spawn that would record no parent is refused with `E_BAD_ARGS`
  before anything is created. `oats instance same-work <instance> on|off`
  sets or clears it on an existing instance, addressed as
  `oats instance color` addresses one; `on` needs a recorded parent, and
  the answer is `{instance, sameWork}`. The flag is kept in the home's own
  record, `.oats-same-work.json`, naming the parent it was set against: it
  survives a restart, a stop and a start, a resume and
  `oats instance upgrade`, and only `off` or retirement clears it. It is on
  only while that parent is still the home's recorded `parentInstance`, so
  after a reparent (a retire's lineage splice, a `--relation parent` spawn
  re-pointing its anchor) it reads off until `on` rebinds it.
  `oats status --json` rows and `oats server roster --json` rows carry
  `sameWork: true` while it is on, and no `sameWork` key otherwise. Both the
  flag and the verb are routed with `--server`; a host without the feature
  is refused with `E_REMOTE_INCOMPATIBLE` and nothing is sent
  ([Same work as the parent](../desktop-cli-api.md#same-work-as-the-parent-oats-instance-same-work)).

## Changed

- **`.oats-same-work` is a kernel-owned home name**: a capability's
  `retirement.disposable.home` cannot declare it
  ([capabilities.md](../capabilities.md)).
