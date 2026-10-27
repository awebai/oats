## Added

- **TUI: an open agent that waits on you says what it waits on, above its
  terminal** ([#1502](https://github.com/awebai/oats/issues/1502)).
  - While the shown tab's agent has a live claim, a row stands under its
    tab bar: `Needs input`, how long it has waited, and the claim's
    message.
  - A claim with no message says what it waits on, for example
    `waiting on a permission prompt`.
  - The message wraps to at most 3 rows, and to a quarter of the group's
    height at most.
  - The agent's pane is resized only when the claim starts, clears or
    changes its text. Before, the question showed only in the agent's
    detail, which an open terminal covers. See
    [Tabs](../tui.md#tabs).
