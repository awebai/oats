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
session it would open in (`E_INSTANCE_NAME_TAKEN`); a live window of that name
in another session, such as a `pi-agents` window after the default moved, does
not block it. Session commands target each home's exact recorded window, so
the two never mix. The receipt records the
session, window and socket. The spawn result prints the attach command.

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
spawn hooks and creates no new home. It runs the recorded launch recipe on the
recorded tmux session; a `--no-launch` home starts on the default tmux
server.

- `--model`, `--launch-config <name>|none`, `--harness` and `--yolo` /
  `--no-yolo` re-resolve the recipe against the home's recorded context and
  run every check before anything starts. `--model` replaces the recorded model
  for this and later starts.
- A live harness is refused (`E_SESSION_RUNNING`). A fallback shell or a dead
  pane is reused in place; a missing window or a lost tmux server is recreated.
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
- **input** submits UTF-8 text (stdin or `--text-file`, at most 256 KiB, no
  NUL) followed by Enter, as a bracketed paste. The text is never run by a
  shell. A fallback shell, a stopped session or a split
  tmux window is refused. The text is pasted once. Enter waits for the pane to
  settle (two identical captures, at least about 200 ms, longer for a larger
  paste, at most 2 s), and is judged by whether it changed the bottom 15 lines
  of the pane. The comparison is of bytes only, with whitespace and box-drawing
  rules ignored so a redraw at another width is not a change. The pane's text
  is never interpreted. An Enter that changed nothing was swallowed, and is
  resent after a backoff, at most 3 Enters in total. The answer adds:
  - `submitted: true, verified: true`: an Enter was taken.
  - `submitted: false, verified: true, reason: "enter-not-taken"`: none of the
    3 Enters changed the pane. The text stays in the agent's input box; it is
    not pasted again.
  - `submitted: true, verified: false`: the pane could not be captured, so
    only the first Enter was sent and nothing was judged. As before, this
    means the terminal accepted the keys.

  `submitted` never means the agent processed the text. A pane that changes
  for another reason after Enter (a spinner, a clock, a human typing) reads as
  taken. A call takes at most about 4 s plus its tmux calls. A failed paste or
  key send is `E_SESSION_INPUT_FAILED`, with no retry. Wake schedules and
  messaging capabilities use this command ([schedules.md](schedules.md)); a
  wake schedule records any answer as delivered.
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
