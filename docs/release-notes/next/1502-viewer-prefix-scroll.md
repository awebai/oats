## Added

- **`C-b [` scrolls back in `oats session attach`, and the viewer says how**
  ([#1502](https://github.com/awebai/oats/issues/1502)). Not every keyboard
  has a PageUp.
  - **`C-b [`:** a viewer without `--detach-key` takes it to enter tmux's copy
    mode, as a tmux prefix does. It is the viewer's only `C-b` key. Any other
    key after `C-b` still reaches the agent as both keys (`C-b n`, `C-b c`,
    `C-b C-b`), with no timeout. It needs tmux 3.3 or later, whose
    `send-keys` can re-send the key after `C-b`. On an older tmux the viewer
    has no `C-b` key, and the line names `Shift+PgUp` alone.
  - **The status line:** the viewer shows one line under the agent,
    `Shift+PgUp or C-b [ to scroll back`. It takes the terminal's last row.
  - **`--no-status-line`** (feature `session-attach-no-status-line`) drops
    the line, for a caller that shows the keys itself.
  - **`sessionViewer.prefixScroll`** (feature `session-attach-prefix-scroll`)
    on `oats version --json` and `oats status --json`, relayed as each
    roster group's `probe.sessionViewer`: whether that host's viewer takes
    `C-b [`, read from its tmux afresh at each run. A caller that names the
    keys itself reads it per host.
  - **Copy mode is the agent pane's.** While one viewer scrolls back, every
    other viewer of that agent shows the same frozen screen.
  - **Each viewer reads key tables of its own**, named as its session and
    removed with it. Before, every viewer without a detach key shared one
    server-wide table, `oatsview-locked`.
  - **A tmux limitation:** a `C-b` pressed in the instant another viewer of
    the same tmux server opens is dropped. tmux resets every client's key
    table when any session sets `key-table`. The key after it reaches the
    agent alone.
  - See
    [Inspect, input and attach](../execution-targets.md#inspect-input-and-attach).
