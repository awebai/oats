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
global environment. A pane gets its session's environment over that (the
variables tmux's `update-environment` names, taken from whoever created the
session, and anything set on the session with `set-environment -t`), plus
what the launch command sets (`OATS_INSTANCE`, `OATS_INSTANCE_HOME`, the
capabilities' and the launch configuration's variables). **A pane's
environment is its session's, `PATH` included, whoever creates its window**:
an instance, the Desktop or an operator's shell. The tmux client that creates
the window (or respawns the pane, in a restart in place) runs with only
`LANG`, `LC_ALL` and `LC_CTYPE`, and tmux takes a client's `PATH` only when
the client has one. The launch command then puts the home's own `oats` shim
first. So:

- A pane's `PATH` is its session's `PATH` when the session has one, otherwise
  the server's global `PATH`. It no longer follows the process that runs each
  spawn or start (it did before 0.42.0).
- A `PATH` and the variables that interpret it (a version manager's
  bookkeeping, such as mise's `__MISE_DIFF`, or nvm's) therefore come from
  one environment. OATS no longer overlays a creator's `PATH` onto another
  environment's companion state. It does not make an existing or external
  server's environment, a session override or a launch configuration's
  `PATH` coherent: it uses them as they are.
- The rest of the ambient environment follows the server's first creator,
  and a server that already runs keeps what it started with. Creating a
  session or a window on it changes nothing global.

**The harness is looked up where its pane looks it up.** A launch whose
executable is a bare name (the harness's own, or a launch configuration's
`executable` without a `/`) looks it up on the `PATH` the pane will run it
with, by this precedence:

1. a declared absolute `executable` is used as it is, with no lookup (a
   relative one is resolved against the deployment directory, as before);
2. a `PATH` set in the launch configuration's `env` (a literal, or a
   `fromEnv` reference resolved on this host) is what the pane's command
   line applies, so the lookup uses it;
3. otherwise the session's or the server's `PATH`, read with the strict
   reader below.

The lookup happens twice. Before anything is created, against the `PATH` the
pane is expected to have: for a start that reuses the home's recorded pane
(running, or left as a shell), that pane's own session on its recorded
server, whatever the OATS server holds and whether one runs; otherwise the
session's or the server's when the server runs, otherwise the `PATH` of the
environment the server is created with. And again
on the session OATS actually gets, whoever created it and with whatever
environment (another creator that won the race to create the server, a
session whose environment overrides `PATH`): found elsewhere, the launch runs
and records that executable; not there, the spawn is refused and rolled back
as any failed launch is, and a start is refused before it launches anything.
For a start the first check comes before a restart stops its harness; the
second, on the session OATS gets, comes after that session (and, when none
ran, the server) was created, and for a restart whose window went away
during its stop, after that stop. A session a refused start created is left
in place. A start under a new selection with no server running reads the
environment the server will be created with (your login environment, or its
fallback, below) for its first check, never this process's `PATH`. A recorded executable (a start that reuses the home's launch) is
kept as it is: it then runs with its pane's environment, but it is not looked
up again. A `--no-launch` spawn, and a preview with no server running, look
the harness up on the process's own `PATH`, as before.

A session's `PATH` can be in four states, and the lookup tells them apart:
no entry (the server's `PATH` is used), a value, even an empty one (used as
it is), an explicit clear (`unset PATH;` in `show-environment -s`: tmux gives
the pane no `PATH` at all), or a value the strict reader leaves out. The last
two, and a server with no `PATH` or one that cannot be read, are refused: OATS
never substitutes the server's `PATH`, the caller's or a default for them.

