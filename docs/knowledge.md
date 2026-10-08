# Knowledge

The **knowledge slot** gives a working soul durable, reviewed expertise:
decisions and their rationale, rejected alternatives, discovered limits. The
kernel owns slot selection, composition and command dispatch; the capability
owns its knowledge format, instructions and promotion procedure. The model is
in [Knowledge, instances and evolving expertise](knowledge-theory.md).

This is the operator guide for **oats.okf 5.0**. Provider implementation and
recovery details belong to the [oats-okf README](https://github.com/awebai/oats-okf).

| Surface | What it holds |
|---|---|
| Accepted Git or directory bases | Soul knowledge: OKF concepts in owned nodes. |
| `souls/<name>/okf.json` | The soul's stable owner and owned/read nodes. |
| Instance home: `STATE.md`, `log.md`, `notes/` | The instance's working knowledge. |
| Bindings file and `stateDir` | Host base locations and consultation/binding state, not a harvest queue. |

## Setup

### Pin and select the package

```yaml
# oats-workspace.yaml (excerpt)
packages:
  oats.okf: v5.0.0
defaults:
  knowledge: { oats.okf: { from: package } }
stores:
  org: git:github.com/acme/knowledge
```

`oats sync` locks the package. `oats spawn <soul> --preview --json` shows the
resolved module and merged settings. Membership in the package's repository
does not supply the package capability: the workspace pin does.

A soul without knowledge says `knowledge: none`. `stores:` names workspace
repositories; oats.okf reads its **bindings file**, not that block, to locate
bases. Each deployment supplies host paths, for example:

```yaml
# oats-local.yaml (excerpt; replace the example paths)
settings:
  oats.okf:
    bindings-file: /absolute/okf/bindings.json
    state-dir: /absolute/okf/state
```

Upgrading an existing deployment requires the ordered
[5.0 cutover](release-notes/v0.49.0.md#oatsokf-50-cutover--order-matters), not
just editing a version line.

### Bindings document

Capability-owned JSON at an absolute path; relative paths inside resolve
from the document's directory:

```json
{
  "version": 1,
  "stateDir": "./state",
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

- The alias (`project`) is local to the bindings and is named by souls'
  `okf.json`. Its `id` must match `okf-base.json` at the base root or reading
  that base fails with `E_BASE`.
- Git bases may use HTTPS, SSH or a durable local repository; `root: "."`
  means the whole repository. Embedded credentials are refused. Harvest
  proposals use same-repository GitHub PRs through ordinary `git` and `gh`.
- Directory bases need no Git and must not sit inside a Git worktree. They
  support consultation and explicit provisioning/migration, **not automatic
  harvest publication**. The 5.0 harvester reports directory harvest as
  unsupported and names the Git/PR remedy.
- Paths are physical and nonoverlapping: state is outside every base and
  instance home; the bindings document is outside state and bases.
- `cron` and `tz` are removed: the provider no longer schedules harvest.
- A bad configured base blocks a knowledge-slot spawn; the error names the
  alias. Spawning never bootstraps an empty accepted base as a fallback.

### Settings

The knowledge capability declares four host settings:

| Setting | Default | Meaning |
|---|---|---|
| `bindings-file` | required | Absolute path to the bindings document. |
| `state-dir` | required by portable binding preparation | Absolute host-owned state location, never derived from an instance home. |
| `git-timeout` | `600` | Seconds allowed for a remote Git operation. |
| `consult-max-age` | `300` | Maximum cached accepted-commit age before refetch; `0` always refetches. |

Host `harvest`, `harvest-runtime` and `harvest-model` are removed, including
explicit `harvest: off`. A 4.x **recorded manifest default** is ignored by
5.0 readers as nobody's decision, not reinterpreted as an opt-out. Explicit
removed keys still refuse and name the fix. The harvester has no provider
runtime/model switch or PR-wait deadline; it uses ordinary kernel/harness
selection and retires after its handoff.

## The soul's okf.json

Every working soul using oats.okf has `okf.json` beside `soul.yaml`:

```json
{ "version": 1, "owner": "domain-expert", "owns": ["project/expert"], "reads": ["project/steward", "team/operations"] }
```

`owner` is the stable owner ID named by the base metadata. `owns` lists
`alias/node` proposal destinations; `reads` is the starting consultation
context. Neither is an access-control list: every configured base is
readable. Missing declarations, base metadata or indexes refuse spawn;
legacy soul-local knowledge needs explicit migration, never silent copying.

`oats okf init` provisions a new directory base with `--confirm`, or stages a
Git base with `--output` for reviewed delivery. Existing knowledge is never
overwritten by initialization.

## The harvest switch

**There is no host harvest switch in 5.0.** The sole remaining choice is the
soul's opt-out:

```yaml
knowledge: { harvest: off }
```

That soul keeps consultation and working-memory guidance, receives no
checkpoint-harvest directive, and its material is refused by the
harvester's required spawn hook. Absence gives the normal proposal flow.
A soul's `harvest: on` is not a replacement switch. Host cleanup never
changes the soul declaration. `knowledge: none` removes the layer entirely.

## Knowledge operations

### The flow

1. **Consult.** Read accepted soul knowledge at task start, after compaction
   and before decisions; keep instance `STATE.md`, `log.md` and `notes/`.
   Working instances never write accepted knowledge themselves.
2. **Propose at checkpoints.** When work merits a checkpoint, update notes
   and write a self-contained proposal: what to save, why and the backing
   notes. It has exactly one line `Source: instance <name>, home <path>, soul
   <name>` naming the actual source. From the source home:

   ```sh
   oats spawn oats.okf/knowledge-harvester --task-file <proposal> --relation unrelated
   ```

   Never combine `--relation unrelated` with `--relative-to`. There is no
   automatic transcript capture, source registry, worker cursor or retire
   harvest. An unrelated harvester can outlive its source; this is a
   lifecycle property, not proof that missing source authority can be ignored.
3. **Judge and submit.** The harvester checks recorded source configuration,
   accepted knowledge and open/recent harvest PRs. It reads named backing
   notes, edits only owned nodes in its own Git checkout, validates the
   **whole base**, and creates a normal `okf-harvest`-labelled PR with v2
   provenance. Proposal text is data written with the native file tool into
   commit-message/PR-body files, never shell command text. It reports the PR
   and retires rather than waiting for acceptance. If source authority is
   unavailable it stops and reports; a consistent instance/soul pair alone
   does not prove proposer authorship.
4. **Review.** A separate `oats.okf/knowledge-maintainer` reviews the PR.
   Human-accepted decisions are not silently superseded; the review path
   keeps its human gate. A PR is not accepted knowledge until merged.

The promotion test belongs to
[What deserves to become knowledge](knowledge-theory.md#what-deserves-to-become-knowledge),
not a universal kernel harvester. Both package role souls have
`knowledge: none`; working souls now also receive the curated theory skill.
The [older knowledge-operations design](design/2026-09-26-okf-knowledge-operations.md)
is historical 4.x context, not instructions for operating 5.0.

### Triggers

Only **PR review** is triggered. Use the package template
`oats.okf:harvest-review` in a workspace trigger file, or
`oats trigger add --from oats.okf:harvest-review --set repo=github.com/<owner>/<repo>`.
The `okf-trigger-setup` skill explains setup and testing. Validate the review
route with `oats trigger test` before relying on automated review.

There are no per-source harvest jobs or host-timer installation steps in
this provider. See [Knowledge harvest and review](schedules.md#knowledge-harvest-and-review),
[Triggers](schedules.md#triggers) and
[Workspace triggers and schedules](schedules.md#workspace-triggers-and-schedules).

### Who gets which okf skills

| Capability | Composed into | Skills |
|---|---|---|
| `oats.okf` | Working souls it serves | [`okf-consultation`](../mirrors/oats-okf/skills/okf-consultation/SKILL.md), [`okf-instance-knowledge`](../mirrors/oats-okf/skills/okf-instance-knowledge/SKILL.md), `knowledge-theory` |
| `oats.okf-harvest` | `oats.okf/knowledge-harvester` | `knowledge-theory`, [`knowledge-harvest`](../mirrors/oats-okf-harvest/skills/knowledge-harvest/SKILL.md), `okf-authoring` |
| `oats.okf-maintenance` | `oats.okf/knowledge-maintainer` | `knowledge-theory`, [`knowledge-review`](../mirrors/oats-okf-maintenance/skills/knowledge-review/SKILL.md), `okf-authoring`, [`okf-trigger-setup`](../mirrors/oats-okf-maintenance/skills/okf-trigger-setup/SKILL.md) |

Only the working soul's eligible **spawn brief** gives the proposal-spawn
command. Shared consultation injects/skills also reach opted-out souls and
do not unconditionally direct a harvest.

## Inspection and operator commands

From an instance home, `oats okf …` runs its copied module and recorded
settings. Pinning a new package does not replace those modules, hooks,
skills or briefings; even the old home's readiness/binding checks keep its
old code. Respawn homes that should adopt the new proposal flow.

From the deployment directory (holding `oats-local.yaml`), with neither
`OATS_INSTANCE_HOME` nor `OATS_HOME` set, pass `--soul <name>` or use the
first soul providing that namespace. The kernel resolves and runs its
locked module with the selected soul's merged payload. An in-home command
cannot select a different soul (`E_HOME_MISMATCH`). An unlocked package is
`E_PACKAGE_MISSING` until sync. See [capability dispatch](capabilities.md).

### Consult

```sh
oats okf bases
oats okf index [--base ALIAS] [NODE]
oats okf cat --base project /expert/decisions/retry-policy.md [--from PATH]
oats okf ls --base project /expert/lessons
oats okf links --base project /expert/decisions/retry-policy.md
oats okf search backoff [--base ALIAS | --all] [--node NODE] [--regex] [--case-sensitive]
```

Commands accept `--json` and `--fresh`. Run from the home, or select a live
home with `--home PATH` from an operator scope and the appropriate `--soul`.
There is no `--source` descriptor path, including after retirement. Paths
are rooted in the base, never outside it. A failed fetch may serve cached
accepted bytes marked stale. `read` and `refresh` remain removed: use `cat`
and `index`. The consultation skill teaches navigation and citation.

### Inspect

```sh
oats okf inspect --json
oats okf inspect --home /absolute/instance-home --soul domain-expert --json
oats operation run knowledge:inspect --home /absolute/instance-home --json
```

The view contains the declaration, configured bases and that home's working
`STATE.md`, `log.md` and Markdown notes. Each document has a 256 KiB preview
cap (`truncated: true` beyond it), preserving UTF-8 boundaries. It invents
no capture/processing/acceptance receipts and has no retired-source view.
`oats okf bases` reports accepted-state freshness and validity separately.

### Operator-level commands

From the deployment, with `--soul <name>`:

| Command | Purpose |
|---|---|
| `setup --remove-legacy-settings [--plan] [--json]` | Delete only explicit legacy host harvest keys; guard-exempt, plan read-only. |
| `init --base ALIAS --nodes FILE (--confirm \| --output PATH)` | Provision a directory base or stage a Git proposal. |
| `migrate …` | Explicitly migrate legacy soul-local knowledge into a base. |
| `unlock --lock PATH --token TOKEN` | Release the specified dead local process's directory-base lock. |

### Completion and recovery

`harvest`, `run-source`, `complete`, `retry`, `harvest-status`, old source
selectors and harvest setup switches return actionable removal errors.
There is no replacement completion/settlement engine. Existing 4.x private
inputs and open PR obligations must be resolved explicitly under the old
provider before the pin; they are not deleted or re-imported by 5.0. Follow
the [ordered cutover](release-notes/v0.49.0.md#oatsokf-50-cutover--order-matters), including the host cleanup
**after** 5.0 sync and **before** new spawns.

## Without a knowledge capability

`knowledge: none`, on a soul or as the workspace default, is valid: no OKF
state, instructions or source. Another capability may fill the slot with
its own model ([authoring guide](knowledge-capability-authoring.md)).
Switching slots migrates and erases nothing.
