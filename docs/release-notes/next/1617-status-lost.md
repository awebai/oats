## Fixed

- **`oats status` printed a lost session as `idle`**
  ([#1617](https://github.com/awebai/oats/issues/1617)). The text views of
  `oats status` and `oats status --server <id>` printed every row that does
  not run as `idle`, so a session lost to a reboot or a dead tmux server read
  the same as one stopped on purpose. A row whose `sessionEnd` is `lost` now
  prints `LOST`, with one line under it naming the way back: `oats session
  start --resume --home <home>`, or the next `oats session resume` (run when
  OATS Desktop or `oats tui` opens) when it can vouch for the loss. A
  `--server` row names the host to run them on. A stopped, exited or
  never-launched row, and a row from a host whose kernel reports no
  `sessionEnd`, still print `idle`.
  The JSON is unchanged
  ([How a session's end is read](../execution-targets.md#how-a-sessions-end-is-read)).

## Documentation

- **Which losses come back** names one more limit: the 24-hour gap of clause
  4 does not reach across a reboot, so after a quiet spell of more than a day
  with no OATS read, the first sweep after a restart can bring back a session
  lost during it ([Which losses come back](../execution-targets.md#which-losses-come-back)).
