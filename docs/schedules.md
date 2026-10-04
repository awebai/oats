# Schedules

A schedule launches an agent, runs an oats command, or wakes an existing
instance on a cron. A [trigger](#triggers) spawns an agent when a GitHub pull
request event matches. Both are defined at one of two levels:

- **In the workspace**: a YAML file committed in a member repository, shared
  through Git, addressed `<member>/<id>`, and run only on the host its
  `runsOn` names. See [Workspace triggers and schedules](#workspace-triggers-and-schedules).
- **Locally**: in `<deployment>/oats-schedules.json`, addressed `local/<id>`
  (or the bare `<id>`). This file belongs to one machine, like the
  `oats-local.yaml` beside it: its definitions name absolute paths on that
  machine, and only that machine runs them.

The deployment is the directory holding `oats-local.yaml`, found walking up
from the current directory or `--dir` ([configuration.md](configuration.md#the-deployment-directory));
with none in reach, the commands answer `E_LOCAL_MISSING`. Every command run
inside the deployment, including from an instance home, sees the same
definitions.

There is no daemon. One host timer (a launchd user agent on macOS, a systemd
user timer on Linux) runs `oats schedule tick --host` once a minute. The tick
evaluates only the current minute, launches what is due through the same
`spawn`, `session start` and `session input` paths you use by hand, polls the
triggers that are due, records what it observed, and exits. Minutes missed
while the machine slept are skipped, never replayed; there are no retries and
no queue. A schedule on a registered server keeps running while your laptop
sleeps.

The design is in the
[knowledge-operations design record](design/2026-09-26-okf-knowledge-operations.md#23-triggers)
(§2.3 and §2.3a).

## Files

| File | Holds |
| --- | --- |
| `<deployment>/oats-schedules.json` | This machine's local definitions, `{version: 1, jobs: {<id>: …}}`, local triggers included (`kind: "trigger"`). |
| `<deployment>/.agents/automations/snapshot.json` | The workspace definitions discovered from the members. |
| `<deployment>/.agents/schedules/` | Run state: `state.json` (last minute and recent runs per job), `triggers.json` (polls, pending events, fired keys) and one lock directory per running job. |
| `~/.oats/schedules/registry.json` | The deployments this host ticks, `maxConcurrent` (absent: default 5 running scheduled jobs) and `triggersMaxConcurrent` (absent: no host cap on trigger-spawned live instances). The two caps are separate. |

One host lock serializes ticks, run-now, reconcile and remove. It is never
reclaimed by another process: a lock whose owner is gone is reported with the
directory to remove.

## Kinds

Every definition carries `id`, `enabled`, `cron`, `tz` and `kind`. `cron` has
five fields (minute hour day month weekday) and `tz` is a required IANA zone;
both are evaluated by the croner library. Schedule IDs use lowercase letters,
digits and dashes, from 1 to 100 characters. Spawn schedules with a long ID
need an explicit shorter `purpose` to fit the instance-name limit below.

Any kind may carry `description`: what the job is for, in words, for the
people reading `oats schedule list`, `show` and the Desktop. It is one line of
1 to 200 characters with no control characters (no CR, LF, TAB or any other
C0 or C1 character, nor a Unicode line or paragraph separator); anything else
is `E_SCHEDULE_INVALID` with `field: "description"`. It is stored as given and
is informational only: it never reaches a run's argv, environment, task or
reconcile. A capability that registers jobs (knowledge harvest's `run-source`
jobs) sets it so that its command jobs can be told apart.

- **spawn** `{…, agent, agentsRoot?, repo?, backend?, purpose?, task,
  launchConfig?, harness?, model?, yolo?, wake?}` — every due minute launches
  one disposable instance of `agent` with the options `oats spawn` takes.
  `agentsRoot`, when given, must be the deployment's `agents/` root; `repo`
  is the work repository, as `--repo`. `backend` is `tmux`; `backend: herdr`
  is refused (`E_HERDR_REMOVED`, naming the file and key: Herdr was removed in
  0.31.0), and a stored job that names it is reported invalid and never runs.
  `model` is a model id (a letter or
  digit, then letters, digits and `. _ : / @ + - [ ]`, at most 128
  characters) or `@native-default`; `agent` and `repo` never start with `-`,
  so no value can be read as an option of the child `oats spawn`. Each run is
  named `<agent>-<purpose or id>-<YYYYMMDDHHMM>`, at most 64 characters (a
  longer one is refused when saved, `E_SCHEDULE_INVALID`). The task gets a
  trailing block naming the job and the minute and ending with `oats retire
  --self`. `wake` (`{cron, tz, message}`) attaches a wake schedule to each
  launched instance.
- **command** `{…, cwd, argv}` — runs an oats-only argv (`argv[0]` is `oats`,
  no shell; `oats schedule` itself is refused) in `cwd`, an existing directory
  inside the deployment. The runner tracks any instance the command's
  envelope names, including an independent worker it reports, until its home
  is gone. A command's return is not task completion. Command/operation runs and
  workspace-spawn launches have a five-minute child timeout. The supervisor
  sends SIGTERM to the child's process group, allows two seconds for cleanup,
  then sends SIGKILL if the group remains. It observes the direct child's exit
  before returning; inherited output pipes cannot hold the tick indefinitely.
  SIGINT, SIGTERM or SIGHUP received by the supervisor enters that same cleanup
  once; repeated signals do not bypass it. A timeout or interrupted supervisor
  leaves effects unconfirmed even if the child printed an envelope. Spawn
  previews use the same bounded runner.

  Cleanup covers the owned process group. A descendant that creates its own
  session can escape it; inherited pipes are bounded but that escaped process
  is not terminated by this group cleanup. The supervisor checks the group when
  the leader exits and never signals it after observing it empty. This reduces
  the group-ID reuse window; it does not eliminate PID reuse races. SIGKILL,
  OOM and other unrecoverable supervisor deaths cannot run JavaScript handlers:
  cleanup is not guaranteed then. Without a private supervisor receipt, the
  scheduler keeps the unknown attempt and its slot until reconciliation.
- **wake** `{…, home, message}` — every due minute inspects the instance at
  `home`. Running: `message` is delivered once as terminal input (bracketed
  paste plus Enter), never an interrupt. Not running: the home is started with
  `session start` and the message becomes the job's one pending delivery,
  completed on a later tick once the session is active; the home is started
  again only at due minutes, so a harness that keeps exiting is not restarted
  in a loop. Unobservable or still starting: skipped, delivery kept pending.
  Word wake messages so that receiving one again is harmless.
- **operation** `{…, operation, home}` — runs a provider operation such as
  `knowledge:harvest` in the instance at `home` through `oats operation run
  <layer>:<name> --home <home>`. The provider is whatever fills that layer
  when the job runs. Tracking is that of a command job.

`--wake-every N` at spawn time means `*/N * * * *`: every 7 fires at :00, :07,
… :56 and then :00 again, so 1, 5, 10, 15 and 30 give an even cadence.

## Triggers

A **trigger** is an event-driven spawn: "when EVENT matches, spawn a NEW
instance of SOUL with TASK". It is managed with `oats trigger …` (`oats
schedule …` neither lists nor edits one) and evaluated by the same host tick.
There is no webhook. It runs only on the host that holds it, with **that
host's own credentials**; a definition carries none.

The host timer runs the tick with its own environment (only `PATH` and
`OATS_HOME_DIR`): `gh` logged in with the keyring or its config file works
there, but a `GH_TOKEN` exported in your shell does not. `oats trigger test`
reports `gh.credentialSource` (`keyring`, `config`, `env:<VAR>`) and warns
when the timer cannot reach it.

```json
{ "id": "okf-harvest-review", "enabled": true, "kind": "trigger",
  "on": { "source": "github.pull_request", "repo": "github.com/acme/knowledge",
          "events": ["opened", "reopened", "ready_for_review"],
          "labels": ["okf-harvest"], "base": "main", "poll": "2m" },
  "spawn": { "soul": "oats.okf/knowledge-maintainer", "purpose": "review-pr-{number}",
             "task": "Review knowledge-base PR {repo}#{number}. Load knowledge-review first.",
             "harness": "claude", "model": "opus" },
  "concurrency": { "max": 2, "perKey": 1 } }
```

- **Source.** `github.pull_request` is the only source. The tick polls the
  repository's open pull requests with the host's `gh` (`gh api
  repos/<owner>/<repo>/pulls`, `state=open`, most recently updated first)
  every `poll` (default `2m`, at least `1m`). `labels` (all must be present)
  and `base` filter them. A repo is `github.com/<owner>/<repo>`; another host
  is passed to `gh` as `--hostname`.
- **Events** are inferred poll over poll: `opened` (a PR first seen, not a
  draft; the first poll sees every open PR), `reopened` (seen closed, open
  again), `ready_for_review` (was a draft), `labeled` (now carries the filter
  labels it lacked; without a filter, any new label) and `synchronize` (a new
  head commit).
- **Dedup, at least once.** Each event has a key
  `<trigger>:<repo>#<number>:<event>:<stamp>` (`created_at` for `opened`, the
  head SHA for `synchronize`, `updated_at` otherwise), recorded as fired
  **only after a successful spawn**. Until then the event stays pending, is
  retried at every poll, and is dropped when its PR closes. A tick that dies
  between the spawn and the record spawns the event again on the next poll
  (held by `perKey` while the first instance lives), so a trigger's soul
  should tolerate a second run on the same event.
- **Concurrency.** `max` (default 1) bounds the trigger's live instances and
  `perKey` (default 1) those of one PR, counted from the homes'
  `instance.json.trigger` records; a retired instance frees its slot. An event
  over a bound stays pending (`held`). A newer push supersedes a pending
  `synchronize` for an older head of the same PR.
- **The spawn** is `oats spawn`. `soul` is bare or qualified
  (`<package>/<soul>`). `purpose` (default `{trigger}-{number}`) and `task`
  are templated from **only** `{repo} {number} {url} {event} {headSha}
  {trigger}`: a pull request's title and body are untrusted and never reach
  the task. `teams` (optional) becomes the messaging capability's `join=`
  setting (`E_TRIGGER_TEAMS` when the soul has no messaging capability).
  `launchConfig`, `harness`, `model`, `yolo` and `backend` are as for
  schedules.
- **The event reaches the instance** as `OATS_TRIGGER_EVENT_FILE`
  (`<home>/.oats/trigger-event.json`: `{ trigger, source, repo, number, url,
  event, headSha, labels, observedAt, key }`), given to the spawn hooks and the
  harness, and is recorded in `instance.json.trigger`.

```sh
oats trigger add --file trigger.json                 # or:
oats trigger add --from oats.okf:harvest-review --set repo=github.com/acme/knowledge [--id <id>]
oats trigger list | show <id> | enable <id> | disable <id> | remove <id>
oats trigger test <id>      # dry run: gh credentials, repo permissions, the soul, what WOULD fire
oats trigger status [<id>]  # last poll, next due, pending and fired events, live vs max, last error
```

All take `--dir` and `--json` (`triggerApi: 1`). `remove` leaves the instances
it spawned running. `oats schedule list` does not list triggers but counts
them (`triggers: { count, command: "oats trigger list" }`, and a line in text
mode). Errors: `E_TRIGGER_INVALID { field }`, `E_TRIGGER_EXISTS`,
`E_TRIGGER_UNKNOWN`, `E_TRIGGER_TEAMS`, `E_BAD_ARGS`.

**Package trigger templates.** A package may declare `triggers: [{ id, file }]`
in `oats-package.json`, each file `{ parameters: { <name>: { path, required?,
default?, description? } }, definition }`. `oats trigger add --from
<package>:<id>` reads it at the locked commit, and `--set <name>=<value>`
fills a parameter at its dotted `path` (a list value is comma-separated; a
missing required one is `E_BAD_ARGS { missing }`). See
[packages.md](packages.md#trigger-templates).

## Workspace triggers and schedules

Anything a team relies on belongs in a confirmed member repository, shared
through Git and addressed `<member>/<id>`. The two kinds stay separate: each
has its own folder, file kind, ids, commands, list and opt-out.

| | trigger | schedule |
| --- | --- | --- |
| canonical folder (at the member's root) | `oats-triggers/` | `oats-schedules/` |
| file name anywhere in the member | `*.oats-trigger.yaml` | `*.oats-schedule.yaml` |
| `kind:` | `oats-trigger` | `oats-schedule` |
| body | `from:` + `set:` (a package template), or `on`, `spawn`, `concurrency` as above | `run: spawn \| command`, `cron`, `tz`, `agent`, `task`, `purpose`, `launchConfig`, `harness`, `model`, `yolo`, `backend`, `wake`, `argv`, `cwd` |
| opt-out on this host | `triggers.disabled` | `schedules.disabled` |

Every `.yaml`/`.yml` under a canonical folder is a candidate, and so is a file
with the kind's suffix anywhere in the member (`.yml` works too), for example
`services/billing/nightly.oats-schedule.yaml` beside the code it concerns.
`oats-package/`, `.git/` and `node_modules/` are never scanned.

```yaml
# <member>/oats-triggers/okf-harvest-review.yaml
kind: oats-trigger
schemaVersion: 1
description: Review every harvest PR on the knowledge base
from: oats.okf:harvest-review        # a package template at the locked commit, then its parameters
set: { repo: github.com/acme/knowledge }
runsOn: kb-bot-server                # the host.name that runs it
owner: github.com/acme-kb-bot        # the GitHub account it acts as
```

```yaml
# <member>/services/billing/nightly.oats-schedule.yaml
kind: oats-schedule
schemaVersion: 1
run: spawn
cron: "0 7 * * *"
tz: Europe/Madrid
agent: digest-writer                 # resolved like `oats spawn <soul>` (member or package soul)
task: Write the nightly digest.
runsOn: ana-laptop
owner: github.com/ana
```

- **The header.** Every file carries `kind` and `schemaVersion: 1`, plus
  `runsOn` and `owner`, and optionally `id`, `description` and `enabled`. A
  candidate of the wrong kind (a schedule in `oats-triggers/`) or without one
  is an `E_AUTOMATION_SCHEMA` problem, never silently skipped.
- **The id** is `id:`, else the filename stem. The same id twice in one member
  for one kind is `E_AUTOMATION_DUPLICATE`, naming both paths; the second file
  is not listed. Schedule IDs allow 1 to 100 lowercase letters, digits and dashes; trigger
  IDs allow 1 to 40. A trigger and a schedule may share an id. A member named
  `local` is refused, because `local/<id>` names this host's own definitions.
- **A workspace schedule is `run: spawn` or `run: command`.** A command's
  `cwd` is relative to the deployment and must stay inside it. `wake` and
  `operation` target an instance home on one machine, so they stay local.
- **A workspace trigger's `owner` and `on.repo` must be on the same GitHub
  host** (`E_TRIGGER_INVALID`, field `owner`).

**Who runs it.** A host runs a workspace trigger or schedule only when all
three hold:

1. its `runsOn` is this host's `host.name` in `oats-local.yaml`;
2. the host's authenticated `gh` account (`gh api user`, asked once per tick)
   is its `owner`;
3. this host's `oats-local.yaml` trusts it (0.30):

   ```yaml
   automations:
     trust:
       - agents/pr-review    # <member>/<id>, as the list names it
   # or  trust: "*"          # every automation the workspace places on this host
   ```

Otherwise the item is listed with a reason: `assigned-elsewhere`,
`owner-mismatch` (this host is named, but its `gh` is logged in as someone
else or not at all), `host-unnamed`, or `untrusted` (placed here but not
trusted: it never runs, and `oats workspace status` warns with the exact
line to add). Both names come from a commit, so anyone who can commit to a
member could name your host; trust is the operator's own yes. A trust entry
that names no workspace automation is a warning (`automation-trust-stale`),
not an error: its member may not have synced yet. Your own `oats trigger
add` / `oats schedule add` definitions need no trust.

**Opting out on one host.** `oats trigger disable <member>/<id>` writes
`triggers.disabled`, and `oats schedule disable <member>/<id>` writes
`schedules.disabled`, in `oats-local.yaml`; `enable` removes the entry. The
schedule part of a qualified ID accepts up to 100 characters in both
`schedules.disabled` and named `automations.trust` entries. Trigger definitions
and `triggers.disabled` keep their 40-character limit; the shared trust list
does not widen trigger IDs. A workspace definition is never edited or removed
from the CLI (`update` and `remove` answer `E_AUTOMATION_WORKSPACE`): change the file in Git.

**Refresh.**

- `oats sync` (or `oats automations refresh`) discovers the confirmed
  members' definitions into `.agents/automations/snapshot.json`. A trigger
  template (`from:`) is instantiated then, at the commit the lock pins.
- The host tick refreshes the snapshot when it is more than ten minutes old;
  when a refresh fails, the last good snapshot keeps serving. A change in Git
  reaches the named host within about ten minutes.
- Run state stays local to each host; a workspace schedule's lock and state
  are keyed `<member>~<id>`.

**Writing one.** `oats trigger add` or `oats schedule add` with `--workspace
<member> --runs-on <host> --owner <host>/<login>` validates the file, then
writes `oats-triggers/<id>.yaml` or `oats-schedules/<id>.yaml` inside a
checkout of that member (for you to commit and push), or prints it anywhere
else. `oats trigger test <member>/<id>` and `oats schedule test <member>/<id>`
check the placement and everything else on this host.

## Commands

```sh
oats schedule add <id> --file spec.json [--dir <deployment>] [--json]
oats schedule update <id> --file spec.json
oats schedule list | show <id> | enable <id> | disable <id> | remove <id> [--force]
oats schedule run <id> [--force]  # now, under the same lock and bound
oats schedule test <id>           # dry run: where it runs, whether its soul resolves, when it is next due
oats schedule tick [--dry-run]    # evaluate this deployment now; --dry-run launches nothing
oats schedule reconcile <id> [--clear]   # resolve an attempt whose result was never recorded
oats schedule host install        # register this deployment and install the one host timer (idempotent)
oats schedule host install --max-concurrent 3 --triggers-max-concurrent 2
oats schedule host install --max-concurrent default --triggers-max-concurrent none
oats schedule host status | uninstall
oats spawn <agent> ... --wake-every 15 --wake-message "Anything new?"   # or --wake-file spec.json
```

`<id>` is `local/<id>` (or the bare id) or `<member>/<id>`. `host uninstall`
unregisters the deployment and removes the timer once none is registered.
Every `oats schedule` subcommand takes `--server <id>` instead of `--dir` to
run on that registered server. Setting or resetting host caps remotely requires
the destination to advertise both `schedule` and `schedule-host-caps`; an older
or unknown peer is refused with `E_REMOTE_INCOMPATIBLE` before host install is
forwarded. Upgrade OATS on the destination to use these options. A remote
install without cap options retains its existing behavior.

The host allows five running scheduled jobs by default. Use `host install
--max-concurrent N` to choose a positive integer, or `--max-concurrent default`
to restore the default. `--triggers-max-concurrent N` independently limits live
trigger-spawned instances; `none` removes that cap. Omitted flags preserve the
current choices. Invalid values fail with `E_BAD_ARGS` before registration or
timer changes. `host status` reports the effective `maxConcurrent` and
`triggersMaxConcurrent` (`null` when uncapped).

The registry stores explicit choices only. Reading status or the registry takes
no registry lock and creates or rewrites no files or directories. A reader
interprets a pre-migration stored `maxConcurrent: 1` as the default of five in
memory. Registration, unregistration and cap updates persist that migration
once, under the registry lock, even if the workspace membership is unchanged.
Other explicit values and the independent trigger cap survive.

A pre-migration hand-set one is indistinguishable from the old implicit one;
both follow that compatibility choice. When a write migrates one to the default,
it prints a notice on stderr with `oats schedule host install --max-concurrent 1`
to restore one if needed. Pure reads stay silent and JSON stdout is unchanged.
A later explicit one survives writes by current kernels. Older binaries sharing
the registry can write one back while preserving `capsVersion: 2`; there is no
provenance to distinguish that from a new explicit one. Stop mixed-version
writes and explicitly set the desired cap with the supported CLI.

A present invalid `maxConcurrent` is `E_SCHEDULE_INVALID`, not a fallback to
five. Correct it with `oats schedule host install --max-concurrent N` (or
`--max-concurrent default`) from the deployment, or with `--dir <deployment>`.
An absent value still means five. Set caps through the CLI; do not edit the
registry by hand.

`oats schedule list --json` answers:

```text
{ scope, scheduleApi: 2, scheduleHistoryApi: 3,
  integrity: { sources: [{ path, status, bytes }] },
  host: { name, ghUser: { <gh host>: <login> | null } },
  schedules: [ <row> ],
  triggers: { count, command: "oats trigger list" },
  snapshot: { takenAt, problems } | null,
  scheduler: { installed, active, unit?, lastTick, maxConcurrent, triggersMaxConcurrent, tickIntervalSec,
               workspace, registered, workspaces, live } }
```

Each row is the stored definition plus `id` (bare for a local schedule,
`<member>/<id>` for a workspace one), `qualifiedId`, `description` (`null`
when there is none), `origin`, `owner`, `runsOn`, `runsHere`, `reason`,
`enabledHere`, `soul`, `nextDue`, `lastRun`, `recentRuns` and `running`; an unreadable row carries `unreadable: { code,
message }` instead of failing the list. `scheduler.active` is what the OS
reports about the timer. `oats trigger list --json` carries the same
`scheduler`. The field-level contract is in
[desktop-cli-api.md](desktop-cli-api.md).

## What a run reports

`launched` (spawn or command returned), `active` (the instance is running; a
home whose retirement is pending still counts), `ended` (its home is gone),
`stopped` (home present, nothing running: needs attention, never removed for
you), `launch-failed`, `unknown`, and for wake jobs `delivered`, `started` or
`skipped`. The kernel never claims a task succeeded.

`unknown` means the launch's side effects are unconfirmed: a command timed out
or answered no envelope, or an attempt was never recorded. The job is skipped
until `oats schedule reconcile <id>`, which adopts only an attributable
receipt (a spawn job's instance, named for its minute, or the instance a
command's answer named). When nothing is attributable, check the roster and
the host by hand, then `reconcile <id> --clear` records `launch-failed` and
frees the slot. The unresolved attempt shows in `show` as `attempt:
{scheduledFor, startedAt, error?, exited?, exitStatus?, exitSignal?}`;
`error` is the first run's cause, which later skipped ticks keep in `lastRun`.

`oats doctor` warns about each unresolved attempt, in this deployment and in
the other deployments this host ticks (they share its slots). The text form
is `! schedule-unresolved: …`; in `--json` it is a `problems[]` item:

```text
{ code: "schedule-unresolved", severity: "warning", scope, id, kind,
  scheduledFor, startedAt, ageSeconds, holdsSlot, exited, error, remedy, message }
```

`holdsSlot` says whether the job counts against `maxConcurrent`. `remedy` is
`oats schedule reconcile <id>`, with `--clear` for a command or operation
whose effects no named home proves (check the roster and the host by hand
first), and with `--dir <scope>` for another deployment. A warning never
changes doctor's exit status. Workspace command kinds come from the last
saved automations snapshot, without a refresh or an account lookup. Unresolved
workspace state is reported even if its definition is no longer available.

Whether an `unknown` job keeps its host slot depends on what is still running:

- A `command` or `operation` job whose process exit the kernel observed (it
  returned, or was stopped at the five-minute timeout) holds no slot: the
  process runs nothing any more, and an instance it spawned has its own
  lifecycle. Its attempt shows `exited: true` with the exit status or
  signal, and other jobs keep running.
- A `spawn` job keeps its slot, which stands for the instance it may have
  launched. So does a command whose exit was not observed (the runner threw,
  the process never started) and a legacy attempt without exit evidence (no `exited`), until reconcile.

**Slots.** A wake job that starts a stopped home holds a launch slot until the
harness is proven stopped or the home is gone; delivering to a running home
takes none. The host tick admits due jobs in one host-wide order, least
recently launched first, so one frequent job cannot keep the only slot
forever. An invalid definition is reported on its job; the rest of the tick
continues.

**Changing a job.** `disable` never stops anything. `update` never touches a
running instance, and while a job holds a slot or has an unresolved attempt
only `cron`, `tz`, `enabled` and `description` can change. `remove` refuses while the job's
instance is tracked or its effects are unresolved (`--force` forgets the job
without stopping anything). Retiring an instance removes the wake jobs bound
to its home.

## Wake at spawn

`oats spawn ... --wake-file <JSON {cron, tz, message, enabled}>` (or
`--wake-every N --wake-message <text>`) saves a local wake job
`wake-<instance>` bound to the new home once the spawn succeeds. If the save
fails, the spawn result still carries the instance receipt, plus
`wakeScheduleError` and a warning.

## Knowledge harvest jobs

oats.okf uses both mechanisms. The flow, the harvest switch and the package
souls are described in [knowledge.md](knowledge.md#knowledge-operations).

- **Harvest.** A source exists only where harvest is on (`oats-local.yaml`
  `settings.oats.okf.harvest: on`; default off). oats.okf then registers one
  local **command job per source**, `okf-<source id>`, which runs from the
  deployment with argv equivalent to:

  ```text
  oats okf run-source --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
  ```

  The job spawns the package soul `oats.okf/knowledge-harvester`. The source's
  evidence lives outside its home, so the job keeps working after the source
  instance retires; once a retired source is drained, oats.okf removes the
  job. Registration never re-enables a disabled job.
  `oats schedule disable okf-<source id>` is the emergency brake for one
  source.
- **Review.** Each harvest PR is reviewed by a new
  `oats.okf/knowledge-maintainer`, spawned by a trigger from the package
  template `oats.okf:harvest-review`: a workspace file
  (`oats-triggers/okf-harvest-review.yaml`) or a local `oats trigger add
  --from oats.okf:harvest-review`.

Registering a source never installs the host timer. `oats okf inspect
--source <source.json> --soul <soul>` reports the job and whether the timer is
actually active; `oats okf setup --source <source.json> --soul <soul>
--install-host` installs it, and `--disable` disables the job without
stopping a running worker. The scheduler's launch receipts do not replace
oats.okf's own processing, delivery and acceptance receipts.
