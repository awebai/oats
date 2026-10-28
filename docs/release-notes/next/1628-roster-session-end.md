## Fixed

- **`oats server roster` printed a lost session as `idle`**
  ([#1628](https://github.com/awebai/oats/issues/1628)). Its rows did not
  relay the host's `sessionEnd`, so the roster could not tell a session lost
  to a reboot or a dead tmux server from one stopped on purpose. A roster row
  of `server roster --json` now carries `sessionEnd` when the host's row has
  it, with the host's value: `lost`, `stopped` or `exited`. A host whose
  kernel reports no `sessionEnd` gives rows as before. The roster line prints
  a lost row as `LOST`, with one line under it naming the way back on that
  host, as `oats status --server <id>` does
  ([`sessionEnd` on a roster row](../desktop-cli-api.md#the-remote-roster-oats-server-roster---json)).
