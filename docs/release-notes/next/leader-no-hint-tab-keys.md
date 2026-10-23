## Changed

- **Desktop and TUI: pressing the leader (Ctrl+X) shows nothing.** The panel
  of keys at the bottom of the Desktop's main area, and the TUI's leader hint
  in place of its cheat sheet, are gone. The leader still waits for its key
  exactly as before. Its table is in the Desktop's shortcuts editor (`?` after
  the leader, or ⌘, / Ctrl+,) and in the TUI's help (`?`). In the Desktop, a
  screen reader still hears that a key is awaited, and a key that cannot act
  still says why in one quiet line
  ([desktop-keyboard.md](../../packages/desktop/docs/desktop-keyboard.md),
  [TUI](../tui.md)).

## Fixed

- **Desktop: the tab and instance keys no longer skip a press.**
  - In a split, the tab keys (Ctrl+Tab, Alt+Shift+←/→, ⌥←/→, the leader's
    ←/→ and ⌥⌘1–9 / Ctrl+Alt+1–9) went through every tab in the order they
    were opened, across both groups. They now stay in the focused group, in
    the order its strip shows.
  - Moving to the previous or next instance (the leader's ↑/↓,
    Alt+Shift+↑/↓, ⌥⌘↑/↓) could re-open the instance already being opened
    when pressed again before its terminal arrived. Each press now moves one
    instance on.
