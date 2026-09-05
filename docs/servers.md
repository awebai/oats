# Servers: running instances on another machine

A **server** is another machine with its own installed OATS, reached over an
OpenSSH host alias. Registering one lets `oats spawn`, `oats retire` and
`oats status` run there with the same flags and the same JSON envelope as
locally, and lets the Desktop offer it at spawn time. The contract behind
this is [execution targets](execution-targets.md).

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
shell, and the remote's version, envelope and advertised support are checked
before any mutation. A spawn that asks for a runtime the remote does not
advertise (including the soul's own default, resolved from the remote roster),
a session backend it lacks, or a launch option such as `--yolo` it does not
know is refused with `E_REMOTE_INCOMPATIBLE` naming what it does support; a
remote that advertises nothing is treated as a 0.22.1 kernel (pi and claude,
tmux, no options). `--dir` and `--server` do not combine; the remote workspace
comes from the registration.

```bash
oats session attach --server build --instance dev-fix-123   # viewer through an ssh PTY
```

The viewer runs the execution host's own `oats session attach` (Herdr terminal
or an isolated tmux linked viewer) over `ssh -t`, addressed by the saved route:
the remote binary and path come from the snapshot, never from the caller.

## What this machine keeps

A **route snapshot** per remote instance under `~/.oats/remote/<server>/`,
taken at spawn: the ssh host, workspace and oats path the instance was spawned
through, plus the remote home. Later `retire --server` uses the snapshot, not
today's registry, so editing or removing a registration never orphans a remote
home; the snapshot is removed only when the remote kernel reports the home
gone. Remote state is never cached: `status --server` pulls it every time and
appends this machine's snapshots for that server.

## Limits

- Routed: `spawn`, `retire`, `status`, `session inspect` (the execution
  host's envelope, relayed; a Desktop preflight before attaching) and
  `session attach`. Session input runs on the execution host, where the wake
  broker calls it.
  Desktop projection of remote instances and remote viewer attachment are in
  progress on the execution-targets work.
- No Git over SSH: repository operations always run on the server, by its
  kernel, in its workspace.
- A remote needs an OATS at least 0.22.1 (`MIN_REMOTE_VERSION`); the record
  commands (`capture`, `recall`) need Node 22.5+ there for `node:sqlite`, which
  lifecycle routing does not.
