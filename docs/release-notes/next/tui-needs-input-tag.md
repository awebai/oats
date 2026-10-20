## Changed

- **`oats tui` marks a row that needs input with a tag in words.** Where it
  drew a bare `!` at the right of the row, it now draws the Desktop's words
  in reverse video in the waiting colour: `Needs input`, and on a folded row
  with waiting instances under it, `3 below` (`99+ below` past 99). On the
  selected row the tag is the waiting colour not reversed, so it stands
  apart from the selection's bar, and under `NO_COLOR` the reverse video
  alone carries it. On a row too narrow for the whole name beside the
  words, the tag shrinks to `!` or the count alone, still reversed, and the
  name keeps every cell it had. ([What it shows](../tui.md#what-it-shows))
