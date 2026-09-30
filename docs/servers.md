# Servers: running instances on another machine

A **server** is another machine with its own OATS and deployment, reached
over OpenSSH. `--server <id>` runs a command on that machine's OATS with the
same flags and JSON envelope as a local call. The server's kernel does the
work ([execution-targets.md](execution-targets.md)); this machine routes and
keeps a saved route per remote instance.

## Register

```bash
oats server add build --ssh build-host --workspace /srv/team --oats /usr/local/bin/oats
oats server check build      # ssh reachability, remote version, workspace roster; changes nothing
oats server list
oats server remove build
```

- `--ssh` is an OpenSSH host alias or host name, never `user@host` or an
  option. Users, keys and host verification belong in `~/.ssh/config`.
  Connections are non-interactive (`BatchMode=yes`): a prompt fails fast.
- `--workspace` is the absolute path of the deployment directory on the
  server: the directory that holds its `oats-local.yaml`
  ([configuration.md](configuration.md)). Routed commands run there as
  `--dir <workspace>`.
- `--oats` is the remote executable (default: `oats` on the remote PATH).
- `--path` prepends directories to the minimal remote PATH of every routed
  command (`~/.local/bin:/opt/pi/bin`), where the remote spawn looks for the
  harness binary.
- `--herdr` is refused (`E_HERDR_REMOVED`): Herdr was removed in 0.31.0. A
  registration or saved route that still records `herdrPath` loads; the field
  is ignored, never written or printed.
- `--label` sets a display name. `--replace` overwrites an existing id.
- Registrations live in `~/.oats/servers.json` on this machine, never in a
  repository.

## Connections

Every routed ssh call carries these options, before `--` and the host:

| Option | Why |
|---|---|
| `BatchMode=yes`, `ConnectTimeout=15` | a prompt or an unreachable host fails fast |
| `ServerAliveInterval=15`, `ServerAliveCountMax=3` | a link that died without a reset ends the call, an attached viewer included, within about 60 s |
| `ControlMaster=auto`, `ControlPath=~/.oats/ssh/%C`, `ControlPersist=60` | every call to one host (the probe, the command, a viewer, concurrent Desktop reads) shares one authenticated connection, kept 60 s after its last client |

- Options given with `-o` override `~/.ssh/config`, so these replace any
  `ControlMaster`, `ControlPath` or `ControlPersist` set there for the host.
  Everything else in your ssh config (users, keys, `ProxyJump`, host
  verification) applies as usual; a `ProxyJump` host is reached once per
  master.
- `~/.oats/ssh` (under `OATS_HOME_DIR` when set) is created mode 0700. OATS
  does not use it if it is owned by another user or writable by group or
  others.
- ssh binds the control socket at the path plus 17 bytes, within the 104-byte
  socket path limit of macOS, so the directory path may be at most 45 bytes.
  `/Users/<name>/.oats/ssh` fits for any name up to 23 characters. The path
  must also be one ssh reads literally: letters, digits and `. _ / + , : @ =
  -` only (a space, `%`, `$`, a quote or `#` is ssh syntax).
- When the path does not fit, has other characters, or the directory is not
  private, calls run with `ControlPath=none` instead: no connection sharing,
  including any your ssh config sets up; keepalives still apply. The command
  warns once per server on stderr, naming the path and the fix (an
  `OATS_HOME_DIR` or `HOME` that is shorter or plain).
- A master left stale by a network drop is replaced by ssh on the next call.
- The version probe (`oats version --json`) is asked once per process per
  server and target. `server add --replace` to another target forgets it.
