## Fixed

- **`oats tui` no longer loses a terminal's exit status on tmux built
  with libutempter** ([#1277](https://github.com/awebai/oats/issues/1277)).
  With Ubuntu's or Debian's tmux, a viewer that exited as its pane closed
  could be left unreaped by tmux. The terminal then closed ten seconds
  later, with "ended without saying why" where its own line belonged: for
  example "could not be opened", with what the viewer printed under it.
  While a terminal waits for its status, `oats tui` now has tmux reap its
  children once a second (`run-shell true` on its private server), so the
  terminal closes within a second or two with its status.
