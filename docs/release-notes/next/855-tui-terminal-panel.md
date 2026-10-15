## Changed

- **`oats tui` opens an agent's terminal in a panel beside the list**
  ([#855](https://github.com/awebai/oats/issues/855)). `Enter` on an
  instance that runs shows its terminal where the detail was, with the list
  still on screen and the focus in the terminal: everything you type goes to
  the agent but the leader (`Ctrl+\`, or `open.detachKey` in `tui.json`),
  which pressed twice gives the focus to the list while the terminal stays
  open and live.
  From the list, `Enter` on its row goes back to it, `z` gives it the whole
  body and `c` closes it; `Enter` on another instance opens that one
  instead. A terminal whose viewer ends closes with a line that says why,
  and is never opened again by itself. **The whole-screen open of the
  previous version is gone**: `z` replaces it. The viewer now runs in a tmux
  server private to the run (tmux 3.2 or later), ended on every way out, a
  `kill -9` of `oats tui` included; a later run removes what a killed one
  left. `open.detachKey` keeps its name
  and the keys it accepts, but for one an action has, and now means the
  leader; a key outside them is
  refused when `tui.json` is read, and an older OATS on another machine is
  opened like a newer one. See [the TUI page](../tui.md#open-an-agents-terminal).
- **The header's second row reads as navigation:** `Instances   Souls
  Capabilities`, the open view in reverse video. The keys `1`, `2` and `3`
  are in the help, not beside the names. Every frame is now one
  synchronized update (`CSI ?2026h` … `CSI ?2026l`).
