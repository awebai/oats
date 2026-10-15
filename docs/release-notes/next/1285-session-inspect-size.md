## Added

- `oats session inspect --json` reports the agent window's `size: { cols, rows }`
  in cells when present, including through `--server`. The dimensions come
  from the same tmux call as the pane identity and are omitted for absent or
  dead terminals. `oats version --json` advertises `session-inspect-size`, so
  viewers can discover support before opening a PTY at that size (#1285).
