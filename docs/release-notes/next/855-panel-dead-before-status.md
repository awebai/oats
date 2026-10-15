## Fixed

- **`oats tui`: an agent's terminal that ends says why again.** On tmux 3.2 to
  3.4, a terminal whose viewer ended at once, for example because the agent's
  window had just gone, could close with the line that the viewer "ended
  without saying why", and without the viewer's error output under it. The
  cause: tmux reports a pane as dead a moment before it has the exit status.
  The panel now waits for that status, for at most 10 seconds (2.5 seconds
  on tmux 3.2), so the line and the viewer's error output show again
  ([#855](https://github.com/awebai/oats/issues/855); see
  [`oats tui`](../tui.md)).
