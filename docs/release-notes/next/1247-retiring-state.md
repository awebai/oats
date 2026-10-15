## Fixed

- **Desktop and `oats tui`: a retire in progress no longer shows as failed;
  it reads Retiring…** ([#1247](https://github.com/awebai/oats/issues/1247)).
  An instance being retired read **Retire didn't finish** while its retire
  was still running, as if it had failed. Its row now reads **Retiring…**
  while the retire runs, while OATS cannot tell whether the process holding
  it still runs, and from the moment you send a retire until the roster has
  been read after its answer. With an OATS that does not report a retire's
  state, a pending retire reads **Retiring…** too. A retiring row offers no
  start, stop, restart or open; Retire stays reachable but out of the way
  (in the Desktop's row menu, on the TUI's key). A self-retire whose
  completion failed reads **Retire failed**, with OATS's own message and
  code through the display filter, and one whose completion was lost reads
  **Retire didn't finish**; both offer Retire to finish it. See
  [Stopping and retiring](../desktop.md#stopping-and-retiring) and
  [held rows](../tui.md#held-rows).
