## Changed

- **Desktop and TUI: a list of workspaces at the top of the sidebar.** It
  replaces the workspace menu and is always shown: one line per workspace you
  can open, by name, whatever machines it is on. The current one is marked.
  A click, or Enter on a row, shows that workspace in the same window. The
  workspace's own pages show its machines and deployments.
  - Each workspace keeps its own tabs, layout, selection and recency, as
    before, so Ctrl+X then `k` (⌘K) still lists its instances, the most
    recently selected first.
  - In the Desktop, a workspace another window shows moves to this window,
    with its terminals and its split. Its file, brain and view tabs close in
    the other window. **Open in new window** is ⌘Enter / Ctrl+Enter on a row,
    or the row's context menu.
  - `w` in the sidebar, Ctrl+X then `o`, and the palette's
    **Workspace: switch…** focus the list.
- **A yellow dot on a workspace where an instance needs input**, after its
  name. Screen readers also get it as words, "needs input", and the TUI's help
  explains the dot. A workspace that hasn't been read recently shows no dot,
  never an old one.
- **Ctrl+X ↑ / ↓ move to the previous / next workspace of the list**, in both
  clients. They don't wrap. They used to open the previous / next instance.
  That move keeps its chords, Alt+Shift+↑ / ↓ (⌥⌘↑ / ⌥⌘↓ in the Desktop on
  macOS), and the roster's own arrow keys. On macOS the TUI has no chords, so
  there it's the roster's ↑ / ↓ then Enter.
- **Desktop: this computer's deployments that aren't opened yet are in
  Add local workspace…**, not in the list.
  - One click adds and opens one.
  - Deployments that can't be opened (missing, not a deployment any more,
    can't be checked) are listed after them, each with its **Remove**.
  - While the Desktop has no workspace at all (a first launch), a new window
    opens with this dialog.
- **TUI:** this machine's deployments that aren't opened yet stay in the
  switcher (`w` `w`).
  ([desktop.md](../desktop.md),
  [desktop-keyboard.md](../../packages/desktop/docs/desktop-keyboard.md),
  [TUI](../tui.md))
