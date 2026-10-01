# Knowledge

The **knowledge slot** gives a working soul durable, reviewed expertise:
decisions and their rationale, rejected alternatives, discovered limits. The
kernel owns the slot, its configuration and command dispatch; the capability
that fills it owns the format, the instructions and how knowledge is promoted.
The model is in [Knowledge, instances and evolving expertise](knowledge-theory.md).

This page is the operator guide for the default filler, the `oats.okf` package.
Its runtime internals (custody, publication, locks) are in the
[oats-okf README](https://github.com/awebai/oats-okf).

| Surface | What it holds |
|---|---|
| Accepted bases (Git or directory) | Soul knowledge: OKF concepts in nodes, each node owned by one soul. |
| `souls/<name>/okf.json` | The nodes the soul owns and reads. |
| Instance home: `STATE.md`, `log.md`, `notes/` | Instance knowledge. |
| The bindings file and its `stateDir` | Where each base lives on this machine; durable harvest evidence. |

## Setup

### Pin and select the package

The workspace pins the package and fills the slot for every soul by default:

```yaml
# oats-workspace.yaml (excerpt)
packages:
  oats.okf: v4.0.5
defaults:
  knowledge: { oats.okf: { from: package } }
stores:
  org: git:github.com/acme/knowledge
```

- `oats sync` locks the pin. `oats spawn <soul> --preview --json` shows the
  module a soul resolves and its merged `settings.oats.okf`.
- A soul without knowledge says `knowledge: none`.
- `stores:` names the workspace's knowledge repositories; the kernel validates
  them as repo refs. oats.okf does not read `stores:`: the bindings file says
  where each base lives.

Each machine points the package at its bindings file in `oats-local.yaml`:

```yaml
# oats-local.yaml (excerpt)
settings:
  oats.okf:
    bindings-file: /Users/ana/.oats/okf-bindings.json
    state-dir: /Users/ana/.oats/okf
```

### Bindings document

Capability-owned JSON at an absolute path; relative paths inside it resolve
from its own directory:

```json
{
  "version": 1,
  "stateDir": "../durable-okf-state",
  "cron": "*/15 * * * *",
  "tz": "UTC",
  "bases": {
    "project": {
      "id": "project-knowledge",
      "kind": "git",
      "repository": "https://github.com/example/project.git",
      "root": "knowledge",
      "acceptedBranch": "main",
      "pr": { "repository": "example/project" }
    },
    "team": { "id": "team-knowledge", "kind": "directory", "path": "../team-knowledge" }
  }
}
```

- **The `id` must match the base.** The alias (`project`) is yours, and souls'
  `okf.json` names it. The `id` must equal the `id` in the base's
  `okf-base.json` at its root (here `knowledge/okf-base.json`), or every read
  of that base fails with `E_BASE` ("base identity/nodes mismatch").
- **Git bases** (HTTPS, SSH or a durable local repository; `root: "."` for a
  dedicated repository) are delivered to only by same-repository PR, through
  `git` and `gh`. A URL with embedded credentials is refused.
- **Directory bases** need no Git and must not sit inside a Git working tree.
- **Paths** are physical and nonoverlapping: state outside every base and
  instance home, the bindings file outside state and bases.
- `stateDir` holds per-source evidence and the consult cache; `cron` and `tz`
  schedule each source's harvest job (defaults shown).
- Every base must be usable at spawn: one bad base blocks every knowledge-slot
  spawn on the machine, and the error names its alias.

### Settings

`oats.okf` declares seven settings; the harvester capability declares one.

| Setting | Default | Meaning |
|---|---|---|
| `bindings-file` | none (required) | Absolute path of the bindings document. |
| `state-dir` | none | Absolute path; required by the package's readiness check. Evidence lives at the bindings `stateDir`. |
| `harvest` | `off` | The harvest switch, a host setting ([below](#the-harvest-switch)). |
| `harvest-runtime` | `pi` | The harvester's harness: `pi`, `claude` or `codex`. |
| `harvest-model` | the harness default | A model pin for the harvester. |
| `git-timeout` | `600` | Seconds for each remote Git operation. |
| `consult-max-age` | `300` | Seconds a cached accepted commit may age before a consult refetches; `0` always refetches. |
| `harvester-max-age` (`oats.okf-harvest`) | `7d` | How long a harvester waits for its PR before it retires. |

Host facts go in `oats-local.yaml` `settings.oats.okf`; a soul's `knowledge:`
payload carries only what is true of all its instances, such as
`harvest-runtime` or the harvest opt-out.

## The soul's okf.json

Each soul that uses oats.okf has an `okf.json` beside its `soul.yaml`:

```json
{ "version": 1, "owner": "domain-expert", "owns": ["project/expert"], "reads": ["project/steward", "team/operations"] }
```

- `owner` is the soul's stable owner ID, which the base's `okf-base.json`
  names as the owner of each of its nodes.
- `owns` lists the `alias/node` destinations the harvester may write; `reads`
  lists the nodes the soul consults first. **Neither is an access control
  list:** every configured base is readable.
- A missing `okf.json`, base metadata or index fails the spawn; nothing is
  bootstrapped empty. A legacy `soul/knowledge/` fails it with a migration
  diagnostic.

`oats okf init` creates a base ([operator commands](#operator-level-commands)):
a directory base directly (`--confirm`), a Git base as a proposal (`--output`)
that you merge through a PR.

## The harvest switch

Harvest is off unless the **host** switches it on:

| Where | Setting | Effect |
|---|---|---|
| `oats-local.yaml` | `settings.oats.okf.harvest: on` (default `off`) | This host harvests the working souls it spawns. |
| `soul.yaml` | `knowledge: { harvest: off }` | This soul is never harvested. The opt-out is absolute. |

- A soul can only opt out. A soul's `harvest: on` is ignored with a warning,
  and keeps that soul off until the line is removed. An unreadable opt-out
  counts as off.
- **Off means no capture at all:** no source, custody or schedule, and no
  final capture at retire. A manual `oats okf harvest` answers
  `E_HARVEST_OFF`. Consultation works either way.
- On applies to new spawns. Off (host or soul) stops capture at a source's
  next scheduled run; evidence already in custody stays.
- `oats okf setup --harvest on|off` writes the host setting;
  `oats okf harvest-status` reports the effective value, the row that decided
  it and the registered sources.

## Knowledge operations

The rationale is in the
[knowledge-operations design record](design/2026-09-26-okf-knowledge-operations.md).

### The flow

1. **Consult.** A working instance reads its soul's bases remotely at their
   accepted state (no local copy): at task start, after compaction and before
   decisions. It keeps its own `STATE.md`, `log.md` and `notes/`, and never
   writes accepted knowledge (an instruction boundary, not a sandbox).
2. **Capture** (harvest on). Spawn registers a durable source outside the home
   and a scheduler job, `okf-<source id>`. Each job run, and the final capture
   at retire, copies notes and bounded transcript windows into custody.
   Retire never waits for judgment or GitHub.
3. **Harvest.** The job spawns the package soul `oats.okf/knowledge-harvester`
   (harness from `harvest-runtime`). It judges the input, edits only the
   source's owned nodes and delivers: for a Git base, a PR labelled
   `okf-harvest` with a fenced `okf-harvest` provenance block. It stays until
   the PR is merged or closed and never closes it. A directory base gets a
   journalled publication instead.
4. **Review.** A trigger spawns a new `oats.okf/knowledge-maintainer` per
   harvest PR. It records a verdict (`merge`, `amend+merge`,
   `request-changes` or `close`), merges with the host's `gh` and tells the
   harvester. A PR that would supersede a human-accepted decision gets
   `okf-needs-human` and waits for a human.

The promotion test is in
[What deserves to become knowledge](knowledge-theory.md#what-deserves-to-become-knowledge).
Both package souls hold `knowledge: none`, so nothing harvests them. They
message each other through the messaging capability, in the deployment's
default team.

### Triggers

- **Source jobs** run from the deployment and outlive the source instance.
  Registration never installs a host timer: `oats schedule host install` is
  an explicit step. A drained, retired source's job is removed.
  `oats schedule disable okf-<source id>` brakes one source; it is not the
  switch. See [Knowledge harvest jobs](schedules.md#knowledge-harvest-jobs).
- **The review trigger** comes from the package template
  `oats.okf:harvest-review`: one workspace file
  (`oats-triggers/okf-harvest-review.yaml`, `runsOn` the host, `owner` a
  GitHub account that can merge on the knowledge-base repo), or
  `oats trigger add --from oats.okf:harvest-review --set repo=github.com/<owner>/<repo>`
  on one machine. It is independent of the harvest switch. See
  [Triggers](schedules.md#triggers) and
  [Workspace triggers and schedules](schedules.md#workspace-triggers-and-schedules).

The setup procedure is the `okf-trigger-setup` skill. Keep harvest off until
its `oats trigger test` passes.

### Who gets which okf skills

| Capability | Composed into | Skills | Inject |
|---|---|---|---|
| `oats.okf` | every working soul it serves | [`okf-consultation`](../mirrors/oats-okf/skills/okf-consultation/SKILL.md), [`okf-instance-knowledge`](../mirrors/oats-okf/skills/okf-instance-knowledge/SKILL.md) | Consult soul and instance knowledge; capture with judgment. |
| `oats.okf-harvest` | `oats.okf/knowledge-harvester` | `knowledge-theory`, [`knowledge-harvest`](../mirrors/oats-okf-harvest/skills/knowledge-harvest/SKILL.md), `okf-authoring` | A judge; its staged roots are its only write surface. |
| `oats.okf-maintenance` | `oats.okf/knowledge-maintainer` | `knowledge-theory`, [`knowledge-review`](../mirrors/oats-okf-maintenance/skills/knowledge-review/SKILL.md), `okf-authoring`, [`okf-trigger-setup`](../mirrors/oats-okf-maintenance/skills/okf-trigger-setup/SKILL.md) | One PR per instance; never supersede silently. |

Working souls get no promotion doctrine: only the harvester judges and only
the maintainer merges. `knowledge-theory` and `okf-authoring` ship as
identical copies in both role capabilities.

## Inspection and operator commands

- **From an instance home**, `oats okf …` runs the home's copy of the module
  with the settings recorded at spawn.
- **From the deployment directory** (holding `oats-local.yaml`), in a shell
  where neither `OATS_INSTANCE_HOME` nor `OATS_HOME` is set (either one pins
  the command to that instance home), every capability command needs
  `--soul <name>` (`E_BAD_ARGS` without it). Inside an instance home, a
  `--soul` naming another soul is refused (`E_HOME_MISMATCH`). The kernel resolves the
  soul as a spawn would, fetches its module at the locked commit into
  `<deployment>/.oats/modules/` and runs it with the soul's merged settings
  and `OATS_SOUL`, the soul's source at that commit.
  An unlocked package is `E_PACKAGE_MISSING` until `oats sync`.

### Consult

Consult commands read the accepted state, never an open PR. All take `--json`
and `--fresh` (refetch the accepted branch now):

```bash
oats okf bases                        # accepted commit or digest, freshness, validity
oats okf index [--base ALIAS] [NODE]  # owned, then read, nodes' indexes
oats okf cat --base project /expert/decisions/retry-policy.md [--from PATH]
oats okf ls --base project /expert/lessons
oats okf links --base project /expert/decisions/retry-policy.md
oats okf search backoff [--base ALIAS | --all] [--node NODE] [--regex] [--case-sensitive]
```

- They run from an instance home, or from the deployment with `--soul NAME`
  and `--home PATH` or `--source FILE` (the source form works after the
  instance retired).
- `/node/x.md` is rooted in the base; paths never leave it. A failed fetch
  serves the cached commit with `stale: true`.
- `oats okf read` and `refresh` answer `E_REMOVED`: use `cat` and `index`.
- `okf-consultation` teaches navigation, search and citation.

### Inspect

```bash
oats okf inspect --home /absolute/instance-home --soul domain-expert --json
oats okf inspect --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
oats okf harvest-status --soul domain-expert --json
```

`inspect` is read-only: frozen `owns`, `reads` and bases, the accepted
resolution registered at spawn, durable receipts (capture, processing,
delivery, acceptance) and scheduler health. A live home adds `STATE.md`,
`log.md` and pending notes (256 KiB preview each, `truncated: true` beyond);
a retired home shows durable records only; a harvest-off home shows its
declaration, bases and working memory. `oats operation run knowledge:inspect
--home PATH --json` is the same view through the generic operation interface.

### Operator-level commands

Run these from the deployment with `--soul <name>`:

| Command | Purpose |
|---|---|
| `setup --harvest on\|off` | Write `settings.oats.okf.harvest` in `oats-local.yaml`. |
| `setup --source FILE [--enable \| --disable] [--install-host]` | Verify, toggle or host-install a source's job. |
| `run-source --source FILE [--manual] [--no-launch]` | Run a source's job by hand; `--no-launch` stops at a scaffold. |
| `init --base ALIAS --nodes FILE (--confirm \| --output PATH)` | Provision a directory base or stage a Git proposal. |
| `migrate …` | Move a legacy `soul/knowledge/` into a base. |
| `unlock --lock PATH --token TOKEN` | Release a directory-base lock of a dead local process. |

From an instance home, `oats okf harvest [--no-launch]` captures now and
requests a harvester.

### Completion and recovery

The harvester completes its run with `oats okf-harvest complete`, which calls
the source's `oats okf complete`. The operator forms are for recovery:

```bash
oats okf complete --source /absolute/state/sources/UUID/source.json --run RUN_UUID [--judgment FILE] --soul domain-expert --json
oats okf retry --source /absolute/state/sources/UUID/source.json [--launch | --rejudge | --run ID --rejudge | --adopt-home PATH] --soul domain-expert --json
```

`retry` never discards an uncertain delivery; `--rejudge` keeps old proposals
and refreshes only unresolved destinations. After a PR merges, `complete` for
the run without `--judgment` records acceptance. Never remove a pending
directory journal to force progress. Exact recovery, adoption and migration
procedures are in the
[oats-okf README](https://github.com/awebai/oats-okf#independent-worker-and-completion).

## Without a knowledge capability

`knowledge: none`, on a soul or as the workspace default, is valid: no OKF
state, instructions or harvest source. Another capability may fill the slot
with its own model ([authoring guide](knowledge-capability-authoring.md)).
Switching slots migrates and erases nothing.
