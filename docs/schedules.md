# Schedules

A schedule launches an agent, runs an oats command, or wakes an existing
instance on a cron. Definitions belong to a workspace and are committable;
execution belongs to the host that holds that workspace, so a schedule on a
registered server keeps running while your laptop sleeps.

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
- `~/.oats/schedules/registry.json` — the host registry: which workspaces
  the host ticks, `maxConcurrent` (default 1) and the tick interval. One
  host lock serializes ticks and run-now.

## Kinds

- **spawn** `{id, enabled, cron, tz, kind: "spawn", agent, repo?, backend?,
  purpose?, task, runtime?, model?, yolo?, wake?}` — every due minute
  launches one disposable instance of `agent` with the same options `oats
  spawn` takes (`repo` selects the checkout holding the soul, as `--repo`
  does). The task gets a trailing schedule block naming the job and the
  minute and ending with `oats retire --self`. An optional `wake` object
  (`{cron, tz, message}`) attaches a wake schedule to each launched instance;
  nothing is attached unless you ask.
- **command** `{id, enabled, cron, tz, kind: "command", cwd, argv}` — runs
  an oats-only argv (`argv[0]` is `oats`, no shell) in `cwd`, which must be
  inside the workspace. The runner parses the command's envelope and tracks
  any instance it names, so `["oats", "okf", "harvest"]` run in a source
  instance's home is followed until the harvester it spawned is gone.
  Command return is not task completion.
- **wake** `{id, enabled, cron, tz, kind: "wake", home, message}` — every
  due minute inspects the instance at `home` through its session receipts.
  Not running (absent, dead pane or fallback shell): the same home is started
  with `session start`, nothing is delivered that minute. Running: `message`
  is delivered once with `session input`. Unobservable or still starting:
  skipped with the reason. Whether a running harness is busy cannot be seen
  from the terminal, so the guarantee is at most one delivery per due minute,
  no replay of missed minutes, never input into a stopped or starting shell,
  never an interrupt. Word wake messages so that receiving one again is
  harmless.

`cron` has five fields (minute hour day month weekday) and `tz` is a
required IANA zone; both are evaluated by the croner library. `--wake-every
N` at spawn time means `*/N * * * *`: every 7 fires at :00, :07, ... :56 and
then :00 again, so 1, 5, 10, 15 and 30 give an even cadence.

## Commands

```sh
oats schedule add <id> --file spec.json --dir <workspace> --json
oats schedule update <id> --file spec.json
oats schedule list | show <id> | enable <id> | disable <id> | remove <id>
oats schedule run <id>            # now, under the same lock and bound
oats schedule tick --dry-run      # what would run this minute, launching nothing
oats schedule reconcile <id>      # resolve an attempt whose result was never recorded
oats schedule host install        # register this workspace and install the ONE host timer
oats schedule host status | uninstall
oats spawn <agent> ... --wake-every 15 --wake-message "Anything new?"   # or --wake-file spec.json
```

Every subcommand takes `--server <id>` instead of `--dir`: it then runs on
that host, in its registered workspace, because schedules are host-owned.

`list --json` answers `{schedules: [{id, ...definition, nextRun, lastRun,
running}], scheduler: {installed, active, lastTick, maxConcurrent, ...}}`.
`active` is what the OS reports about the timer, not whether a file exists.

## What a run reports

`launched` (spawn or command returned), `active` (the instance is running),
`ended` (its home is gone), `stopped` (home present, nothing running: needs
attention, never removed for you), `launch-failed`, `unknown` (an attempt
whose result was never recorded: the job is skipped until you `reconcile`
it), and for wake jobs `delivered`, `started` or `skipped`. The kernel never
claims a task succeeded.

`disable` never stops anything. `update` never touches a running instance.
`remove` refuses while the job's instance is still tracked (`--force`
forgets the job without stopping anything). Retiring an instance forgets the
wake jobs bound to its home.

## Wake at spawn

`oats spawn ... --wake-file <private JSON {cron, tz, message, enabled}>`
saves a wake job `wake-<instance>` bound to the new home after the spawn
succeeded. If the spawn succeeds but the save fails, the spawn result still
carries the full instance receipt, plus `wakeScheduleError` and a warning;
the instance is neither hidden nor spawned again.
