## Changed

- **Desktop on Linux and Windows: the palette is Ctrl+Shift+K, and Quick Open
  is Ctrl+Shift+P and works from a focused terminal**
  ([#1217](https://github.com/awebai/oats/issues/1217)). Quick Open was
  Ctrl+P, which a focused terminal keeps for the program in it (shell
  history), so it did not open from there. **Ctrl+Shift+P changes meaning:**
  it has opened the palette since 0.30.3 and now opens Quick Open; the
  palette moves to Ctrl+Shift+K. While the palette is open, Ctrl+Shift+K
  moves down its rows and ArrowUp moves up. xterm sends nothing for either
  chord, so plain Ctrl+K and Ctrl+P still reach the program. A shortcut you
  set yourself is kept; when it is one of these two chords, the shortcuts
  editor shows the clash. macOS is unchanged (⌘K, ⌘P). See
  [Desktop keyboard](../../packages/desktop/docs/desktop-keyboard.md).
