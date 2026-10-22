## Changed

- **TUI: each workspace keeps its tabs, layout and place across a switch.**
  - Opening another workspace still closes the open terminals' viewers (the
    agents keep running), but coming back opens them again: the tabs in their
    order and groups, the split, each group's shown tab, and where the focus
    was, zoom included.
  - A tab whose instance is gone or stopped is dropped; another machine's tab
    is asked first again.
  - The selection, the scroll and, new, the filter come back with their
    workspace. Before, the filter was dropped on every switch, and a filter
    still being typed in is kept as `Enter` keeps it.
  - The palette (Ctrl+X then `k`) keeps each workspace's own recency, its last
    50 instances, so working in another workspace leaves it as it was.
  - Nothing is kept after the TUI exits ([TUI](../tui.md)).
