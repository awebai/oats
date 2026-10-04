# Sessions

A **session** is the terminal in which an instance's harness runs. OATS
composes the instance home ([souls-and-instances.md](souls-and-instances.md)),
then launches the harness in a persistent terminal owned by a session backend.
Closing a viewer, or the Desktop, stops neither the agent nor its session.

All session commands run on the execution host, the machine that holds the
home. To run them on another machine, see [servers.md](servers.md).

## Harnesses

| Harness | `--harness` | Launched as |
|---|---|---|
| pi | `pi` (the default) | `pi --append-system-prompt <home>/AGENTS.md --approve --name <instance> [--model m] @TASK.md` |
| Claude Code | `claude` | `claude [--model m] -- '@TASK.md'` |
| Codex | `codex` | `codex --cd <home> [--model m] -- 'Read TASK.md in this directory first: it is your briefing and your task.'` |

Each harness starts in the instance home with its own native settings,
authentication and skill discovery. The command line also carries the
launch configuration's arguments and each capability's launch contribution.
`--runtime` is still read as `--harness`, with a deprecation warning; giving
both with different values is refused.

The harness, model, yolo choice and executable come from the spawn flags or a
named launch configuration (`--launch-config <name>`); see
[configuration.md](configuration.md#launch-configurations).
`--model @native-default` uses the harness's own default model.

The launch command sets `OATS_INSTANCE` and `OATS_INSTANCE_HOME`, plus the
environment that the launch configuration and capabilities contribute. No
`PI_AGENT_*` name is set, for any harness. The home's layout and what those
variables point at are described in
[souls-and-instances.md](souls-and-instances.md#instance-anatomy).

## Backends

tmux is the only session backend. `oats spawn --backend tmux` is accepted (it
is the default); `tmux` must be installed on the execution host. A launched
home keeps the session it recorded: `session start` and `restart` never
re-read the defaults. The session target is recorded twice: in
`instance.json` and in an independent lifecycle receipt. Every session command
checks that the two agree (`E_RUNTIME_AUTHORITY_MISMATCH` otherwise).

### tmux

Each instance is a window named after the instance in a tmux session: the
deployment's `session.tmuxSession`, else `OATS_TMUX_SESSION`, else
`PI_AGENTS_TMUX_SESSION` (the pre-0.31 variable), else `oats-agents`. Before
0.31 the default was `pi-agents`; a home launched then keeps the `pi-agents`
session it recorded, and `oats status` reads each home on its recorded tmux
socket and session, never the caller's `$TMUX` server: a caller outside the
agents' tmux (ssh, cron, a plain terminal) sees the same liveness as `session
inspect`. A recorded server that cannot be read gives `running: null` with
`runtimeState: "unreachable"`. The environment variables are read when the spawn runs, and `oats
inspect --json` reports the session a new spawn would open in as `session`
(`{tmuxSession}`). A spawn refuses an instance name that is a live window in the
session it would open in, on the OATS tmux server (`E_INSTANCE_NAME_TAKEN`); a
live window of that name in another session, such as a `pi-agents` window
after the default moved, or on another tmux server, does not block it. Session
commands target each home's exact recorded window, so the two never mix. The
receipt records the session, window and socket. The spawn result prints the
attach command.

<a id="the-oats-tmux-server"></a>
#### The OATS tmux server

Since 0.41 OATS creates sessions on a tmux server of its own, named `oats`
(`tmux -L oats`), not on your default tmux server. A tool that restyles the
default server (a theme switcher, a script that runs `tmux set -g …` or
`tmux kill-server`) therefore no longer reaches agent terminals.

- **Where it is.** The server's socket is
  `${TMUX_TMPDIR:-/tmp}/tmux-<uid>/oats`. The instance records the absolute
  socket path it was created on, in `instance.json` and in the receipt, and
  every later command uses that recorded path, never the name. OATS reads
  neither `TMUX` nor `TMUX_TMPDIR` itself: tmux resolves the name once, when
  the session is ensured.
- **Your configuration loads.** The server starts as any tmux server does, so
  your `~/.tmux.conf` (key bindings, status line, options) applies to it.
- **See what runs there:** `tmux -L oats ls`. Plain `tmux ls` and a bare
  `tmux attach` show your default server, so they no longer show sessions
  created from 0.41 on.
- **Attach:** `oats session attach --home <home>`. By hand, copy the `attach:` line that spawn prints: `tmux -S <socket> attach
  -t <session>`, with the recorded socket. `tmux -L oats attach -t <session>`
  is a convenience that holds only in an environment with the same
  `TMUX_TMPDIR` as the one that created the session.
- **`TMUX_TMPDIR`.** Two environments with different values (a login shell,
  and a process started by a service manager or launchd, a schedule runner or
  a GUI launch) each get their own `oats` server. Every instance stays
  reachable, because its absolute socket is recorded.
- **A limit.** A tool that runs inside a pane of the OATS server has `TMUX`
  pointing at that server and still reaches it.

**What OATS sets, and at which scope.** OATS sets nothing server-global on any
server when it creates a session or a window, and nothing at all on a server
other than the one the window is on.

| On | OATS sets | Scope |
|---|---|---|
| each agent window it creates | `window-style default`, `window-active-style default`, `cursor-colour default` | that window (`set-option -w`), by window id |
| each agent window, and the `hq` window of a session it creates | `window-size latest`, `aggressive-resize on` | that window |
| the pane of each window it launches a harness in, and a pane it respawns in place | no `COLORFGBG` in the pane's environment | that pane's command |

So an agent pane takes the colours of the terminal that views it, whatever
the server's own defaults say, and viewers of different sizes each get the
window at their own size. A window that is restarted in place keeps the
options it has. A session OATS did not create, and the server's global
options and environment, are left exactly as they were.

- `pane-colours` (the palette) is not reset: a local reset did not neutralise
  inherited array entries, so OATS leaves the palette alone. A configuration
  that sets `pane-colours` globally therefore reaches agent panes. It comes
  from your own tmux configuration, which OATS loads on purpose: remove the
  setting there, or unset it on the running server with `tmux -L oats
  set-option -gu pane-colours`.
- The oldest supported tmux stays 3.0. On tmux 3.0 and 3.0a `window-size
  latest` is not available and is skipped, as before this change;
  `cursor-colour` is skipped below 3.3; no error in either case. A refused
  `window-style` or `window-active-style` is a launch failure
  (`E_SPAWN_LAUNCH_FAILED`, `E_SESSION_START_FAILED`).

<a id="existing-instances"></a>
#### Existing instances

Upgrading moves nothing. An instance launched before 0.41 stays on the server
it recorded (usually your default one), and status, inspect, input, attach,
stop and retire keep acting on that recorded socket. While a deployment has
both, look at both servers: `tmux ls` and `tmux -L oats ls`.

- A restart in place stays on the recorded server: a live harness that is
  restarted, a fallback shell or a dead pane is reused where it is, and the
  record does not change.
- **Changed in 0.41:** a start that has to create the window again, because
  the recorded window or the recorded server is gone, creates it on the OATS
  server. Earlier kernels recreated it on the recorded socket. The start
  records the new socket in `instance.json` and the receipt, and says so: one
  line in its `warnings`, naming the instance, the old socket and the new
  one, and the same text as a `launch-warning` instance event.
- A home that was never launched (`--no-launch`) starts on the OATS server,
  with no warning.

To move a running instance deliberately:

```sh
oats instance stop <instance> --plan     # then run the `apply with:` line it prints
tmux -S <recorded socket> kill-window -t '=<session>:=<instance>'
oats session start --home <home>
```

The socket and the session are the `tmux.socket` and `tmux.session` of the
instance's row in `oats status --json`. The stop leaves a fallback shell in the
window, which a start would reuse in place; closing the window is what makes
the start create a new one.

### Herdr (removed in 0.31.0)

OATS no longer supports Herdr. Everything that meets it refuses with
`E_HERDR_REMOVED`, whose message starts `Herdr is no longer supported by OATS
(removed in 0.31.0); tmux is the only session backend.` and says what to do:

- `oats spawn --backend herdr` or `--herdr-socket`, local or routed with
  `--server` (refused before the server is contacted), and `oats server add
  --herdr`: remove the flag, or use tmux.
- A schedule's `backend: herdr` or a trigger's `spawn.backend: herdr`: the
  message names the file and key; remove it, or use tmux. A stored local job
  that names it is reported invalid and never runs.
- `session inspect`, `attach`, `input`, `start`, `restart` and `instance stop`
  on a home a Herdr-era kernel recorded (its `instance.json` records a
  `sessionTarget` or `backend: "herdr"`, or its receipt records a session
  target): retire it and spawn a new instance, which opens in tmux.
- `oats retire` of such a home needs no Herdr: when no process works in the
  home it proceeds as for an absent session; when one does, it refuses and
  names the pids, so stop its Herdr pane first (for example `herdr --session
  oats server stop`).

`oats status` lists such a home with `running: null`, `runtimeState:
"unsupported"` and the refusal as `runtimeError`. A server registration or
saved route that records `herdrPath` still loads; the field is ignored.

## Lifecycle

| Command | Effect |
|---|---|
| `oats spawn <soul> [--no-launch]` | Creates the home and launches the harness. `--no-launch` creates the home only. |
| `oats session start --home <abs>` | Starts a stopped or never-launched instance again in its existing home. |
| `oats session restart --home <abs>` | Stops the running harness and starts it again in place. |
| `oats instance stop <instance> --plan` / `--apply` | Stops the harness and keeps home, work and launch recipe. |
| `oats retire <instance>` | Ends the session and retires the instance ([souls-and-instances.md](souls-and-instances.md#retire)). |

### Start and restart

`session start` keeps the instance's identity, work tree and notes. It runs no
spawn hooks and creates no new home. It runs the recorded launch recipe in the
recorded tmux session. A window that is still there is reused on its recorded
server; a window that has to be created, a `--no-launch` home's first one
included, opens on [the OATS tmux server](#the-oats-tmux-server).

- `--model`, `--launch-config <name>|none`, `--harness` and `--yolo` /
  `--no-yolo` re-resolve the recipe against the home's recorded context and
  run every check before anything starts. `--model` replaces the recorded model
  for this and later starts.
- A live harness is refused (`E_SESSION_RUNNING`). A fallback shell or a dead
  pane is reused in place. A missing window, or one whose tmux server is gone,
  is created again on the OATS tmux server, and the start warns when that is
  not the server the home recorded ([Existing instances](#existing-instances)).
- A state that cannot be established is refused (`E_SESSION_UNKNOWN`). Two
  starts of one home serialize (`E_SESSION_START_BUSY`). A home being retired
  is refused (`E_INSTANCE_RETIRING`).

`session restart` takes the same flags. It sends SIGTERM to the harness and
its children, waits `--stop-grace <seconds>` (default 20, at most 300), then
starts in place. It never escalates: a harness still running is reported
(`E_SESSION_STOP_FAILED`) and nothing is launched.

### Stop

`oats instance stop <instance> --plan` reports the session state, recorded
children and uncommitted work, with a `planRevision`. `--apply --plan-revision
<rev> --idempotency-key <key>` stops the instance and its recorded children
first (`--no-recursive` stops only the instance), with the same bounded
SIGTERM. Restart the instance later with `oats session start` or
`oats session restart`.

### Inspect, input and attach

```sh
oats session inspect --home /abs/home --json
oats session input --home /abs/home --text-file message.txt --json
oats session attach --home /abs/home
```

- **inspect** reports `backend`, `present` and `state`: `unknown` for a live
  harness, `shell` for a fallback shell,
  `stopped` for an absent or dead terminal, or `not-launched`. An unavailable
  backend is an error (`E_SESSION_UNAVAILABLE`), never a stopped result.
  Beside `state`, `waitingOnYou` (feature `waiting-on-you`) is a producer's
  live claim that the instance needs input from a human, `{since, producer,
  reason, message}`, or `null`; it is non-null only for a running harness
  (docs/desktop-cli-api.md, "Waiting on you").
- **input** sends UTF-8 text (stdin or `--text-file`, at most 256 KiB, no
  NUL) as exactly one bracketed paste followed by exactly one Enter. The text
  is never run by a shell. Existing endpoint authority, fallback-shell,
  stopped-session and split-window checks still refuse before input.

  Before Enter, a size-based floor (200 ms plus 3 ms per KiB) and read-only
  settling polls share one **monotonic 2-second observation budget**, starting
  immediately after the paste command returns, before buffer cleanup. Sleeps
  and capture timeouts are clipped to the remaining budget; a failed capture
  or exhausted budget ends settling and proceeds to the single Enter. After
  Enter, at most two read-only looks share a separate 1-second observation
  budget. These deadlines do not bound the original paste/key commands, buffer
  cleanup or OS scheduling. They authorize no further keys.

  Successful terminal commands return `submitted: true` and `verified`, with
  no `reason`. `verified: true` means only that the bounded display comparison
  saw a changed look; `false` means unchanged, unreadable or exhausted
  observation. The comparison retains its whitespace and resize/reflow
  handling. Display movement can be unrelated output, a spinner or a dialog;
  an unchanged display is not proof that no effects occurred or that a draft
  is pending. **Neither value authorizes retry or proves model acceptance.**

  A failed paste or key command remains `E_SESSION_INPUT_FAILED`; an
  observational failure does not turn successful terminal operations into a
  refusal. Command errors may themselves be uncertain after partial effects.
  This transport offers no exactly-once guarantee and does not guarantee that
  a busy pane accepts the input. Wake schedules retain their existing rule:
  any nonthrowing input answer is recorded as delivered, meaning terminal
  operations, not model processing. Broker delivery/ack policy and harness
  acceptance evidence remain separate contracts.
- **attach** is interactive and takes no `--json`. It opens a temporary tmux
  session linked to the agent's window alone.
  Closing the viewer leaves the agent running.

### Attachments

`oats session upload --file <local> --home <abs>` copies a file into
`<home>/.oats-attachments/` (directory mode 0700, file mode 0600, `name-2` on
collision, at most 64 MiB) and answers `{path, bytes, sha256}`. The caller
gives `path` to the agent; nothing is typed into the session. Attachments are
removed with the home.

## The task prompt

Spawn writes `TASK.md` in the home: the instance's name, soul, home and work
tree, followed by the `--task` or `--task-file` text, or a note to await
instructions when no task is given. Every launch, including `session start`
and `restart`, opens a new harness conversation on `TASK.md`. The instance
resumes its work from its own state files, as its knowledge capability
prescribes.

The task's text never travels on a command line, where any local user could
read it in the process list:

- pi and Claude Code get `@TASK.md`, which each harness reads as the file.
  pi sends it as the session's first prompt and refuses it if another
  extension's turn (the @awebai/pi welcome) is running or starts while it is
  being sent. The pi bridge (`@awebai/oats-pi`) holds it on pi's own path
  until no turn is active, so it runs exactly once, unaltered; a pi
  deployment without the bridge can sit idle with no task. The exception is
  in the bridge's [README](../packages/pi/README.md).
- Codex gets a fixed pointer to the file and reads it with a tool.
- A home whose recorded command still hands over `"$(cat TASK.md)"` starts
  with its harness's safe prompt instead, and the command is saved that way.

The home is created `0700` and `TASK.md` `0600`. `oats doctor` reports an
instance home that other users can read (`home-readable`), with the exact
`chmod`; it never changes a home's mode itself.

## Permissions (yolo)

Yolo is chosen per launch: `--yolo` / `--no-yolo` on `oats spawn`,
`oats session start` and `oats session restart`, or the `yolo` field of a
named launch configuration. The flag overrides the configuration. A soul never
carries it. With no choice, a spawn keeps the harness's native policy, and a
start keeps what the home recorded.

When yolo is true, OATS adds `--dangerously-skip-permissions` for Claude Code,
and `--yolo` plus trust for the instance home for Codex. pi takes no flag.
`--no-yolo` removes only those added flags; native settings stay in force.
Unattended execution never implies yolo.
