## Fixed

- **Desktop: a spawn on another machine keeps the name you give it.** Spawning
  onto a server (Where to run, or a soul listed from a server) named the
  instance `<soul>-<what you typed>`, while the same name typed for this
  computer became exactly `<what you typed>-<role>`. Now a spawn on a server is
  named the same way as a local one when that machine's OATS can take an exact
  name (feature `spawn-name`, OATS 0.26.0 and later, as its last roster answer
  reports it): no `<soul>-` prefix in the field, the final name on the line
  under it, and a name that machine refuses as taken or invalid is explained
  there too. With an older OATS on either side, or a machine this computer has
  not heard from, what you type is still a purpose, with its prefix shown
  ([desktop.md](../desktop.md)).
- **Routed spawns check `--name` against the host.** `oats spawn --server <id>
  --name <name>` is refused with `E_REMOTE_INCOMPATIBLE`, before anything is
  sent, when the host does not advertise `spawn-name`, and with
  `E_ROUTE_EXISTS` when a saved route here already holds that name
  ([servers.md](../servers.md#run-there)).
