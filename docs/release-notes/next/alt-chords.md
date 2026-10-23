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
  - macOS is unchanged.
  - In a focused terminal, these take Alt+O back from the program; #1433 had
    left it to the program.
- **Ctrl+Alt is still there, for programs that need Alt.** Choose it in the
  Desktop's Shortcuts page, or in `keys.json` (`"chords": "ctrl+alt"`), which
  both clients share. If you already chose Ctrl+Alt or Ctrl+Shift, you keep
  it; only those who never chose move to Alt.
  - In a terminal, a program still gets an Alt key the family takes when you
    press Esc, then the key.
  - The docs list each key the family takes from Claude Code, Codex, pi, the
    shell and the others, and how to reach it.
- **Each tab shows a small number**, the N that Alt+N goes to: 1–8, then 9 on
  the last tab of a strip with nine or more. In a split, each group numbers
  its own tabs. In the TUI, the numbers are the first thing dropped when the
  tab bar is too narrow for every name.
- **Ctrl+X then Shift+Tab** goes to the previous split group, as Ctrl+X then
  Tab goes to the next.
- On AltGr keyboard layouts, AltGr still types its characters and never fires
  an Alt chord.
  ([desktop-keyboard.md](../../packages/desktop/docs/desktop-keyboard.md),
  [TUI](../tui.md))
