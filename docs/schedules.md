# Schedules

A schedule launches an agent, runs an oats command, or wakes an existing
instance on a cron. Definitions belong to a scope, the team workspace (the
config level that declares the team, else the outermost `oats-config.yaml`
level), and are committable; every `oats schedule` command run anywhere
inside that scope, including from an instance home, reads and writes the
same file. Execution belongs to the host that holds the scope, so a
schedule on a registered server keeps running while your laptop sleeps.

There is no daemon. One host timer (a launchd user agent on macOS, a systemd
user timer on Linux) runs `oats schedule tick --host` once a minute; the tick
is a short-lived process that evaluates only the current minute, launches
what is due through the same `spawn`, `session start` and `session input`
paths you use by hand, records what it observed, and exits. Minutes missed
while the machine slept are skipped, never replayed. There are no retries
and no queue.

## Files

- `<workspace>/oats-schedules.json` — the definitions (`{version: 1, jobs:
  {<id>: ...}}`). Commit it if you want the schedule shared with the team.
- `<workspace>/.agents/schedules/state.json` — last attempted minute and
  last run per job (gitignored), plus one lock directory per running job.
- `~/.oats/schedules/registry.json` — the host registry: which scopes the
  host ticks, `maxConcurrent` (default 1) and the tick interval. One host
  lock serializes ticks, run-now, reconcile and remove; it is never reclaimed
  by another process: a lock whose owner is unreadable or gone is reported
  with the directory to remove, and the holder removes its own lock on exit
  and on SIGINT/SIGTERM. Definition edits take a short per-scope lock.

## Kinds

