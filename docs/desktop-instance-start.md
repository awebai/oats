# Starting an existing instance

An instance keeps its home, identity, work and notes when its harness stops.
The Desktop roster is the place to return to it:

- A running row opens its terminal.
- A stopped row offers **Start…**. Clicking the row opens the same dialog.
- The hierarchy's action popover offers **Start…** for a stopped instance.
- An unknown status is shown as unknown, not as permission to launch another process.

The Start dialog names the existing instance, runtime and host. Enter a model
or leave the field blank to retain its recorded choice. Available local model
suggestions are advisory; a model ID can also be typed. Start uses the saved
briefing and state in a new harness conversation; it does not resume an old
harness conversation ID. After the launch appears in the roster, Desktop
opens the instance's terminal.

If the instance is already running when the dialog checks, its action becomes
**Open terminal**. A failed or timed-out start requires **Refresh status** before
another attempt, because the launch may have succeeded before the reply was
lost. Changing workspaces dismisses the dialog and prevents a delayed launch
reply from opening a terminal in the wrong workspace.

Desktop sends `POST /api/start/<instance>?ws=…&home=…` (and `server=…` for a
remote instance). The backend resolves that exact roster identity and calls
`oats session start --home <absolute-home> [--server <id>] [--model <model>] --json`.
The installed CLI must advertise `session-start`; remote starting also needs
the remote operation. The execution host checks the actual saved session
before launch. Desktop does not scaffold a home or execute a launcher itself.

Status collection reads each instance's recorded tmux socket and session,
with one query per socket per collection. A launcher shell with a harness
child remains running; a fallback shell or dead pane is stopped. Errors that
prevent a reliable observation remain unknown. Herdr uses its saved target.
