## Added

- **A Ctrl+Shift option for the shared chords, in `oats tui` and OATS
  Desktop at once,** on Linux and Windows
  ([Switch to Ctrl+Shift](../tui.md#switch-to-ctrlshift);
  [desktop-keyboard.md](../../packages/desktop/docs/desktop-keyboard.md)).
  It is for a terminal that lets Ctrl+Shift letters through to `oats tui`:
  foot and Alacritty
  ([Which family for my terminal](../tui.md#which-family-for-my-terminal)).
  Ctrl+Alt stays the default.
  - **Seven chords move:** `Ctrl+Shift+K` the palette, `Ctrl+Shift+P` a
    spawn (the Desktop's Quick Open), `Ctrl+Shift+S` the switcher,
    `Ctrl+Shift+M` zoom, `Ctrl+Shift+W` close the tab, `Ctrl+Shift+E` split
    right and `Ctrl+Shift+D` split down.
  - **The others keep their keys:** `Ctrl+Alt+A` the other group,
    `Ctrl+Alt+F` the filter, the Alt+Shift arrows and `Ctrl+Alt+1` to
    `Ctrl+Alt+9`.
  - **To switch,** choose **Ctrl+Shift (foot, Alacritty)** under
    **Shortcuts anywhere** on the Desktop's Shortcuts page, or write
    `{ "chords": "ctrl+shift" }` to `~/.oats/config/keys.json`
    (`$OATS_HOME_DIR/config/keys.json` when that is set). The Desktop
    switches at once; `oats tui` reads the file at its next start. A
    missing or broken file means Ctrl+Alt, and the help says why.
  - **The help names the family in force:** `?` in `oats tui`, the
    Shortcuts page in the Desktop.
  - **Your own keys still win, row by row:** `tui.json`'s `keys`, and the
    Desktop's shortcuts editor, which shows a clash with a key the option
    takes.
  - **In `oats tui` it needs the kitty keyboard protocol;** the leader
    works without it. With the option on, the seven are taken from an
    agent's terminal too: pi's `Ctrl+Shift+P` (previous model) spawns
    instead.
  - macOS has no option.
