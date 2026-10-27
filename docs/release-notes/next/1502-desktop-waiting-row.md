## Added

- **Desktop: an agent's question shows over its terminal.** While an instance
  waits on you, each terminal tab that shows it has a row over the terminal.
  The row says **Needs input** and how long it has waited, and under that the
  agent's question, as plain text. When the agent left no text, the row gives
  the reason in words, for example "Waiting for a tool approval". The question
  wraps to at most three lines, never takes more than a quarter of the pane,
  and ends with "…" when it is longer. The terminal resizes only when the wait
  starts, ends or its text changes, never as the age ticks over. In a split,
  each group has its own row
  ([desktop.md](../desktop.md#when-an-agent-waits-on-you)).
