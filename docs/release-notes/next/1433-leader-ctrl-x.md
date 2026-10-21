## Upgrade

- **The leader moves to Ctrl+X** in OATS Desktop and in `oats tui`, on every
  platform (Changed, below). A Desktop rebind of the leader and an
  `open.detachKey` in `tui.json` are kept. To keep Alt+O or ⌃\, bind it
  again: `"open": {"detachKey": "M-o"}` (or `"C-\\"`) in `tui.json`, the
  shortcuts editor in the Desktop.

## Changed

- **The leader is Ctrl+X in both clients and on every platform**
  (awebai/oats#1433), as Emacs' prefix key: it was Alt+O on Linux and
  Windows and ⌃\ on macOS. The keys after it do not change. Without the
  kitty keyboard protocol Ctrl+X is one byte, 0x18, in every terminal, so it
  needs no protocol and no timing; under the protocol `oats tui` reads it
  too, and Ctrl+Shift+X and Ctrl+Alt+X are not the leader
  ([The leader](../tui.md#the-leader)).
  - **Ctrl+X twice sends Ctrl+X to the program,** as the leader twice
    always has. The shell's Ctrl+X Ctrl+E is now Ctrl+X twice, then Ctrl+E,
    and nano exits with Ctrl+X twice.
  - **In the Desktop, Cut keeps Ctrl+X** in a text field (an input, a text
    area, an editable region) that is not a terminal, on Linux and Windows.
    On macOS Cut is ⌘X, so the leader works there too
    ([desktop-keyboard.md](../../packages/desktop/docs/desktop-keyboard.md#the-leader)).
  - **Alt+O and ⌃\ go back to the programs:** on Linux and Windows an agent
    gets Alt+O as Esc then `o` (on macOS Option+O types its character, `ø`
    on a US layout, unless the terminal sends Option as Meta), and ⌃\ as it
    is typed, unless you bind either as the leader again.
