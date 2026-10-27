## Changed

- **TUI: the workspace moves wrap around, as the Desktop's do.** The
  leader then `Down` (or `Alt+Down`, and its key in the other chord
  families) on the last workspace of the list of workspaces opens the
  first, and the leader then `Up` on the first opens the last, instead of
  saying "No workspace below this one." / "No workspace above this one."
  With only one workspace to open, nothing moves and one line says "No
  other workspace to show." The list's own `Up` and `Down`, while it has
  the focus, still stop at its ends
  ([tui.md](../tui.md#the-list-of-workspaces)).
