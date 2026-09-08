# Starting an existing instance

An instance keeps its home, identity, work and notes when its harness stops.
The Desktop roster is the place to return to it:

- A running row opens its terminal.
- A stopped row offers **Start…**. Clicking the row opens the same dialog.
- A running row's action menu offers **Restart with…** to change harness or launch configuration in the same home.
- The hierarchy's action popover offers **Start…** for a stopped instance.
- An unknown status is shown as unknown, not as permission to launch another process.

The Start/Restart dialog names the existing instance, runtime and host. Choose
a named launch configuration or keep the recorded launch. Without a selected
configuration, the harness can also be changed directly. A named configuration
fixes its harness; model and permission choices can override its defaults.
Enter a model or leave the field blank to use the selected launch's default.
An old harness's model is not carried to a different harness. Available local model
suggestions are advisory; a model ID can also be typed. Start uses the saved
briefing and state in a new harness conversation; it does not resume an old
harness conversation ID. After the launch appears in the roster, Desktop
opens the instance's terminal.

If an ordinary Start dialog finds the instance already running, its action becomes
**Open terminal**. A failed or timed-out start requires **Refresh status** before
another attempt, because the launch may have succeeded before the reply was
lost. Changing workspaces dismisses the dialog and prevents a delayed launch
reply from opening a terminal in the wrong workspace.

**Restart with…** is explicit: after validating the new configuration, the
kernel stops the current harness and starts the selected one. It does not
retire the instance, rerun identity creation or replace its worktree. A stop
that cannot be confirmed does not authorize another launch. Save in-progress
work before restarting; the old harness conversation is not transferred to
another harness.

**Preview invocation** asks the execution host for the resolved command and
displays it as text, with environment values redacted. It never launches an
agent. **Manage launch configurations** in the dialog creates or updates named
configurations at the displayed scope, including executable/wrapper, a JSON
argument list, environment references, model and permissions. Saving a
configuration changes its definition; applying it to an existing home requires
an explicit Start or Restart. When editing redacted environment values, keep
**Preserve the saved environment** selected or enter a complete replacement.
Use the server's workspace to manage configurations defined on that server.

Desktop sends `POST /api/start/<instance>?ws=…&home=…` (and `server=…` for a
remote instance). The backend resolves that exact roster identity and calls
`oats session start --home <absolute-home> [--server <id>] [--model <model>] --json`.
Launch choices add `--launch-config`, `--runtime` or `--yolo`/`--no-yolo`.
Restart uses `POST /api/restart/<instance>?ws=…&home=…` and the single kernel
command `oats session restart` with the same selectors and choices.
Configuration inspection and editing use `POST /api/launch-configs?ws=…`,
routed through `oats launch-config list/set/remove/preview`. These features
require the CLI's `launch-config` and `session-restart` capabilities; old
clients/hosts receive an update explanation instead of unsupported arguments.
The installed CLI must advertise `session-start`; remote starting also needs
the remote operation. The execution host checks the actual saved session
before launch. Desktop does not scaffold a home or execute a launcher itself.

Status collection reads each instance's recorded tmux socket and session,
with one query per socket per collection. A launcher shell with a harness
child remains running; a fallback shell or dead pane is stopped. Errors that
prevent a reliable observation remain unknown. Herdr uses its saved target.
