---
name: oats-automations
description: >-
  Use when setting up or changing what an OATS workspace runs without a
  person: triggers (spawn an instance when a GitHub pull request event
  happens) and schedules (spawn, command or wake on a cron), local to one
  machine or declared in the workspace (oats-triggers/, oats-schedules/,
  runsOn, owner); installing the host timer; testing a trigger; or explaining
  why an automation did not run here. Part of the setup and config of an OATS
  workspace (oats.setup); day-to-day operation inside an instance is oats.core.
---

# Automations: triggers and schedules

The contract is `docs/schedules.md` in the installed kernel ("Kinds",
"Triggers", "Commands"). Read it before writing a definition. Two kinds:

- a **schedule** spawns an instance, runs an `oats` command or wakes an
  existing instance on a five-field cron with an explicit IANA `tz`;
- a **trigger** (kernel 0.28.0) spawns a NEW instance when a GitHub pull
  request event matches: "when EVENT, spawn SOUL with TASK, in TEAMS".

## One host timer, no daemon

A machine runs its automations through **one host timer** (a user
LaunchAgent on macOS, a `systemd --user` timer on Linux) that runs
`oats schedule tick --host` every minute. The tick evaluates what is due,
launches it through the same spawn path a person uses, records what it saw
and exits. Missed minutes are skipped, never replayed.

```bash
oats schedule host status      # is the timer installed and active on this machine?
oats schedule host install     # install it (a host change: ask the operator first)
oats schedule tick --dry-run   # what would run this minute, launching nothing
```

**Credentials reach the tick through the timer, not your shell.** The timer's
environment sets only `PATH` and `OATS_HOME_DIR`. `gh` logged in through the
keyring or its config file works; a `GH_TOKEN`/`GITHUB_TOKEN` exported in a
shell does not. `oats trigger test` reports where `gh`'s credential comes from
and warns when the timer cannot reach it.

## Local automations (this machine only)

Stored in the deployment's `oats-schedules.json`, run by this host with its
own credentials, visible to no other machine. Use them for personal or
experimental jobs.

```bash
oats schedule add <id> --file spec.json      # spawn | command | wake (the shapes: docs/schedules.md "Kinds")
oats schedule list
oats schedule enable <id>
oats schedule disable <id>
oats schedule run <id>                       # now, under the same lock
oats trigger add --file trigger.json         # or from a package template:
oats trigger add --from <package>:<template> --set repo=github.com/<org>/<repo>
oats trigger list
oats trigger test <id>                       # dry run: gh auth, repo permissions, soul resolves, teams declared, what would fire
oats trigger status <id>                     # last poll, pending events, fired keys, live instances, last error
```

`oats schedule list` counts triggers but does not list them; manage triggers
only with `oats trigger`. Removing a trigger leaves the instances it spawned
running.

### A trigger, field by field

```json
{ "id": "okf-harvest-review", "enabled": true, "kind": "trigger",
  "on": { "source": "github.pull_request", "repo": "github.com/acme/knowledge",
          "events": ["opened", "reopened", "ready_for_review"],
          "labels": ["okf-harvest"], "base": "main", "poll": "2m" },
  "spawn": { "soul": "oats.okf/knowledge-maintainer", "purpose": "review-pr-{number}",
             "task": "Review knowledge-base PR {repo}#{number}.",
             "teams": ["okf"], "harness": "claude", "model": "opus" },
  "concurrency": { "max": 2, "perKey": 1 } }
```

- **Source** `github.pull_request` is the only one: the tick polls open PRs
  with the host's `gh`. `labels` (all must be present) and `base` filter them.
  Events: `opened`, `reopened`, `ready_for_review`, `labeled`, `synchronize`.
- **Templates substitute only** `{repo} {number} {url} {event} {headSha}
  {trigger}`. A PR's title and body are untrusted and never reach the task;
  the instance reads them from GitHub.
- **Delivery is at least once.** A fired key is recorded only after a
  successful spawn, so a crash can spawn an event twice; `perKey: 1` holds the
  second until the first instance retires. The soul must tolerate a second
  run on the same event.
- **`teams`** becomes the messaging capability's `join=` for the spawn (see
  oats-teams); every label must be declared.
- The spawned instance gets the event as `OATS_TRIGGER_EVENT_FILE`, and its
  task ends with a "Triggered run" block naming it.

## Workspace automations (kernel 0.29.0)

Anything a team relies on belongs in Git, reviewed like a soul, and says
**which machine runs it** and **which GitHub account it acts as**.

```yaml
# <member repo>/oats-triggers/<id>.yaml   (or anywhere in the member: <id>.oats-trigger.yaml)
kind: oats-trigger
schemaVersion: 1
description: Review every harvest PR on the knowledge base
from: oats.okf:harvest-review          # a package template, then overrides; or a full definition
set: { repo: github.com/<org>/<repo> }
runsOn: <host name>                    # a machine's oats-local.yaml host.name
owner: github.com/<account>            # the account it acts as
```

Schedules are the same shape in `oats-schedules/` (`kind: oats-schedule`,
`run: spawn | command | wake`, `cron`, `tz`, plus `runsOn` and `owner`).

- **Discovery.** Read like souls, from confirmed members only, and named
  `<member>/<id>` (the id is `id:`, else the filename stem). Never read from
  `oats-package/`, `.git/` or `node_modules/`. A wrong `kind` is
  `E_AUTOMATION_SCHEMA`; a repeated id in one member is
  `E_AUTOMATION_DUPLICATE`.
- **Who runs it.** A host runs one only when `runsOn` is its `host.name`
  **and** its `gh` is logged in as `owner`. Otherwise it is listed with why
  not: `assigned-elsewhere`, `owner-mismatch` or `host-unnamed`. So "exactly
  one machine" is a declared fact, and consent is explicit: a machine acts for
  an account only when its operator named it and logged in as that account.
- **Opting a host out** without a commit: `automations.disabled: [<member>/<id>]`
  in that host's `oats-local.yaml`.
- **Refresh.** The tick reads a snapshot taken by `oats sync` and refreshed
  at most every 10 minutes, so a merged change reaches the host within about
  10 minutes. Run state (fired keys, the last poll) stays per host.
- **Writing one.** From 0.29.0, `oats trigger add --from <package>:<template>
  --workspace <member>` writes the file (or prints it when that repo is not
  the current checkout). Commit it by PR to that member (oats-workspace-config),
  then `oats sync`, then run `oats trigger test <member>/<id>` **on the named
  host**.

## Gotchas

- `oats trigger test` proves only the host it runs on. Run it where the
  automation runs, as the account it acts as.
- Two machines running one local trigger on the same repo each spawn an
  instance per event. For anything shared, use a workspace automation with
  `runsOn`.
- A trigger's `owner` that cannot merge (or approve) on the repo will spawn
  reviewers that cannot finish. GitHub forbids approving your own PR, so a
  reviewer bot needs its own account.
- The Desktop shows schedules in its Schedules tab; a Triggers tab (workspace
  and local) is planned for after the redesign.
