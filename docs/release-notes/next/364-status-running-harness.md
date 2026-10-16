## Changed

- **`oats status` reports whether the harness is running**
  ([#364](https://github.com/awebai/oats/issues/364)). After Stop leaves a
  fallback shell, the row reads `running: false` with `runtimeState: "shell"`,
  even though its tmux window remains. A live harness remains running, and an
  unreadable session remains unknown. Pane reads are batched per socket and
  session.