A harness that is not on that `PATH` is refused with `E_HARNESS_UNAVAILABLE`
(a configuration's declared bare name with `E_LAUNCH_EXECUTABLE`). The message
names where it looked (`the PATH of tmux session <name>`, `the global PATH of
the OATS tmux server (<socket>)`, or the launch configuration's) and the
remedies: declare the executable's absolute path in the launch configuration,
set `PATH` in the launch configuration, or start the server from your own
shell. It never prints a `PATH`'s contents.

Who starts the `oats` server, after an install, a reboot or its last session
ending, decides that ambient environment.

**When OATS starts the server, it gives it your login environment.** The
`new-session` that creates an agents' session is the only OATS call that
starts the server. When no server answered before it, whoever runs it (a spawn
or a start from an instance, the Desktop, an operator's shell, a schedule
runner or a trigger), OATS reads the environment your own login shell sets up
and starts the server with that:

- **Only in your own session.** The login shell is run only for a process
  whose `HOME` is your home directory in the password database. A process
  that set another `HOME` (a sandbox, a test fixture, an account switch that
  kept the caller's environment) is not taken to run in your login session:
  its reading fails and the fallback below applies.
- **The shell** is your login shell from the password database (not the
  creator's `SHELL`): bash, zsh or fish, run as `-l -i -c` from your home
  directory, so your profile and rc files run as they do in a terminal (a
  version manager's activation, an agent socket an rc exports).
- **It starts from a fixed seed**, nothing else of the creator: `HOME`,
  `USER`, `LOGNAME` and `SHELL` from the password database, `PATH` as
  `/usr/bin:/bin:/usr/sbin:/sbin`, `TERM=dumb`, the creator's `LANG`,
  `LC_ALL` and `LC_CTYPE`, and the session variables `SSH_AUTH_SOCK`,
  `DISPLAY`, `WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR` and
  `DBUS_SESSION_BUS_ADDRESS`. Each of those comes from the first source that
  has it, an empty value counting as present: the creator, when it is not an
  instance; for an instance, the global environment of the server its home
  records; then your user session, read as data (`systemctl --user
  show-environment` on Linux, decoding systemd's `$'…'` values; `launchctl
  getenv` on macOS). A user session that cannot be read leaves those names to
  your login shell, and OATS says so on stderr, without values. On macOS the
  agent socket launchd gives the apps and terminals you open is not a
  `launchctl` variable (it is the `SSH_AUTH_SOCK` key of the
  `com.openssh.ssh-agent` job), so `launchctl getenv` usually has none: a
  server OATS starts there has your agent socket when the process that starts
  it has one (the Desktop opened from the Finder or the Dock, a terminal), or
  when your login shell sets it. The tool runs
  from `/usr/bin:/bin:/usr/sbin:/sbin` with your own `HOME`, `USER`,
  `LOGNAME` and, on Linux, your runtime directory (`/run/user/<uid>`), never
  with the creator's environment. No `OATS_`,
  `AWEB_`, harness or credential variable of the creator is in the seed.
- **What your setup produces wins**: the shell's answer is final, including
  what its rc files set, except the functions bash exports
  (`BASH_FUNC_<name>%%`, from a profile's `export -f`): they are code every
  bash in a pane would import, and OATS drops them. OATS then removes the
  kernel's names and the instance-identity names, as below, and keeps your
  OATS configuration as the creator has it: every `OATS_` and `PI_AGENTS_`
  variable that is not a kernel name (`OATS_HOME_DIR`, `OATS_TMUX_SESSION`,
  `OATS_PACKAGE_CATALOG`, …) is the creator's, over what your rc files set;
  for an instance, the one the server its home records has, never its own. The server is still reached with the
  creator's `TMUX_TMPDIR`.
- **The answer is one frame on the shell's stdout**: a small emitter run by
  the shell writes the environment as JSON between a start and an end
  delimiter that carry a random value made for this reading only. Exactly one
  complete frame of that reading, start before end, is the answer; anything
  else the shell prints (a banner, a prompt, text that looks like an
  assignment, like JSON or like a frame of another reading) is discarded, and
  a missing, cut, repeated or misordered frame is no answer. The shell's
  errors are not read, and no value is written to a file, an argument or a
  log. It is accepted only whole: exit status 0, at most 1 MiB for all the
  shell printed, one JSON object whose values are all text, plain
  identifiers as names, `HOME` and `PATH` present. Nothing in it is
  evaluated. Not a descriptor of its own: bash 5.3, started `-l -i`, marks
  the descriptors it inherits from 3 to 19 close-on-exec, so an answer there
  never reaches the emitter. The random value keeps accidental output apart;
  it does not guard against your own start-up files, which can also send the
  shell's stdout elsewhere (then there is no answer, and the fallback
  below applies).
- **It is bounded at 5 s.** The shell runs in its own process group; at the
  deadline that group, and only it, is killed, and the read ends even when a
  descendant still holds the shell's stdout. A descendant that put itself in its own
  session or group (a daemon an rc starts) is outside that group, and OATS
  does not promise to end it.
- **When it cannot be read** (a process whose `HOME` is not yours, a timeout, a non-zero exit, a partial,
  oversized or malformed answer, no `HOME` or `PATH`, a shell that is not
  bash, zsh or fish or cannot run), OATS prints one line on stderr saying
  why and what it used instead, never a value, and `--json` output stays one
  valid envelope. A creator outside every instance falls back to its own
  environment without the kernel's names (the behaviour before 0.42.0); an
  instance falls back to a copy of the server its home records, as below, or
  is refused, never to its own environment. A fallback is degraded: it is
  neither a login environment nor proof of a working agent socket, and it
  passes on whatever the creator's environment holds. A creator whose `PATH`
  names a version manager's directories without the variables that interpret
  them (a process started by a service manager, an agent's shell) gives the
  server that same mismatch, and a version-manager wrapper can then resolve
  its own name again and loop, as in #616. OATS prevents that only when it
  reads your login environment.

A server OATS did not start keeps what its starter gave it:

| Started by | The server's environment |
|---|---|
| OATS (any creator; see above) | your login environment, or the creator's fallback |
| you, from your own shell (`tmux -L oats new-session …`) | that shell's |
| a service manager (`systemd-run`, a unit, launchd) | only that manager's environment |

OATS uses an existing server as it is and does not certify its environment.
The first creator that succeeds determines it; when two start it at the same
moment, tmux starts one server and nothing says which of the two it is. A
server that exits between OATS's lookup and its `new-session` is started as
any server OATS starts: with your login environment, or its fallback.

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
`OATS_TRIGGER_EVENT_FILE`, `OATS_TEST_LOGIN_SHELL` (a test seam that replaces
the login shell, honoured only for a process whose `HOME` is not your home
directory; a launch configuration cannot set it), `OATS_TEAM_NAME`, `OATS_TEAM_SCOPE`,
`OATS_TEAM_ID`, `OATS_TEAM_LABEL`, `OATS_TEAM_LABELS`, `OATS_TEAMS`,
`OATS_TEAMS_SOURCE`, `OATS_DEFAULT_TEAM`, `OATS_DEFAULT_TEAM_ID`,
`OATS_DEFAULT_TEAM_FROM`, `OATS_WORKSPACE_NAME`, `OATS_WORKSPACE_KEY`); and
every launch reference (`OATS_LAUNCH_REF_<NAME>`) with the `<NAME>` it stands
for. Other `OATS_` variables you export (`OATS_HOME_DIR`,
`OATS_TMUX_SESSION`) are yours and stay, also when OATS starts the server
with your login environment (above). An agent's plain `oats` finds its
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

- When such a process has to create the tmux session on a server that runs,
  or its login environment could not be read, OATS reads the global
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
  creates it runs with `LANG`, `LC_ALL` and `LC_CTYPE` only, which that client
  needs to start on a host whose only UTF-8 locale is the one they name, as
  every creator's does. tmux hands a pane none of them: the pane, the session
  and the server keep the values they had, and the pane's `PATH` is the
  session's or the server's. Nothing of the instance travels, its `PATH`
  included. A restart that reuses the pane the home already has runs its tmux
  client with the same environment; where and whether the pane is reused does
  not change.
- **It is refused** (`E_RUNTIME_ENDPOINT_UNKNOWN`; `oats spawn` reports it
  as `E_SPAWN_FAILED` with the same message) when the session does not exist
  on the `oats` server, its login environment is not what the server gets
  (the server runs, or the login environment could not be read), and there is
  no source to read: the home records no
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
  its own `PATH` finds, and the session is created by that program's full
  path, as is every window client (it has no `PATH` to look one up with). A
  process whose `PATH` holds no tmux cannot read the server at all:
  it is refused (`E_RUNTIME_ENDPOINT_UNKNOWN`) whether or not the session
  exists, and told to run the command with a `PATH` that holds tmux. A
  process whose `PATH` is not set has no tmux to run by its full path: it
  cannot create a session, nor open or respawn a window (the window is
  refused). Only finding a session that is already there is not refused. What the server process
  gets (`HOME` and so which configuration loads, `PATH`, everything else)
  comes from the passed environment alone. The global environment of the
  server the session is created on is never read for this and never changed;
  the one that is read is the recorded server's, as above.

A process that neither sign identifies as an instance is treated as any
other creator: when it starts the server, your login environment (above);
otherwise, and as the fallback, its environment without the names above.

By hand (`<session>` is the deployment's session name: `oats-agents` unless
`session.tmuxSession` or `OATS_TMUX_SESSION` says otherwise):

```sh
tmux -L oats new-session -d -s <session> -n hq   # start it yourself: it keeps your shell's environment
tmux -L oats show-environment -g                 # what environment the server has
tmux -L oats show-environment -g LANG            # one variable
tmux -L oats set-environment -g LANG "$LANG"     # repair a running server: windows created from now on inherit it
tmux -L oats kill-server                         # replace it: ends EVERY session on that server
```

- There is no manual step: when OATS starts the server, it gives it your
  login environment. A server you start yourself keeps your shell's
  environment, and one a service manager starts gets only that manager's.
  OATS finds a session you created and uses it: it looks the session up by
  its exact name and assumes nothing about its `hq` window.
- `set-environment -g` is how a running server is repaired: it ends nothing,
  and panes that already run keep the environment they have. Windows created
  from now on take it, `PATH` included (with no session override of it), and
  their harness is looked up on that `PATH`.
- `kill-server` ends every session on that server, every running agent
  included. It is for before agents are started, not for repairing a running
  host. The next start gives the new server your login environment when OATS
  starts it, or the environment of whoever else does.
- `-L oats` reaches the server of the environment you type it in
  (`TMUX_TMPDIR`). For the server an instance is on, use the socket from its
  row in `oats status --json`: `tmux -S <socket> …`.
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

### Launch prompt outcomes

For a home with [explicit host-local consent](configuration.md#exact-home-launch-prompt-consent),
spawn, start and restart can observe only the process created by that invocation.
A new window supplies the exact pane identity. Reusing a pane requires a changed
numeric process ID and fresh visible bytes differing from the pre-respawn
screen. An already-running process, stale screen or scrollback grants no input
authority. Home, socket, pane, PID, geometry and exact visible signature are
rechecked before each key.

Observation is bounded to 30 seconds with 100 ms intervals. Only accepted
version/platform-specific startup and prompt frames keep authority open;
unexpected output permanently closes it. Only the exact aweb development-channel
confirmation can be answered, once, with one Enter. Folder-trust and API-key
prompts are unexpected and block; no multi-prompt sequence is authorized.
For a qualified launch, the controller saves the exclusively owned window's
size policy and dimensions, temporarily pins it to the fixture's 110x35
geometry, and confirms the size before matching. It audits restoration on
every exit, including timeout and failure; a replaced process/window is never
resized during cleanup. Pinning a reused pane cannot establish freshness: that
must already be proved at its original geometry. The selected-option frame
is rechecked before Enter. Uncertain submission is never retried. Only the
qualified Claude executable/platform/geometry in
[configuration](configuration.md#exact-home-launch-prompt-consent) has an enabled
development-channel fixture. Installed version alone grants no match. Ordinary
`session input` and wake delivery do not enter this controller.

Both spawn and start return `E_SPAWN_INCOMPLETE` for retained prompt failures.
With `launchPrompts.status` set to `blocked`, the home, actual terminal target,
provider effects and committed parent lineage are retained. `launchPrompts` records `status`,
`answers`, `reason` and event `receipt`; unknown prompts use
`blocked: unexpected prompt`. Status `incomplete` means the audit could not be
completed, including a possible key followed by an audit failure. It is
not proof that no input was sent. Both outcomes record `launched:false` while
retaining the real process/endpoint for inspection: this is never permission
to allocate another harness.

Inspect the retained home with `oats session inspect --home <home>` and attach
if needed. A later `oats session start --home <home>` uses the ordinary running
process checks; it cannot answer into a still-running retained launch. Repeating
spawn, including the same idempotency key, does not replay prompt answers or
create a duplicate home. A genuinely new process in a later launch gets its own
bounded authority. A prompt receipt does not assert receive readiness.

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
