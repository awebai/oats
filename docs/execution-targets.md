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
| Claude Code | `claude` | `claude [--model m] -- "$(cat TASK.md)"` |
| Codex | `codex` | `codex --cd <home> [--model m] -- "$(cat TASK.md)"` |

Each harness starts in the instance home with its own native settings,
authentication and skill discovery. The command line also carries the
launch configuration's arguments and each capability's launch contribution.
`--runtime` is still read as `--harness`, with a deprecation warning; giving
both with different values is refused.

The harness, model, yolo choice and executable come from the spawn flags or a
named launch configuration (`--launch-config <name>`); see
[configuration.md](configuration.md#launch-configurations).
`--model @native-default` uses the harness's own default model.

The launch command sets `OATS_INSTANCE`, `OATS_INSTANCE_HOME`,
`PI_AGENT_INSTANCE` and `PI_AGENT_HOME`, plus the environment that the launch
configuration and capabilities contribute. The home's layout and what those
variables point at are described in
[souls-and-instances.md](souls-and-instances.md#instance-anatomy).

## Backends

A new launch's backend is, in order: `oats spawn --backend tmux|herdr`; the
deployment's `oats-local.yaml` `session.backend`
([configuration.md](configuration.md#the-file)); the `OATS_SESSION_BACKEND`
environment variable; tmux. Desktop and schedule spawns that name no backend
follow the same order. The spawn result, the spawn preview and the `launched`
event name the deciding layer as `backendFrom`: `flag`, `local`, `env` or
`default` (feature `session-backend-config`, 0.31). The backend binary must be
installed on the execution host. A launched home keeps the backend and session
it recorded: `session start` and `restart` never re-read these layers. A
`--no-launch` spawn on Herdr records no Herdr server yet, so `session start`
refuses it (`E_RUNTIME_ENDPOINT_UNKNOWN`); on a host whose `session.backend` is
`herdr`, spawn launched, or pass `--backend tmux` for a home started later. A
replayed keyed spawn returns the recorded instance without `backendFrom`. The chosen session
target is recorded twice: in `instance.json` and in an independent lifecycle
receipt. Every session command checks that the two agree
(`E_RUNTIME_AUTHORITY_MISMATCH` otherwise).

### tmux

Each instance is a window named after the instance in a tmux session: the
deployment's `session.tmuxSession`, else `OATS_TMUX_SESSION`, else
`PI_AGENTS_TMUX_SESSION` (the pre-0.31 variable), else `oats-agents`. Before
0.31 the default was `pi-agents`; a home launched then keeps the `pi-agents`
session it recorded, and `oats status` reads each home in its recorded
session. The receipt records the
session, window and socket. The spawn result prints the attach command.

### Herdr

Each instance is a Herdr workspace with one pane. The receipt records the
binary, socket, workspace id, pane id, terminal id and protocol. The terminal
id distinguishes a replacement occupant of the same pane.

- `--herdr-socket <path>` uses an operator-managed Herdr server. OATS never
  starts a different server when that socket cannot be inspected.
- Without it, OATS uses `$XDG_CONFIG_HOME/herdr/sessions/oats/herdr.sock`
  (default `~/.config/...`) and starts `herdr --session oats server` if no
  server is running there.
- The adapter speaks the Herdr socket API at an explicit protocol version,
  20 or 22. A new session records the protocol its server reports (20 for
  Herdr 0.8, 22 for 0.9) and refuses any other; before 0.30.3 it always
  selected 20, so Herdr 0.9 could not be spawned on. A recorded target is
  never renegotiated: each call, the kernel's and the Desktop's, checks that
  the server's snapshot reports the recorded protocol.
- Herdr cannot give a pane a command at creation, so OATS types the launch
  command into the pane's shell. It waits until the shell has drawn its prompt
  (`herdr pane read`, at most 10 s): text typed earlier is cut at the
  terminal's line-buffer limit.

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
recorded tmux session or Herdr server; a `--no-launch` home starts on the
default tmux server.

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

- **inspect** reports `backend`, `present` and `state`: the Herdr agent state
  when available, `unknown` for a live harness, `shell` for a fallback shell,
  `stopped` for an absent or dead terminal, or `not-launched`. An unavailable
  backend is an error (`E_SESSION_UNAVAILABLE`), never a stopped result.
- **input** submits UTF-8 text (stdin or `--text-file`, at most 256 KiB, no
  NUL) followed by Enter: bracketed paste in tmux, `pane run` in Herdr. The
  text is never run by a shell. A fallback shell, a stopped session or a split
  tmux window is refused. `submitted: true` means the terminal accepted the
  text, not that the agent processed it. Wake schedules and messaging
  capabilities use this command ([schedules.md](schedules.md)).
- **attach** is interactive and takes no `--json`. It opens a Herdr terminal
  viewer, or a temporary tmux session linked to the agent's window alone.
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
