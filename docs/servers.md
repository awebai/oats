# Servers: running instances on another machine

A **server** is another machine with its own installed OATS, reached over an
OpenSSH host alias. Registering one lets `oats spawn`, `oats retire` and
`oats status` run there with the same flags and the same JSON envelope as
locally, and lets the Desktop offer it at spawn time. The contract behind
this is the execution-targets contract (`docs/execution-targets.md`, landing
with the transport work).

## Register

```bash
oats server add build --ssh build-host --workspace /srv/team --oats /usr/local/bin/oats
oats server check build      # ssh reachability, remote oats version, workspace roster; no mutation
oats server list
```

- `--ssh` is an OpenSSH host alias or host name. Keys, users, ports and host
  verification live in your `~/.ssh/config`; the registry stores none of it and
  refuses `user@host` or option-shaped values. Connections are non-interactive
  (`BatchMode=yes`): a host that would prompt fails fast with ssh's message.
- `--workspace` is the absolute path of an OATS workspace on the server: the
  same team repository checked out there, with its own `agents/`.
- `--oats` is the remote executable (default `oats` on the login shell's PATH).
- `--path` names directories to prepend to the remote PATH for every routed
  command (`~/.local/bin:/opt/pi/bin`). A non-interactive ssh command runs in
  the login shell's minimal PATH, and the remote kernel's spawn preflight looks
  for the runtime binary (`claude`, `pi`, `codex`) there; without this, a
  runtime installed under the user's home is "not found" even though it runs
  fine in an interactive shell on that host.
- Registrations live in `~/.oats/servers.json` on this machine, never in a
  repository scope.

## Run there

```bash
oats spawn dev --server build --purpose fix-123 --task-file task.md
oats status --server build
oats retire dev-fix-123 --server build
```

The remote kernel does the work in its registered workspace: composition,
worktree, identity, launch, retirement. The local side only routes: a local
`--task-file` travels as text, every argument is quoted for the remote login
shell, and the remote's version and envelope are checked before either
mutation (spawn and retire). A spawn is also held to what the remote
advertises: a runtime it does not list (including the soul's own default as
the remote roster reports it), a session backend it lacks, or a launch option
such as `--yolo` it does not know is refused with `E_REMOTE_INCOMPATIBLE`
saying what was established. A remote that advertises nothing (any kernel
before 0.22.2) is assumed to run pi and claude on tmux with no options, and
the refusal says so rather than claiming the remote lacks the feature; a soul
the remote roster does not list with a runtime is validated by the remote
kernel itself at spawn. `--dir` and `--server` do not combine; the remote
workspace comes from the registration.

```bash
oats session attach --server build --instance dev-fix-123   # viewer through an ssh PTY
```

The viewer runs the execution host's own `oats session attach` (Herdr terminal
or an isolated tmux linked viewer) over `ssh -t`, addressed by the saved route:
the remote binary and path come from the snapshot, never from the caller. The
`oats session` commands ship in kernel 0.22.2: against an older server both
session routes refuse with `E_REMOTE_INCOMPATIBLE` before connecting a viewer,
and `ssh -t <host> tmux attach -t oats` remains the way in.

```bash
oats server roster --json                                  # every remote group, one status pull each
oats okf harvest --server build --instance dev-fix-123     # the knowledge harvest, run in the saved home
```

The **roster** is what the Desktop projects: one group per server id and
route target (host and workspace), each with the registration (present or
not), the probe (`ok`, or the error that stopped it), the souls the remote
reports with their `agentsRoot`, the instances joined with this machine's
saved routes (`savedRoute`; `running` true/false, or `null` when the remote
could not be asked; `retirePending`; `rollbackIncomplete` for a quarantined
home; `missingRemotely` when a saved route names an instance the reachable
remote no longer lists), and `retireFailures` (deferred self-retirements
that failed there and need `oats retire` again). A registration that was
removed or edited keeps its group from the saved routes alone, so nothing
spawned through it disappears from view. Remote state is pulled every time,
never cached, within a budget: each group gets at most `--per-target` (20 s)
of a `--budget` (45 s) total, and groups the budget cannot reach are reported
with `E_ROSTER_BUDGET` rather than dropped or waited for. **Harvest** runs
the knowledge package's own `okf harvest --json` in the instance's saved home
on the host (a route that outlives the registration, like retire): the home
comes from the route saved at spawn, never from the caller, the remote must
advertise `harvest` in its version probe (0.22.3), and the package's envelope
is relayed as is. **Retire** through a saved route sends that route's home as
`--home` when the remote advertises `retire-home` in its probe `features`, so
a same-named twin under another agent on the host is never the one retired;
locally, `oats retire <name> --home <path>` does the same and a bare name that
resolves to several homes is refused.

## What this machine keeps

A **route snapshot** per remote instance under `~/.oats/remote/<server>/`,
taken at spawn: the ssh host, workspace and oats path the instance was spawned
through, plus the remote home. Later `retire --server` uses the snapshot, not
today's registry, so editing or removing a registration never orphans a remote
home; the snapshot is removed only when the remote kernel reports the home
gone. Remote state is never cached: `status --server` pulls it every time and
appends this machine's snapshots for that server.

A registration edited to a different host or workspace (`server add
--replace`) while saved routes still point at the old target is refused at
the next `spawn --server` with `E_ROUTE_CHANGED`: a new snapshot under the
same server id would silently retarget them. Register the new target under a
new id, or retire the old instances first; the roster shows both targets
until then. A saved route whose instance is gone on the host (the roster
shows it `missingRemotely`) cannot be retired away: drop it on purpose with
`oats server forget <id> --instance <name>`. Saved routes are keyed by name
under their server id: spawning an explicit `--instance` name that already
has a route there is refused (`E_ROUTE_EXISTS`), and a generated name that
collides with another soul's route on the same host leaves the new instance
without a saved route (`routeConflict` in the result, a warning naming the
host-side retire), never overwriting the existing one. The roster gives a
route to the remote row with the same name and home only; a same-named twin
under another soul is observed only.

## Limits

- Routed: `spawn`, `retire`, `status`, `server roster`, `okf harvest`,
  and, against a 0.22.2 or later server, `session inspect` (the execution
  host's envelope, relayed; a Desktop preflight before attaching) and
  `session attach`. Session input runs on the execution host, where the wake
  broker calls it. The version probe's `remote` list names this kernel's
  remote-side surface (`roster` and `harvest` from 0.22.3; `roster` is the
  local command over registrations and saved routes, not a route).
- No Git over SSH: repository operations always run on the server, by its
  kernel, in its workspace.
- A remote needs an OATS at least 0.22.1 (`MIN_REMOTE_VERSION`) for spawn,
  retire and status, 0.22.2 for the session routes, and 0.22.3 for harvest
  and for the exact-home retire; the record commands
  (`capture`, `recall`) need Node 22.5+ there for `node:sqlite`, which
  lifecycle routing does not.
- Lifecycle actions on a remote instance need a saved route from this
  machine; an instance the remote reports that was spawned elsewhere shows in
  the roster without one (`savedRoute: false`) and is read-only here.
