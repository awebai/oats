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

OATS creates sessions on a tmux server of its own, named `oats`
(`tmux -L oats`), not on your default tmux server, where earlier kernels
created them. A tool that restyles the
default server (a theme switcher, a script that runs `tmux set -g …` or
`tmux kill-server`) therefore no longer reaches agent terminals.

- **Where it is.** The server's socket is
  `${TMUX_TMPDIR:-/tmp}/tmux-<uid>/oats`. The instance records the absolute
  socket path it was created on, in `instance.json` and in the receipt, and
  every later command uses that recorded path, never the name. OATS does not
  compute the socket path and does not use `TMUX` to find a server: tmux
  resolves the name once, when the session is ensured, from the
  `TMUX_TMPDIR` of the process that runs OATS, which OATS passes on unchanged
  when it replaces the environment for that call.
- **Your configuration loads.** The server starts as any tmux server does, so
  your `~/.tmux.conf` (key bindings, status line, options) applies to it.
- **See what runs there:** `tmux -L oats ls`. Plain `tmux ls` and a bare
  `tmux attach` show your default server, so they do not show the sessions
  OATS creates now.
- **Attach:** `oats session attach --home <home>`. By hand, copy the
  `attach:` line that spawn prints: `tmux -S <socket> attach -t <session>`,
  with the recorded socket. `tmux -L oats attach -t <session>` is a
  convenience that holds only in an environment with the same `TMUX_TMPDIR`
  as the one that created the session.
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
the server's own defaults say, and on tmux 3.1 or later the window follows
the size of the viewer that used it last. A window that is restarted in place
keeps the options it has. A session OATS did not create, and the server's global
options and environment, are left exactly as they were.

- `pane-colours` (the palette) is not reset: a local reset did not neutralise
  inherited array entries, so OATS leaves the palette alone. A configuration
  that sets `pane-colours` globally therefore reaches agent panes. It comes
  from your own tmux configuration, which OATS loads on purpose: remove the
  setting there, or unset it on the running server with `tmux -L oats
  set-option -gu pane-colours`.
- The oldest supported tmux stays 3.0. On tmux 3.0 and 3.0a `window-size
  latest` is not available and is skipped, as before this change;
  `cursor-colour` is skipped below 3.3; no error in either case. On 3.0 and
  3.0a the window therefore keeps the sizing that server gives it, not the
  latest viewer's.
- The two sizing commands are each attempted on their own, and a refused one
  is ignored: the launch goes on. Nothing else is tolerated: a refused
  `window-style` or `window-active-style` is a launch failure (the spawn is
  rolled back and fails; a start fails with `E_SESSION_START_FAILED`). An
  earlier kernel failed a start whose recorded tmux server could not be
  reached when a sizing command was refused; this one does not.

<a id="the-servers-start-environment"></a>
#### The environment of the server and its panes

A tmux server keeps the environment of the process that started it, as its
global environment. A pane gets that, plus its session's environment (the
variables tmux's `update-environment` names, taken from whoever created the
session), plus what the launch command sets (`OATS_INSTANCE`,
`OATS_INSTANCE_HOME`, the capabilities' and the launch configuration's
variables). One variable is different: **a pane's `PATH` is the `PATH` of the
process that creates its window**, that is of each `oats spawn` or `oats
session start`, with the home's own `oats` shim put first by the launch
command. So:

- `PATH` follows the process that runs each spawn or start, not whoever
  started the server.
- The rest of the ambient environment follows the server's first creator,
  and a server that already runs keeps what it started with. Creating a
  session or a window on it changes nothing global.

Who starts the `oats` server, after an install, a reboot or its last session
ending, decides that ambient environment:

| Started by | The server's environment |
|---|---|
| an operator's shell | that shell's |
| the Desktop | the Desktop's, with the login-shell `PATH` it puts in front ([desktop.md](desktop.md)) |
| a schedule runner or a trigger | the service's |
| an OATS instance that creates an agents' session | the global environment of the tmux server that instance's home records, reduced as described below; not the instance's own |

