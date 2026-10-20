## Added

- **An instance has a colour** (feature `instance-color`, awebai/oats#1421).
  `oats instance color <instance> (<colour> | --clear)` sets or clears it,
  from the palette `sand`, `sage`, `slate`, `mauve`, `clay`, `olive`; it is
  addressed as `oats instance stop` addresses an instance, and routed with
  `--server`. The colour is presentation only: anyone may change it, and it
  is never an address. It is kept in the home's own record,
  `.oats-color.json`, which a start or restart never rewrites and a retire
  does not count as a change to the home. `oats status --json` rows,
  `oats server roster --json` rows and `oats inspect --home` carry `color`
  ([An instance's colour](../desktop-cli-api.md#an-instances-colour-oats-instance-color)).
- **The TUI draws an instance's mark in its colour**, its shape still saying
  its state ([tui.md](../tui.md#what-it-shows)).

## Changed

- **`.oats-color` is a kernel-owned home name**: a capability's
  `retirement.disposable.home` cannot declare it
  ([capabilities.md](../capabilities.md)).
