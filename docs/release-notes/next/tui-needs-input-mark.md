## Changed

- **TUI: an instance that needs input shows it by its mark, not a tag in
  words.** Its row draws `!` in place of its state mark, bold, in reverse
  video in yellow (not reversed on the selected row, a gap in the
  selection's bar), whatever its state and its colour; the row's
  `Needs input` tag is gone, and its name is cut as before. Under
  `NO_COLOR` the reverse video and the `!` carry it, and in ASCII it is the
  same `!`. A folded row keeps its `N below` tag for the waiting instances
  it folds away, whether or not it waits itself. The detail still says it
  in words, with the reason and how long it has waited, and the help lists
  the mark. Yellow now means needs input only: a state unknown (`?`) is
  dim in the terminal's foreground, and the warnings of the Souls and
  Capabilities views (a failed read, `Can't spawn here`, `· N on an older
  version`) are bold red, and a `sand` instance or soul is white.
  ([tui.md](../tui.md#what-it-shows))