The first creator that succeeds determines it; when two start it at the same
moment, tmux starts one server and nothing says which of the two it is.

**What OATS removes, for every creator.** The names the kernel itself sets
never go into the environment OATS creates an agents' session or window
with: `COLORFGBG`, `TMUX`, `TMUX_PANE`; the launch identity and roots
(`OATS_INSTANCE`, `OATS_INSTANCE_HOME`, `OATS_HOME`, `OATS_AGENT`,
`OATS_SOUL`, `OATS_SOUL_ID`, `OATS_ROOT`, `OATS_CONTEXT`, `OATS_WORKSPACE`,
`OATS_EVENT`, `OATS_SETTINGS`, `OATS_SETTINGS_ORIGINS`, `OATS_CLI_BIN`,
`PI_AGENT_INSTANCE`, `PI_AGENT_HOME`, `PI_AGENTS_ROOT`); what a hook, an
operation, a retire or a trigger is given (`OATS_CAPABILITY`, `OATS_LAYER`,
`OATS_LEVEL`, `OATS_META`, `OATS_DEPLOYMENT`, `OATS_RESOLUTION`,
`OATS_OPERATION`, `OATS_REPO`, `OATS_BRANCH`, `OATS_WORK`, `OATS_KIND`,
`OATS_TASK`, `OATS_HARNESS`, `OATS_PREVIOUS_HARNESS`, `OATS_RUNTIME`,
`OATS_PREVIOUS_RUNTIME`, `OATS_LAUNCH_PREVIEW`, `OATS_RETIRE_INTENT`,
`OATS_TRIGGER_EVENT_FILE`, `OATS_TEAM_NAME`, `OATS_TEAM_SCOPE`,
`OATS_TEAM_ID`, `OATS_TEAM_LABEL`, `OATS_TEAM_LABELS`, `OATS_TEAMS`,
`OATS_TEAMS_SOURCE`, `OATS_DEFAULT_TEAM`, `OATS_DEFAULT_TEAM_ID`,
`OATS_DEFAULT_TEAM_FROM`, `OATS_WORKSPACE_NAME`, `OATS_WORKSPACE_KEY`); and
every launch reference (`OATS_LAUNCH_REF_<NAME>`) with the `<NAME>` it stands
for. Other `OATS_` variables you export (`OATS_HOME_DIR`,
`OATS_TMUX_SESSION`) are yours and stay. An agent's plain `oats` finds its
deployment from its home.

**An instance creates an agents' session or window without its own
environment.** Nothing of an instance's environment reaches a server or a
pane through the calls that create an agents' session or window. A harness
puts its own variables, credentials and identity into the environment of
what it runs. A process is inside an instance when `OATS_INSTANCE_HOME` names an instance
home, or its working directory is inside one. That covers an agent that
spawns or starts another instance, a capability hook that spawns or starts
(a hook runs with its instance's identity, also when a person ran the command
that triggered it), and `oats schedule run-now` typed inside an instance.

- When such a process has to create the tmux session, OATS reads the global
  environment of the server its home records (`tmux -S <recorded socket>
  show-environment -g -s`, the endpoint of the home's receipt, checked
  against `instance.json` as every session command checks it) and creates
  the session with that. What the new session gets is a reduction of that
  environment, not an exact copy. It is read strictly and never run by a
  shell; text that cannot be read to its end is a failed read. Not carried
  from the recorded server:
  - a hidden or removed variable;
  - a variable whose value holds a line break;
  - a variable whose value holds a `$`: tmux versions print it differently,
    so OATS does not guess what the value was;
  - on tmux 3.4 and 3.5, a variable whose value holds a control character or
    a byte that is not UTF-8, which those versions print encoded. Other
    versions print the line as it is: there a control character other than
    a line break is carried exactly, and a byte that is not UTF-8 fails the
    read.

  Such a variable is absent in the panes of the new server unless the pane's
  own shell start-up files set it; it is never filled in from the instance's
  own environment. When the variable left out is one that decides which
  configuration a tmux server loads or which programs it runs (`HOME`,
  `XDG_CONFIG_HOME`, `PATH`, `SHELL`), the creation is refused instead, with
  the same remedy as below.