- **spawn** `{id, enabled, cron, tz, kind: "spawn", agent, agentsRoot?,
  repo?, backend?, purpose?, task, runtime?, model?, yolo?, wake?}` — every
  due minute launches one disposable instance of `agent` with the same
  options `oats spawn` takes. `agentsRoot` names the exact agents root that
  holds the soul (it must lie inside the workspace and defaults to the
  workspace's own root); it is what tells same-named souls in different
  member repositories apart. `repo` is the work repository, as `--repo`. The task gets a trailing schedule block naming the job and the
  minute and ending with `oats retire --self`. An optional `wake` object
  (`{cron, tz, message}`) attaches a wake schedule to each launched instance;
  nothing is attached unless you ask.
- **command** `{id, enabled, cron, tz, kind: "command", cwd, argv}` — runs
  an oats-only argv (`argv[0]` is `oats`, no shell) in `cwd`, which must be
  inside the workspace. The runner parses the command's envelope and tracks
  any instance it names. A provider can return an independent worker launched
  from durable context; the job follows that worker until its home is gone.
  Command return is not task completion. Avoid binding durable work to a
  disposable source-home cwd; see [OKF v2 source jobs](#okf-v2-source-jobs).
  New exact-record command definitions use the fields described in
  [Captured execution and recurrence](#captured-execution-and-recurrence).
- **wake** `{id, enabled, cron, tz, kind: "wake", home, message}` — every
  due minute inspects the instance at `home` through its session receipts.
  Running: `message` is delivered once with `session input`. Not running
  (absent, dead pane or fallback shell): the same home is started with
  `session start` and the message becomes the job's one pending delivery,
  completed on a later tick, any tick, as soon as the session is active; the
  home is started again only at due minutes, never every minute, so a
  harness that keeps exiting is not restarted in a loop. A job holds at most
  one pending delivery: a due minute while one is pending adds nothing.
- **operation** `{id, enabled, cron, tz, kind: "operation", operation, home}`
  — runs a provider operation such as `knowledge:harvest` in the instance at
  `home` through `oats operation run <layer>:<name> --home <home>`. The
  provider is whatever fills that layer for the home when the job runs (its
  snapshot), not something stored in the job, so the job stays valid across
  provider changes and a GUI can list and edit it without parsing argv.
  Admission, tracking and reconciliation are those of a command job: a
  launch receipt the provider answers (a harvester it spawned) is followed
  until that home is gone; the source home is never treated as a launch.
  Unobservable or still starting: skipped with the reason, delivery kept
  pending. Whether a running harness is busy cannot be seen from the
  terminal: delivery is terminal input (bracketed paste plus Enter), never an
  interrupt, never Ctrl-C, never into a stopped or starting shell. Word wake
  messages so that receiving one again is harmless.

`cron` has five fields (minute hour day month weekday) and `tz` is a
required IANA zone; both are evaluated by the croner library. `--wake-every
N` at spawn time means `*/N * * * *`: every 7 fires at :00, :07, ... :56 and
then :00 again, so 1, 5, 10, 15 and 30 give an even cadence.

## Captured execution and recurrence

A new captured command definition is explicitly versioned and chooses its
recurrence policy:

```json
{
  "id": "retained-job",
  "definitionVersion": 2,
  "recurrencePolicy": "capture",
  "kind": "command",
  "cwd": "/absolute/workspace",
  "argv": [
    "oats", "example-action", "run",
    "--deployment", "/absolute/deployment",
    "--resolution", "sha256-...",
    "--", "--provider-argument", "--json"
  ],
  "responsibleHuman": null,
  "cron": "0 * * * *",
  "tz": "UTC"
}
```

The structural wire is published as
[`execution-capsule.schema.json`](execution-capsule.schema.json); runtime
validation additionally recomputes `executionId` and checks selector/target
agreement.

`capture` requires the explicit deployment/resolution selector pair and
`--json` in the **saved argv**. The scheduler never appends an unrecorded
protocol argument to a captured target. Adding or updating the definition derives an immutable
`execution` capsule containing that exact target, resolution, input references
and explicitly supplied responsible-human value. The scheduler verifies the
capsule ID and calls the exact captured-action loader before acquiring a launch
slot or invoking the CLI. The capsule is written into the attempt before the
child process runs and is retained on the result. Definition edits affect later
admissions only; an unknown attempt, `run`, or reconciliation never replaces its
capsule with the edited definition or today's config/lock. Captured attempts
carry their own `schemaVersion:1`; malformed/unknown attempt versions stay
unresolved and cannot dispatch. Scheduler launch also scrubs ambient
`OATS_DEPLOYMENT` and `OATS_RESOLUTION`; only the saved argv is authority.

`prepare-on-tick` is a distinct explicit policy for a genuinely new tick. It is
accepted for a version-2 command definition but currently reports
`migration-required` at admission because the preparation transaction adapter
is not yet available.
It never falls back to current-context command execution. Captured spawn,
operation and wake definitions likewise remain unavailable until their public
captured consumer adapters exist; capture is currently accepted only for
capability-command jobs. A wake continues to start its existing home through the
legacy lifecycle boundary in this release.

Definitions without `definitionVersion`/`recurrencePolicy` are legacy v1
definitions. They retain the old release behavior during migration and are not
reported as captured execution. `list`/`show` report their `executionStatus` as
`{kind:"legacy",capture:"unknown",migrationRequired:true}`. A captured definition
reports only `capture:"recorded"` until action admission verifies the retained
record and current exact approval; it does not claim launch readiness. When an
attempt exists, `executionStatus.attempt` separately reports captured,
legacy-unknown or invalid authority, so editing a future definition cannot hide
an older admitted capsule. Partial, malformed or unsupported versioned
definitions/attempts are invalid or blocked, never reinterpreted as legacy.

## Commands

```sh
oats schedule add <id> --file spec.json --dir <workspace> --json
oats schedule update <id> --file spec.json
oats schedule list | show <id> | enable <id> | disable <id> | remove <id>
oats schedule run <id>            # now, under the same lock and bound
oats schedule tick --dry-run      # what would run this minute, launching nothing
oats schedule reconcile <id> [--clear]   # resolve an attempt whose result was never recorded
oats schedule host install        # register this scope and install the ONE host timer (idempotent while active)
oats schedule host status | uninstall
oats spawn <agent> ... --wake-every 15 --wake-message "Anything new?"   # or --wake-file spec.json
```

Every subcommand takes `--server <id>` instead of `--dir`: it then runs on
that host, in its registered workspace, because schedules are host-owned.

`list --json` answers `{schedules: [{id, ...definition, nextRun, lastRun,
running}], scheduler: {installed, active, lastTick, maxConcurrent, ...}}`.
`active` is what the OS reports about the timer, not whether a file exists.

## What a run reports

`launched` (spawn or command returned), `blocked` (versioned execution
admission refused before a launch slot or child process), `active` (the instance is running;
a home whose retirement is pending still counts, its runtime may be alive),
`ended` (its home is gone), `stopped` (home present, nothing running: needs
attention, never removed for you), `launch-failed`, `unknown`, and for wake
jobs `delivered`, `started` or `skipped`. The kernel never claims a task
succeeded.

`blocked` includes an unavailable exact record/approval and the currently
unimplemented `prepare-on-tick` adapter. The result preserves the typed
`errorCode`; no attempt capsule or launch lock is created.

`unknown` means the launch's side effects are unconfirmed: a command timed
out or answered no envelope, an envelope named an instance the roster
cannot place, or an attempt was never recorded. The job keeps its slot and
is skipped until `oats schedule reconcile <id>`. Reconcile adopts only an
attributable receipt: a spawn job's instance is named deterministically for
its minute, a command job's only by the instance its answer named. Nothing
is inferred from file times. A command whose answer named nothing stays
unknown; check the roster and the host by hand, then
`oats schedule reconcile <id> --clear` records launch-failed and frees the
slot (or `remove --force` forgets the job).

A wake job that starts a stopped home holds a launch slot while that
runtime is starting, active, retiring or unobservable, and releases it when
the runtime is proven stopped (the session start receipt's exit marker for
that launch, or a home that no longer has a session) or the home is gone.
A persistent home that outlives its process does not keep a slot. Delivering
a message to a home that is already running takes no slot. The host tick
observes every registered scope first, then admits due jobs in one
host-wide order, least recently launched first (only an actual runtime
launch counts; a skipped or pending job keeps its place at the front), so
one frequent job in one scope cannot keep the only slot forever. An invalid
or malformed definition is reported on that job and the rest of the tick
continues.

`disable` never stops anything. `update` never touches a running instance,
and while a job holds a slot or has an unresolved attempt its complete
execution identity (including a versioned capsule), kind and target cannot
change; cron, tz and enabled can. Legacy definitions retain their narrower
compatibility behavior until migrated. A cold wake persists its slot before
the session start runs and keeps it on any start exception, whatever its code
(the kernel can refuse while recording, after the session exists); the next
observation releases it once the runtime is proven stopped or absent, one tick
at worst.
`remove` refuses while the job's instance is still tracked (`--force`
forgets the job without stopping anything). Retiring an instance removes the
wake jobs bound to its home; a wake whose home is gone otherwise stays
listed with its skipped reason.

## Wake at spawn

`oats spawn ... --wake-file <private JSON {cron, tz, message, enabled}>`
saves a wake job `wake-<instance>` bound to the new home after the spawn
succeeded. If the spawn succeeds but the save fails, the spawn result still
carries the full instance receipt, plus `wakeScheduleError` and a warning;
the instance is neither hidden nor spawned again.

## OKF v2 source jobs

The [prepared OKF v2 runtime](knowledge.md) registers **one command job per
source**, not a fleet sweep or a home-bound operation job. It runs from stable
deployment context with argv equivalent to:

```text
oats okf run-source --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
```

The descriptor and captured evidence live outside the disposable source.
Registration (including explicit harvest after source migration) idempotently
creates/verifies the definition; setup failures are reported for retry. A
pre-existing disabled job is not silently re-enabled. Command execution clears
invoking-instance identity and still passes normal capability activation/trust
gates after source retirement.

No timer is installed by registering a source or its job. An operator can
inspect or explicitly install one from deployment context:

```bash
oats okf inspect --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
oats okf setup --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
# Explicit host change; never part of a scaffold-only test:
oats okf setup --source /absolute/state/sources/UUID/source.json --install-host --soul domain-expert --json
# Definition-only disable; does not stop a worker or reconcile an executing job:
oats okf setup --source /absolute/state/sources/UUID/source.json --disable --soul domain-expert --json
```

Retirement captures/enqueues final evidence and does not synchronously remove
its job under the scheduler's host lock or wait for a model/GitHub. A drained
retired source returns empty; disable its job explicitly when appropriate.
Source no-launch guards prevent automatic model starts, and final capture of
a no-launch source disables its automatic processing. `inspect` distinguishes
job definition from actual timer activity; an absent or inactive timer is not
reported as enabled automation. The scheduler's launch/liveness receipts do not
replace OKF's processing, delivery and merge-visible acceptance receipts.
