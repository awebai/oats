## Added

- **`C-b [` scrolls back in `oats session attach`, and the viewer says how**
  ([#1502](https://github.com/awebai/oats/issues/1502)). Not every keyboard
  has a PageUp.
  - **`C-b [`:** a viewer without `--detach-key` takes it to enter tmux's copy
    mode, as a tmux prefix does. It is the viewer's only `C-b` key. Any other
    key after `C-b` still reaches the agent as both keys (`C-b n`, `C-b c`,
    `C-b C-b`), with no timeout.
  - **The status line:** the viewer shows one line under the agent,
    `Shift+PgUp or C-b [ to scroll back`. It takes the terminal's last row.
  - **`--no-status-line`** (feature `session-attach-no-status-line`) drops
    the line, for a caller that shows the keys itself.
  - **Copy mode is the agent pane's.** While one viewer scrolls back, every
    other viewer of that agent shows the same frozen screen.
  - See
    [Inspect, input and attach](../execution-targets.md#inspect-input-and-attach).