- When ssh fails under an attached viewer (a lost link, or one never made),
  `session attach --server` exits 255 and says that, if the link was lost,
  the instance keeps running on the server, with the command to reattach.
  When ssh fails before the viewer opens (the version probe, or a name
  resolved through the host's roster), it also exits 255, with `oats: ssh to
  <host> failed: …` (`--json`: the `E_SSH` envelope). Every other refusal
  (an incompatible host, an unknown or ambiguous name, bad arguments) exits 1,
  and so does an ssh that cannot be run on this machine at all: no link can
  come back.
- Every routed command reports ssh's own failure as `E_SSH` (`ssh to <host>
  failed: …`). When ssh never started on this machine, the `--json` envelope
  says so with `error.details: {"sshStarted": false}`; without details, ssh
  ran and the link failed
  ([desktop-cli-api.md](desktop-cli-api.md#ssh-failures-e_ssh)).

## Run there

```bash
oats spawn dev --server build --purpose fix-123 --task-file task.md
oats status --server build
oats session attach --server build --instance dev-fix-123
oats retire dev-fix-123 --server build
```

Arguments are quoted for the remote shell. Local files (`--task-file`,
`--wake-file`, a schedule or launch-configuration `--file`) are read here and
sent as text or on stdin, never as paths.

| Command | Where it runs | The server must advertise |
|---|---|---|
| `spawn` | registered workspace | the requested harness, backend and yolo option; `launch-config` for `--launch-config`; `schedule` for a wake schedule |
| `status` | registered workspace | |
| `retire` | the instance's home | `retire-home` to retire by exact home |
| `session inspect`, `session attach` | the instance's home | `session` |
| `session start`, `session restart` | the instance's home | `session-start`; `session-restart`; `launch-config` when `--launch-config`, `--harness` or `--yolo` is given |
| `session upload` | the instance's home | `session-upload` |
| `okf harvest --instance <name>` | the saved home | `harvest` |
| `schedule ...` | registered workspace | `schedule` |
| `launch-config list\|set\|remove\|preview` | `--dir`, the instance's home, or the registered workspace | `launch-config` |
| `inspect`, `operation run` | `--dir`, the instance's home, or the registered workspace | `operations` |
| `readiness` | the instance's home, `--dir`, or the registered workspace | `readiness` (`readinessApi: 2`) |
| `instance events` | the instance's home | `instance-events-2` (`eventsApi: 2`) |
| `instance git`, `instance diff` | the instance's home; the Git runs there | `instance-git` (`instanceGitApi: 1`) |
| `instance stop --plan\|--apply`, `retire --plan`, `retire --plan-revision … --idempotency-key …` | the instance's home | `lifecycle-plans` (`lifecycleApi: 1`) |

Before every routed command except `status`, the kernel reads the server's
`oats version --json`. A remote OATS older than 0.22.1 is refused, and so is a
missing feature (`E_REMOTE_INCOMPATIBLE`), before anything is sent. A spawn is
checked against the harness it would use (the flag, or the soul's default as
the remote roster reports it). A host that advertises no harness list is
assumed to run only pi and claude, on tmux, with no launch options.

**Addressing an instance.** Instance commands (`retire`, the `session`
commands, `inspect`, `operation`, `launch-config`) reach any instance on the
server, whoever spawned it, by `--home </remote/home>` or by name
(`--instance <name>`, or the positional name of `retire`):

- A name spawned from this machine resolves through its saved route.
- Any other name resolves through the server's roster (one `status --json`
  in the registered workspace) to its one home. A name that two homes carry
  there is `E_AMBIGUOUS`, listing the homes (`error.details.candidates`);
  pass `--home`. A name the roster does not list is `E_SNAPSHOT_UNKNOWN`.
- A `--home` no saved route owns is sent through the registration's target;
  the server's kernel decides whether it is an instance home and its refusal
  is relayed as is.
- The home is the identity; use it when two souls on the host own
  same-named instances. A name and a home that disagree are refused
  (`E_HOME_MISMATCH`).

**`--dir` with `--server`.** For `inspect`, `operation`, `launch-config`,
`readiness`, `instance`, and a `retire --plan` or guarded retire apply, an
explicit `--dir` names a directory on the server and travels as is. Every
other routed command refuses `--dir`; its scope comes from the
registration.

**Not routed.** `session input` runs on the execution host, where schedules
and messaging capabilities call it. `session restart --stop-grace` is refused
with `--server`; the remote default applies. `session attach --print` shows
the ssh command without running it. A server without the `session` commands
(before 0.22.2) is refused with the tmux command to attach there directly,
naming the session and window its roster records for the instance (else
`pi-agents`, that kernel's default).

## The roster and harvest

```bash
oats server roster --json                                # one group per server and target
oats okf harvest --server build --instance dev-fix-123   # the harvest, run in the saved home
```

The **roster** is what the Desktop shows: one group per server id and route
target (host and workspace), with the registration (present or not), the
probe result, the remote souls, the instances joined with saved routes
(`savedRoute`, `running` or `null` when unknown, `retirePending`,
`rollbackIncomplete`, `missingRemotely`, `addressable`), and `retireFailures`
(deferred self-retirements that failed there). Each instance row also relays
the host's own facts from its `status --json`: `identity`,
`identityAddress`, `teams`, `startedAt`, `createdAt`, `model`,
`runtimeState`, `parentInstance`, `siblingInstance`, `relation`,
`relativeTo` and `spawnOrigin`. A fact the host does not supply is `null`
(an older host, or a saved route the host no longer lists). A removed or edited registration keeps
its group from the saved routes. State is pulled on every call within
`--per-target` (default 20 s) of a total `--budget` (default 45 s); a group
not reached is reported with `E_ROSTER_BUDGET`. `--server <id>` narrows it.

**Harvest** runs the knowledge capability's `okf harvest --json` in the
instance's saved home on the server and relays its envelope.

## What this machine keeps

A **saved route** per remote instance, under `~/.oats/remote/<server>/`,
written at spawn: the ssh host, workspace, oats path and PATH prefix, and the
remote home. Retire, harvest and session commands use
the saved route, not the current registration, so editing or removing a
registration never orphans a remote home. The route is removed when the
remote kernel reports the home gone.

- `oats server add --replace` to a different host or workspace, while saved
  routes still point at the old one, makes the next `spawn --server` fail with
  `E_ROUTE_CHANGED`. Register the new target under a new id, or retire the old
  instances first.
- A saved route is never pointed at a different home. A spawn whose name already
  has a route under that server leaves the new instance without one
  (`routeConflict` in the result, with a warning naming the host-side retire).
- A saved route whose instance is gone on the host (`missingRemotely`) cannot
  be retired. Drop it with `oats server forget <id> --instance <name>`.
- `retire --server` sends the saved home as `--home`, so a same-named
  instance under another soul is never the one retired.

## Limits

- No Git runs over SSH: repository operations always run on the server, by
  its kernel, in its deployment.
