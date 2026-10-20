## Changed

- **`oats tui`'s switcher lists one row per workspace, whichever machines
  it is on.** A deployment on this computer's list that the run has not
  opened is read for its workspace (`oats status --dir <path> --json`, one at
  a time, 30 seconds each and 60 in all, at the start and when the switcher
  opens or is refreshed). It then joins its workspace's row instead of
  standing apart under `On this machine, not opened`. Under each workspace a
  dim line per deployment names its machine and, when it is not live, its
  state (`not opened`, `not observed`, `not reached`, ...). `Enter` on a
  workspace opens its deployments of this machine too, so the view holds
  them and the other machines' at once. A read that fails or times out
  leaves the deployment as its own row, saying why. The cheat sheet of the
  list of instances names `w workspaces`.
  ([The switcher](../tui.md#the-switcher))
- **`oats tui`'s terminal panel has a tab bar like a terminal's.** Its top
  row is always the tab bar, with one tab or many. Each tab is the agent's
  name, with `· <machine>` for another machine's agent, and tabs are divided
  by `│` (`|` in ASCII). The shown tab is bracketed, `[name]`, and bold, in
  reverse video while the terminal has the focus. The other tabs are dim.
  ([Tabs](../tui.md#tabs))
