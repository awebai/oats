## Changed

- **`oats spawn --server <id> --preview --json` no longer carries
  `snapshot`.** The field named a saved-route file that a preview should never
  have written. The answer is now the server's preview plus `server` and
  `target`, the two fields a routed spawn adds
  ([servers.md](../servers.md#run-there)).

## Fixed

- **A routed spawn preview no longer saves a route.**
  `oats spawn <soul> --server <id> --preview` used to print
  `Spawned <instance> on <id> … — not launched` with a remote home, a route
  snapshot and an attach hint, and saved a route under
  `~/.oats/remote/<id>/`, though the server had only answered a preview and
  created nothing. That stale route then showed in `oats status --server` and
  `oats server roster`, made `oats retire --server` fail with
  `E_HOME_MISMATCH`, and, after `oats server add --replace`, made the next
  `oats spawn --server` fail with `E_ROUTE_CHANGED`. A routed preview now runs
  the spawn's own checks here, asks the server for its preview, and prints the
  local preview's line with the server named
  (`preview <soul> → <instance> on <id> …; nothing was created`). It writes
  nothing on this machine. A server that does not advertise
  `spawn-preview-2` is refused with `E_REMOTE_INCOMPATIBLE` before the spawn
  is sent. Drop a route an earlier preview saved with
  `oats server forget <id> --instance <instance>`.
