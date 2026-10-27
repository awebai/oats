## Changed

- **Desktop: the sidebar's instance rows have no ⋯ button.** Their actions
  (Open in split, Open pull request…, Knowledge & capabilities…, Start…,
  Restart with…, Stop…, Retire instance…, and Forget… for an instance its
  server no longer lists) are in the row's context menu (right-click,
  Shift+F10 or the ContextMenu key), as a workspace row's are. A right-click
  never opens the row's terminal. While the menu can't be used (the roster is
  out of date, one of its actions is still running, or the row can't be used
  from this computer), it opens nothing and says why in the line at the
  bottom of the main area
  ([desktop.md](../desktop.md#the-sidebars-instance-tree),
  [desktop-keyboard.md](../../packages/desktop/docs/desktop-keyboard.md)).

## Fixed

- **Desktop on Linux: a right-click on a workspace in the sidebar's list opens
  its menu (Open in new window) and keeps it open.** It used to close as soon
  as the mouse button came up. Shift+F10 and the ContextMenu key were not
  affected.

- **Desktop: Instance: name and colour… from the command palette keeps your
  place when there is no instance to act on.** It says "No instance is focused
  or selected." and the focus goes back where it was before the palette
  opened; it used to be lost.
