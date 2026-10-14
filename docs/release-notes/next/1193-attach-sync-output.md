## Fixed

- **`oats session attach` asks tmux for synchronized output
  ([#1193](https://github.com/awebai/oats/issues/1193)).** Every `oats session
  attach` client, the Desktop's remote terminals and the TUI included, now
  starts its tmux client with the `sync` terminal feature when the host's
  tmux is 3.2 or later. tmux then wraps each redraw in DEC mode 2026, so a
  terminal that supports the mode no longer paints a half-drawn redraw (in
  the Desktop, the cursor flickering while you type in a remote instance's
  input box). A terminal without the mode ignores it. The feature is the
  viewer's client's alone: the agent's session, other clients and the tmux
  server's options are unchanged. With tmux before 3.2, or a `tmux -V` the
  kernel cannot read, the client starts as before.
  [Inspect, input and attach](../execution-targets.md#inspect-input-and-attach).