- When it creates a window in a session that exists, the tmux client that
  creates it runs with `PATH`, without any instance's `oats` shim directory,
  and with `LANG`, `LC_ALL` and `LC_CTYPE`, which that client needs to start
  on a host whose only UTF-8 locale is the one they name. tmux hands a pane
  the `PATH` of that client and nothing else of it: the three locale names
  stay with the client, and the pane, the session and the server keep the
  values they had. Nothing else of the instance travels. A restart that
  reuses the pane the home already has runs its tmux client with the same
  environment; where and whether the pane is reused does not change.
- **It is refused** (`E_RUNTIME_ENDPOINT_UNKNOWN`; `oats spawn` reports it
  as `E_SPAWN_FAILED` with the same message) when the session does not exist
  on the `oats` server and there is no source to read: the home records no
  tmux server (it was never launched), its receipt cannot be used, or its
  recorded server cannot be reached or read. A process that carries an
  instance's identity (`OATS_INSTANCE`, `OATS_INSTANCE_HOME`, `OATS_HOME`,
  `PI_AGENT_INSTANCE` or `PI_AGENT_HOME`) with no home to be found is refused
  the same way. Nothing falls back to the caller's environment, to another
  server or to a built-in list.
- **When the refusal comes.** In `oats spawn`: before any scaffold, work
  tree, identity or hook. In `oats session start`: after the start's
  preflights and its planning, and before the real run of preview-aware
  launch hooks, a stop and any write of the home's launch state (its record,
  its receipt, a pending start). A launch hook that does not declare
  `launchPreview` has already run by then, and a warning it returned is
  already a `launch-warning` event of the home, as before any other late
  refusal of a start (`E_SESSION_RUNNING`, `E_LAUNCH_ENV_MISSING`). Nothing
  undoes what that hook did, and there is nothing to clean up: a launch hook
  may do idempotent provider registration on a real start and no more
  ([capabilities.md](capabilities.md)), so the next start repeats it
  harmlessly. Both launch hooks OATS ships are preview-aware. If the
  session disappears between that check and the creation, the refusal comes
  at the creation, and the spawn is rolled back as any failed launch is.
- **The remedy** is to create the session from your own shell, outside every
  instance home, as below. The session name matters: it must be the
  deployment's (the refusal names it); another deployment's session on the
  same server does not help. Once the session exists, the instance spawns
  and starts there without reading anything.
- The recorded server's environment is an existing baseline, chosen because
  it is what a window that instance opened on that server got. It is not
  proof that it holds no old identity or credential, and this is not a
  promise that secrets are isolated between instances that run as the same
  user on one tmux server.
- A server that already runs keeps its baseline. OATS creates sessions and
  windows on it and does not certify where that baseline came from or that
  it is clean: someone who started a server named `oats` by other means
  decided it.
