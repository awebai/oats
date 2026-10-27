## Added

- **TUI: the cheat sheet names a terminal's scroll keys**
  ([#1502](https://github.com/awebai/oats/issues/1502)). While a terminal
  has the focus, the cheat sheet and, where it has room, a zoomed
  terminal's title row name the viewer's own keys: `Shift+PageUp or
  Ctrl+B [`, then `scroll back` (`Ctrl+B [` alone where the row holds one
  key). In the Alt family a zoomed terminal 120 columns wide or less has no
  room for them: its chords keep the row.
  - The keys are the ones the tab's host's kernel says its viewer takes:
    `Shift+PageUp` where it lists `session-attach-prefix-scroll`, and
    `Ctrl+B [` too where its `sessionViewer.prefixScroll` is true. That is
    this machine's `oats version --json` for a local tab, and the roster
    probe of its server for a remote one. A host without the feature gets
    no scroll keys named. `Ctrl+B [` is never named when the leader is
    `Ctrl+B` (`open.detachKey: "C-b"`), which takes that key first.
  - Each tab's viewer runs without its own status line where the kernel
    has `--no-status-line`: the cheat sheet says it instead.
  - See [the TUI's tabs](../tui.md#tabs).
