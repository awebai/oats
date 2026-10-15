## Upgrade

- **`oats tui`: the back key is now the leader, pressed twice to go back to
  the list.** `Ctrl+\` (`open.detachKey` in `tui.json`) pressed once in a
  terminal waits for a command key; pressed again it gives the focus to the
  list, as one press did up to 0.58.0. A `tui.json` whose `open.detachKey` is a
  key an action has is now refused: give one of the two another key. See
  Added and Changed ([#855](https://github.com/awebai/oats/issues/855)).

## Added

- **`oats tui` has a leader key, so every action is reached by keys from
  every focus** ([#855](https://github.com/awebai/oats/issues/855)). The
  leader is `Ctrl+\` (`open.detachKey` in `tui.json`), then one plain key:
  `k` or `Space` the palette, `1` to `3` the views, `Up`/`Down` the
  previous or next instance's terminal, `z` zoom, `w` close the terminal,
  `X`/`R`/`S`/`D` the acts, `/` filter, `o` workspaces, `?` help, and `Esc`
  or the leader again the list. In a terminal the leader is still the one
  key taken from the agent, now twice to go back to the list. A key that
  comes in the same read as the leader cancels it, so a paste never runs a
  command. See [the TUI page](../tui.md#the-leader).
- **A palette, as the Desktop's ⌘K:** the leader then `k`, or `Ctrl+K` in
  the list, opens one input over the instances that can be opened (the
  most recently opened in the run first), the views, the selected
  instance's acts, and workspaces, refresh and help, filtered as you type
  with the Desktop's match. From a terminal, choosing an instance swaps
  the panel to it. See [the TUI page](../tui.md#the-palette).

## Changed

- **The header starts with the workspace's name**, with no `oats` title,
  and the Souls and Capabilities views are no longer dim: `2` and `3`, or
  the leader then `2`/`3`, show what each will hold and what to run until
  then.
- **The footer is one row of keys from the first column**, with no rule
  above it, and names `C-\ commands` first in every focus. The `1-3 views`
  hint is gone: the header names the views.
- **A quieter list:** a row is its state mark and its name, the harness
  and the state in words moved to the detail, a folded row says `+n`, a
  machine's heading is its name, with the time of its read only when it
  differs from the header's, and with a terminal open the list keeps 30
  columns. A saved route to an instance its machine no longer has reads
  `gone from <machine>`, as the Desktop says it, not `unknown`.
- **`tui.json` is refused when `open.detachKey` is a key an action has**,
  since the leader is read as a key in the list too: `C-l` is `Ctrl+L`,
  `C-k` is `Ctrl+K`, `C-j` is `Enter`. Give the action another key, or the
  leader another key.
