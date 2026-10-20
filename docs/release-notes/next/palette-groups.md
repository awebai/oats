## Added

- **Jump to the next or previous group in the palette,** in `oats tui` and
  OATS Desktop ([The palette](../tui.md#the-palette);
  [desktop-keyboard.md](../../packages/desktop/docs/desktop-keyboard.md)).
  While the palette is open, `Alt+Shift+Down` moves the selection to the
  first row of the next group, and `Alt+Shift+Up` to the previous one's;
  both wrap. On macOS the Desktop's keys are `⌘N` and `⌥⌘N` (`⌘⇧N` stays
  File → New Window).
  - **The keys are the palette's while it is open.** There `⌘N` doesn't
    choose a soul, and the Alt+Shift arrows don't open the next or previous
    instance. With the palette closed, they do what they did before.
  - **`oats tui`'s palette now groups its instances** as the sidebar and the
    Desktop's palette do: by relation, with the group last used first. A dim
    label names each group, and the selection skips it. The souls,
    capabilities, views, acts and commands after them are a group each.
  - Both palettes name the keys: the Desktop's in a line under the list,
    `oats tui`'s in its cheat sheet. On macOS `oats tui` has no group key:
    a terminal never passes ⌘.
