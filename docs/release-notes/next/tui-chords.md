## Added

- **`oats tui` takes the OATS Desktop's Ctrl+Shift chords, where your
  terminal lets them through** ([Chords](../tui.md#chords)): `Ctrl+Shift+K`
  the palette, `Ctrl+Shift+P` a spawn, `Ctrl+Tab` and `Ctrl+Shift+Tab` the
  next and previous tab, `Ctrl+Shift+W` close the terminal, `Ctrl+Shift+F`
  the filter, `Ctrl+Shift+E` and `Ctrl+Shift+O` the splits. Each does what
  the leader then a key does, from every focus, an agent's terminal too,
  and never reaches the agent. They are extras: the leader stays the key
  that always works, and the cheat sheet does not name them.
  - **Only where the terminal says it can.** At start the TUI asks for the
    kitty keyboard protocol (flags 1 and 4) and asks the terminal which flags
    it has. Only when the terminal answers does it take the chords and list
    them in the help, with the keys your terminal may take first (foot's
    Ctrl+Shift+C, V, R, N, O, U, Z, X and Q). Without an answer everything
    is as before. foot, Ghostty, kitty, Alacritty and WezTerm answer; VTE
    terminals and Terminal.app do not. On macOS only `Ctrl+Tab` and
    `Ctrl+Shift+Tab` are chords: the Desktop's hold ⌘, which a terminal
    never passes on.
  - **`Alt+O` and `Esc` then `o` are told apart exactly** under the
    protocol, with no timing.
  - **An agent gets the same bytes as before:** every key typed into its
    terminal is turned back into the bytes it sends without the protocol,
    and no tmux setting is changed. With a terminal that confirms flag 1
    but not flag 4, Shift with Alt or Ctrl on a key that is not a letter
    is typed as the US layout makes it.
  - **The protocol is popped on every way out** and at a suspend, beside the
    terminal modes the TUI already restores.