- These rules are about the calls that create an agents' session or window,
  nothing wider. `oats session attach` creates a temporary viewer session on
  the server the home records, with the attaching process's own environment
  ([#623](https://github.com/awebai/oats/issues/623)): tmux imports the
  `update-environment` names into that temporary session, and if that
  server exits between the viewer's check and its creation, the attaching
  process is the one that starts it.
- Which server is reached is decided by the process that creates, never by
  the environment it passes: its own `tmux`, its own `TMUX_TMPDIR`, and the
  socket the lookup returned when the server runs. Its own `tmux` is the one
  its own `PATH` finds, and OATS runs it by its full path. A process whose
  `PATH` holds no tmux, or whose `PATH` is not set (tmux used to be found by
  the system's default search then), is refused
  (`E_RUNTIME_ENDPOINT_UNKNOWN`) when it has to create the session: run the
  command with a `PATH` that holds tmux. With the session already there,
  nothing is refused. What the server process gets (`HOME` and so which
  configuration loads, `PATH`, everything else) comes from the passed
  environment alone. The global environment of the server the session is
  created on is never read for this and never changed; the one that is read
  is the recorded server's, as above.

A process that neither sign identifies as an instance is treated as any
other creator: its environment, without the names above, is what it passes.

By hand (`<session>` is the deployment's session name: `oats-agents` unless
`session.tmuxSession` or `OATS_TMUX_SESSION` says otherwise):

```sh
tmux -L oats new-session -d -s <session> -n hq   # start it from your own shell, before anything else does
tmux -L oats show-environment -g                 # what environment the server has
tmux -L oats show-environment -g LANG            # one variable
tmux -L oats set-environment -g LANG "$LANG"     # repair a running server: windows created from now on inherit it
tmux -L oats kill-server                         # replace it: ends EVERY session on that server
```

- Start it yourself after an upgrade or a reboot, before agents, the Desktop
  or a schedule run. OATS finds a session you created and uses it: it looks
  the session up by its exact name and assumes nothing about its `hq`
  window.
- `set-environment -g` is how a running server is repaired: it ends nothing,
  and panes that already run keep the environment they have. A pane's `PATH`
  is always that of the process that runs the spawn or the start, so setting
  `PATH` on the server changes nothing for OATS panes.
- `kill-server` ends every session on that server, every running agent
  included. It is for before agents are started, not for repairing a running
  host. The next start takes the environment of whoever starts it.
- `-L oats` reaches the server of the environment you type it in
  (`TMUX_TMPDIR`). For the server an instance is on, use the socket from its
  row in `oats status --json`: `tmux -S <socket> …`.
- **Limit
  ([#620](https://github.com/awebai/oats/issues/620)).** `oats retire` of a
  launched instance is refused (`E_RUNTIME_QUIESCE_FAILED`) while the file of
  its recorded socket does not exist. Until that issue is fixed, what to do
  depends on why the file is missing:
  - After a reboot the server is gone and its socket file with it. The
    retire is refused until a session exists at that socket again: start any
    instance of the deployment, or create the session by hand with the first
    command above; for an instance still recorded on another server, `tmux
    -S <recorded socket> new-session -d` (the session that command creates
    can be ended after the retire). Then retire.
  - If the server may still be running and only its socket file was removed,
    do not create a session at that path: a new server there hides the
    running one. Send the tmux server process `SIGUSR1`, which makes it
    create its socket again (tmux(1), `-S`).
- A tmux server whose socket file is missing or does not answer reads as not
  reachable, which is not proof that it exited: status, start and stop read
  that state as stopped
  ([#624](https://github.com/awebai/oats/issues/624)). That is an existing
  limit of every tmux server OATS uses, not of the `oats` server in
  particular.

<a id="existing-instances"></a>
#### Existing instances

Upgrading moves nothing. An instance launched by an earlier kernel stays on the server
it recorded (usually your default one), and status, inspect, input, attach,
stop and retire keep acting on that recorded socket. While a deployment has
both, look at both servers: `tmux ls` and `tmux -L oats ls`.

- A restart in place stays on the recorded server: a live harness that is
  restarted, a fallback shell or a dead pane is reused where it is, and the
  record does not change.
- **Changed:** a start that has to create the window again, because the
  recorded window is gone or the recorded server cannot be reached, creates
  it on the OATS server. Earlier kernels recreated it on the recorded socket.
  The start records the new socket in `instance.json` and the receipt, and
  says so: one line in its `warnings`, naming the instance, the old socket
  and the new one, and the same text as a `launch-warning` instance event.
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

Do not end the agents' session by hand (`tmux kill-session`): that ends every
other instance whose window is in that session, not only the one you are
moving. And a window that a viewer still links would live on in that viewer,
so the next start would create a second window for the same home.

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
  pane is reused in place. A missing window, or one whose tmux server cannot
  be reached, is created again on the OATS tmux server, and the start warns when that is
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
