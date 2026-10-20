## Added

- **One chord for each everyday action, the same in `oats tui` and OATS
  Desktop, from every focus, an agent's terminal too, with no leader first**
  ([Chords](../tui.md#chords);
  [desktop-keyboard.md](../../packages/desktop/docs/desktop-keyboard.md)).
  On Linux and Windows:
  - `Ctrl+Alt+O` opens the switcher.
  - `Alt+Shift+Up` and `Alt+Shift+Down` open the terminal of the previous
    or next instance.
  - `Ctrl+Alt+1` to `Ctrl+Alt+8` show the first to eighth tab, and
    `Ctrl+Alt+9` the last one.
  - `Ctrl+Alt+Z` zooms the shown terminal.
  - `Ctrl+Alt+A` goes to the other split group.

  The Desktop's macOS chords are `⌘⌥O`, `⌘⌥↑`, `⌘⌥↓`, `⌘⌥1` to `⌘⌥9`, `⌘⌥Z`
  and `⌘⌥A`. Help, the views, and stop, restart, start and retire stay on
  the leader, which still works everywhere.
  - **In `oats tui` the Ctrl+Alt chords need the kitty keyboard protocol,**
    as the 0.66 chords did. The Alt+Shift arrows work in every terminal on
    Linux and Windows, GNOME Terminal included. On macOS `oats tui` has no
    chords: the leader does it all there.
  - **While the terminal confirms the protocol, the help and the cheat sheet
    lead with the chords,** each with its leader key beside it. The leader
    keeps its own section.
  - **A character typed with AltGr stays a character.** On Windows `AltGr`
    is `Ctrl+Alt`: where it types a character (Spanish `€`, `@` and `#`,
    Polish `ą`, `ę`, `ó` and `ż`), that key types it in both clients, and
    the leader does what the chord would.
  - **Windows Terminal takes `Ctrl+Alt+1` to `Ctrl+Alt+9`** for its own tabs,
    and the Alt+Shift arrows while its panes are split.
    [The matrix](../tui.md#which-terminals-let-the-chords-through) lists
    what each terminal takes.

## Changed

- **The shared chords move from Ctrl+Shift to Ctrl+Alt on Linux and
  Windows,** in both clients. kitty, Ghostty, WezTerm, Konsole and Windows
  Terminal take most Ctrl+Shift chords for themselves, so in `oats tui`
  most of 0.66's chords never arrived. Old → new:

  | Action | Was | Now |
  |---|---|---|
  | the palette | `Ctrl+Shift+K` | `Ctrl+Alt+K` |
  | Quick Open in the Desktop, a spawn in `oats tui` | `Ctrl+Shift+P` | `Ctrl+Alt+P` |
  | close the tab | `Ctrl+Shift+W` | `Ctrl+Alt+W` |
  | the filter | `Ctrl+Shift+F` | `Ctrl+Alt+F` |
  | split right | `Ctrl+Shift+E` | `Ctrl+Alt+E` |
  | split down | `Ctrl+Shift+O` | `Ctrl+Alt+Shift+E` |
  | next and previous tab in `oats tui` | `Ctrl+Tab`, `Ctrl+Shift+Tab` | `Alt+Shift+Right`, `Alt+Shift+Left` |
  | the Desktop's second next and previous tab chords | `Ctrl+PgDn`, `Ctrl+PgUp` (outside a terminal) | `Alt+Shift+Right`, `Alt+Shift+Left` (everywhere) |
  | the Desktop's go to tab 1–9 | `Alt+1` to `Alt+9` (outside a terminal) | `Ctrl+Alt+1` to `Ctrl+Alt+9` (everywhere) |

  - The Desktop keeps `Ctrl+Tab` and `Ctrl+Shift+Tab`, and its other
    Ctrl+Shift chords (sidebar, instance panel, spawn, theme picker, copy).
  - On macOS the Desktop gains `⌘⌥→` and `⌘⌥←` for the next and previous
    tab, beside `⌃Tab`.
  - A binding you set yourself in the Desktop's shortcuts editor is kept.
    When it is a chord a default now takes, the editor shows the clash.
