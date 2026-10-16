## Changed

- `oats status` now reports `running` for the harness, not merely its tmux
  window. After Stop leaves a fallback shell, the row reads `running: false`
  with `runtimeState: "shell"`. A live harness remains running, and an
  unreadable session remains unknown. Pane reads are batched per socket and
  session. (#364)
