## Added

- Desktop: the TUI's leader. Alt+O on Linux and Windows, ⌃\ on macOS, then
  one key from the TUI's own table: `k` or Space the command palette, `1` `2`
  `3` Instances, Souls and Capabilities, ↑/↓ the terminal of the roster row
  before or after, ←/→ the tabs, `z` focus mode, `w` close the tab, `|` `-`
  the splits, Tab and `x` the split's groups, `X` `R` `S` `D` Stop, Restart,
  Start and Retire, `n` `N` spawn, `/` the filter, `o` the workspace
  switcher, `?` the shortcuts and Esc the instance roster. It works from a
  terminal too: there the leader pressed twice sends the program what the
  chord sends (Alt+O is ESC o, ⌃\ is 0x1c). While it waits, a panel at the
  bottom of the main area lists the keys that apply now. `m` (move a tab to
  the other group) has nothing to act on in the Desktop and is left out. A
  test holds the Desktop's table to the TUI's, so the two cannot drift apart
  ([Desktop keyboard](../../packages/desktop/docs/desktop-keyboard.md#the-leader)).
- Desktop: the TUI's plain keys in the sidebar. With focus in the sidebar,
  `1` `2` `3`, `w`, `/`, `r`, `z`, `c`, `[` `]`, `|` `-`, `X` `D` `S` `R`,
  `n` `N` and `?` do what they do in the TUI, each rebindable in the
  shortcuts editor; on a roster row `k` `j` `g` `G` `h` `l` and
  PageUp/PageDown move through the tree
  ([Sidebar keys](../../packages/desktop/docs/desktop-keyboard.md#sidebar-keys)).
- Desktop: help leads with the leader. The shortcuts editor opens on a
  Leader group, the leader's chord and then one row per key after it, which
  its search finds (`alt+o k`), then the sidebar keys. The sidebar footer
  starts with the leader's chord and "commands", a button that starts it.

## Changed

- Desktop: none of the existing default shortcuts changes. A shortcut you set
  yourself that now shares its chord with the leader or a sidebar key is kept
  as it is, and the shortcuts editor shows the clash until you rebind or reset
  one side.
