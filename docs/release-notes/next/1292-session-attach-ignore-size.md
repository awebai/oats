## Added

- `oats session attach --ignore-size` attaches a viewer whose tmux client
  never constrains or resizes the agent's window (tmux 3.2+). Sizing without
  the flag is unchanged. The `session-attach-ignore-size` feature advertises
  support; `--server` forwards the flag only to a host advertising it and
  otherwise refuses with `E_REMOTE_INCOMPATIBLE`, including under `--print`.
  Reconnect guidance retains the flag. See
  [Inspect, input and attach](../execution-targets.md#inspect-input-and-attach).
