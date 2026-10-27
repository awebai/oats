## Added

- **`Shift+PageUp` scrolls back in `oats session attach`**
  ([#1476](https://github.com/awebai/oats/issues/1476)). Every viewer binds
  it to tmux's copy mode, a page up, with or without `--detach-key`. Under an
  agent that takes the mouse, as Claude Code does, the wheel goes to the agent,
  and a viewer had no way to scroll back. In copy mode `PageUp` and `PageDown`
  move and `q` leaves it. See
  [Inspect, input and attach](../execution-targets.md#inspect-input-and-attach).
