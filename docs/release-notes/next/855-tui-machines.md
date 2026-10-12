## Added

- **`oats tui` (preview) shows a workspace's other machines, and switches
  between workspaces (#855).** It is still a preview: its screens and its
  configuration file may change without notice, and it still changes
  nothing. **This version adds the instances a workspace runs on the other
  machines registered on this machine**, in the same list as this
  machine's: each deployment under a heading of its own, a machine's
  heading with the time its rows were read. A row of another machine shows
  what its host reported at that time, not what is true at this moment. A
  machine that is not reached keeps its heading and the rows it last
  reported, and they read `unknown`: nothing reads as stopped that is only
  not reached. **`w` opens a switcher of workspaces**: the workspaces this
  run knows, what was matched to no workspace, and the deployments directly
  inside `~/Agents`, which `Enter` opens in the same run. **Started outside
  every deployment, with no `--dir`, it starts with that switcher** when
  `~/Agents` holds a deployment, where it printed the `E_NO_DEPLOYMENT`
  line; with none there, and with a `--dir` that is in no deployment, it
  prints that line and exits 1. It keeps nothing on disk, so a machine it
  has not reached in this run is listed by its own name, in no workspace.
  **It cannot yet** open an agent's terminal (`oats session attach --home
  <home>`), stop one (`oats instance stop <instance>`), start or restart one
  (`oats session start --home <home>`), retire one (`oats retire
  <instance>`), show souls or spawn an agent (`oats souls`, `oats spawn
  <soul>`), show capabilities (`oats capabilities`), register, check or
  remove a machine (`oats server connect`, `oats server check`, `oats server
  remove`), or open from its switcher a deployment outside `~/Agents` (`oats
  tui --dir <path>`): its help screen names the same commands.
  [docs/tui.md](../tui.md) has the rest.
  - **The other machines are one more read**, `oats server roster --json`,
    by the kernel it shipped with. It never holds this machine's rows, one
    runs at a time, and the next begins no sooner than 15 seconds after the
    last one ended unless you ask for it (`r`).
  - **Two new actions can be given other keys** in `tui.json`: `workspaces`
    (`w`) and `open-workspace` (`enter`). A `tui.json` that gives `w` or
    `enter` to another action stops the start, as any key given to two
    actions does (`E_TUI_CONFIG`): give that action of the switcher another
    key, or none.
