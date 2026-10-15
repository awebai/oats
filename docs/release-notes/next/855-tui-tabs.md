## Added

- **`oats tui` opens up to four terminals at a time, as tabs**
  ([#855](https://github.com/awebai/oats/issues/855)). The panel's top row
  is the tab strip: each tab's agent in the order it was opened, the shown
  one in reverse while it has the focus and bold otherwise, and `•` (`*` in
  ASCII) after a hidden tab whose agent wrote since it was last shown. With
  one tab the row reads as before. `[` and `]` in the Instances view, or
  the leader then `Left`/`Right` from any focus, show the tab before or
  after, without wrapping; showing a tab selects its row in the list and
  leaves the focus where it was. Opening an instance that has a tab shows
  that tab. The palette opens with the second recent instance selected
  when the first is the shown tab's, as the Desktop's does. `tui.json` has
  two new actions, `tab-previous` (default `[`) and `tab-next` (`]`). See
  [the TUI page](../tui.md#tabs).

## Changed

- **Opening another agent's terminal in `oats tui` no longer closes the
  one that was open.** It opens in a new tab after the shown one. With four
  tabs open nothing closes by itself: the line says
  `4 terminals are open; close one with C-\ w.` Closing a tab (`c`, or the
  leader then `w`) shows the tab to its right, else the one to its left;
  closing the last one gives the right side back to the detail. A tab whose
  viewer ends by itself closes, hidden or shown, with its line; a hidden
  one's end leaves the shown tab and the focus as they were. Opening
  another workspace closes every tab, and the agents keep running.
