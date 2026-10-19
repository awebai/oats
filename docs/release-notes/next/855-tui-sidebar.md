## Changed

- **`oats tui` is one sidebar and the main area, with no header and no
  footer.** An agent's open terminal now spans every row, and zoomed (`z`)
  it has the whole screen. The sidebar starts with the workspace's name and
  what the view holds of other machines. A deployment's state and reason,
  the note of a one-deployment view and the line after an open stand under
  it. The three views follow as an accordion, each with its key: the open
  one's heading with its list under it, and with no instances
  `No agents yet: n spawns one`. A cheat sheet of the keys that apply now
  comes last, the leader first. The filter field and a kept filter stand on
  the open view's heading. The counts and the time of the read have left
  the screen. The help shows that time at its top, with how many rows were
  withheld. From 80 columns the switcher, the palette, the spawn prompt, the
  help and the confirmations cover the main area, and the sidebar stays
  beside them. Under 80 columns they cover the whole screen, with their keys
  on their first row ([docs/tui.md](../tui.md#what-it-shows)).
- **The leader is `Alt+O` on Linux and Windows.** `Ctrl+\` was a stretch on
  most keyboards and needs AltGr on many layouts. macOS keeps `Ctrl+\` for
  now. `open.detachKey` in `tui.json` still names another key, `C-\`
  among them. `Alt+O` counts as the leader only when it arrives as one
  keypress: an `Esc` then `o` typed as two keys reaches the agent unchanged.
  The leader pressed twice now types it into the terminal that has the
  focus, and the leader then `Esc` gives the list the focus. The cheat
  sheet and the help name keys as people read them: `Alt+O`, `Ctrl+K`,
  `Enter` ([docs/tui.md](../tui.md#the-leader)).
