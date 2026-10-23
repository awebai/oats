## Changed

- **Desktop and TUI on Linux and Windows: the shortcuts are Alt chords by
  default.**
  - Alt+K is the palette, Alt+P Quick Open (a spawn, in the TUI), Alt+O the
    list of workspaces, Alt+Z focus mode, Alt+W close the tab, Alt+E /
    Alt+Shift+E split, and Alt+F the filter.
  - Alt+← / → move between tabs, and Alt+Shift+← / → between split groups.
  - Alt+↑ / ↓ move between workspaces.
  - Alt+1–9 go to a tab.
  - Alt+Shift+↑ / ↓ still open the previous / next instance.
  - In a focused terminal, the family takes these keys from the program,
    among them Alt+F (readline's forward-word) and Alt+O, which #1433 had
    left to the program.
- **macOS: ⌥ with an arrow moves.** ⌥← / → go between tabs, ⌥⇧← / → between
  split groups, and ⌥↑ / ↓ between workspaces. ⌥⌘↑ / ↓ still open the
  previous / next instance, and the letters and digits stay on ⌘. ⌥⌘A no
  longer goes to the next group.
  - A text field keeps its ⌥ arrows for moving the cursor; a focused
    terminal does not. To give them back to the shell, rebind them in the
    Desktop's shortcuts editor.
  - The TUI takes them only where the terminal sends ⌥ arrows as such
    (iTerm2, kitty, WezTerm, Alacritty). Terminal.app, Ghostty and VS Code
    send ⌥← / → as word moves unless set otherwise; the docs give each
    setting. The leader moves everywhere.
  - The TUI on macOS shows no tab numbers, since no key there reaches a tab
    by number. The Desktop does (⌥⌘1–9).
- **Ctrl+Alt is still there, for programs that need Alt.** Choose it in the
  Desktop's Shortcuts page, or in `keys.json` (`"chords": "ctrl+alt"`), which
  both clients share. If you already chose Ctrl+Alt or Ctrl+Shift, you keep
  it; only those who never chose move to Alt.
  - Ctrl+Alt and Ctrl+Shift leave Alt+↑ / ↓ to the program. Ctrl+X then ↑ / ↓
    moves between workspaces in every family.
  - In the Alt family, Esc then the key reaches the program where the program
    reads Esc as Meta (readline, zsh, Emacs, irssi). Otherwise choose
    Ctrl+Alt.
  - The docs list each key the family takes from Claude Code, Codex, pi, the
    shell and the others, and how to reach it.
- **Each tab shows a small number**, the N that Alt+N goes to: 1–8, then 9 on
  the last tab of a strip with nine or more. In a split, each group numbers
  its own tabs. The Desktop's tab tooltip names the key. In the TUI, the
  numbers are the first thing dropped when the tab bar is too narrow for
  every name.
- **Ctrl+X then Shift+Tab** goes to the previous split group, as Ctrl+X then
  Tab goes to the next.
- On AltGr keyboard layouts, AltGr still types its characters and never fires
  an Alt chord.
  ([desktop-keyboard.md](../../packages/desktop/docs/desktop-keyboard.md),
  [TUI](../tui.md))
