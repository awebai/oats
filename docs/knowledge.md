# Knowledge — layer 2

For the canonical design, defaults and alternatives, start with
[Knowledge, instances and evolving expertise](knowledge-theory.md). This page is
an operational guide to the version-scoped OKF implementation below, not a universal
knowledge layout or learning policy. The default direction is centralised per-soul
knowledge; other capabilities may provide different procedures and placements,
including co-location, without writing into a home's read-only module copies.

Specialization is accumulated judgment: decisions and rationale, rejected
alternatives, discovered limits, and maintained context that changes what a
future instance does. It is not a second description of the code.

OATS keeps knowledge pluggable. The kernel supplies lifecycle, configuration,
trusted command dispatch and independent execution; each knowledge capability
owns its format, reader/capture instructions, judgment and delivery. The
[reference theory](knowledge-theory.md) and [authoring guide](knowledge-capability-authoring.md)
are optional author resources, not mandatory runtime policy.

> **Version scope:** this guide describes published **oats.okf 2.0.0**, requiring
> the published OATS >=0.23.0 kernel. Framework v0.23.1 integrates its catalog
> and mirror; publishing packages does not activate or deploy them automatically.
> See [release notes](release-notes/v0.23.1.md).

## What lives where

| Surface | Purpose |
|---|---|
| `soul/AGENTS.md`, `soul/skills/` | Curated specialist identity and procedures, reviewed as soul artifacts. |
| `soul/okf.json` | Stable owner ID and external `owns`/`reads` node references; no knowledge bytes. |
| External accepted bases | Durable OKF knowledge, either Git PR-only or a recoverable plain directory. |
| Instance `knowledge/` | Immutable accepted reader snapshot with `view.json` and `bases/<alias>/`. |
| Instance `STATE.md`, `log.md`, `notes/` | Rewritable task state, append-only milestones and captured insights. |
| External `stateDir` | Durable per-source evidence, frozen descriptors, runs, proposals and receipts. |
| Worker `work/` | Independent directory execution with staged bases and explicit judgment. |

The turn record is episodic evidence, not accepted expertise. OKF captures both
notes **and** attributed record content, then judges them separately from capture.
V2 never automatically edits soul skills; a procedure candidate may become an
external Playbook for separate human review.

## Acquire, bind and provision explicitly

The authoritative distribution is [awebai/oats-okf](https://github.com/awebai/oats-okf),
whose `oats-package/oats-package.json` exports exactly
`oats-package/capabilities/oats-okf/`. The framework's `capabilities/oats-okf/`
is a bundled mirror, **not a self-contained Git distribution in the npm
artifact**: npm drops the source worker's `CLAUDE.md -> AGENTS.md` symlink.
Acquire the catalog Git payload; do not install a copied npm mirror as a local
package or repair missing aliases in installed artifacts.

Under the 0.25 workspace model OKF is a **package**: pin it once in the
workspace file, let `oats sync` resolve, verify and lock it, and let every soul that
fills the knowledge slot say (or inherit) `oats.okf: { from: package }`.
Operator-level `oats okf` commands run from the deployment directory with
`--soul <name>` (an explicit `--soul` does not override an invoking instance's
saved settings — use a clean shell). The pinned version resolves through the
official catalog:

```yaml
# oats-workspace.yaml
packages:
  oats.okf: v2.1.3
defaults:
  knowledge: { oats.okf: { from: package } }

# souls/domain-expert/soul.yaml — nothing under knowledge: for oats.okf; the default fills the slot.
# What the soul owns/reads is souls/domain-expert/okf.json (below), not a soul.yaml payload.
# A soul-true binding setting is the one thing the payload may carry, e.g.:
knowledge:
  harvest-runtime: claude

# oats-local.yaml (this machine)
settings:
  oats.okf:
    bindings-file: /absolute/config/okf-bindings.json
    state-dir: /absolute/state/okf
```

```bash
oats sync                                  # resolves v2.1.3 to a commit, verifies its integrity, writes the lock
oats spawn domain-expert --preview --json  # the exact oats.okf module (package, version, commit) + settings.oats.okf (the merged payload)
```

Pinning activates nothing by itself: the soul's `okf.json` must exist and the
merged payload (soul `knowledge:` ⊕ `settings.oats.okf` ⊕ `--provider`) must be
bindable — it may carry **only** the four settings below (`bindings-file`,
`state-dir`, `harvest-runtime`, `harvest-model`); `owns`/`reads`/`root` on the
soul payload are refused by 2.1.3, not read. The lock stays exact until the
workspace bumps `packages.oats.okf`; v1 operators must plan migration before
that bump. Executable changes come with a new version, reviewed as a new pin. A
service worker need not itself fill the knowledge slot (`knowledge: none`).

### Bindings document

`bindings-file` must be an **absolute path**. Its capability-owned JSON is not a
new kernel configuration schema. Paths inside it resolve relative to the file's
directory, not the current working directory:

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
      "pr": {"repository": "example/project"}
    },
    "team": {
      "id": "team-knowledge",
      "kind": "directory",
      "path": "../team-knowledge"
    }
  }
}
```

- Git supports HTTPS, SSH and durable local repositories. `root: "."` selects
  a dedicated knowledge repository. Initial PR delivery uses same-repository
  branches with native `git`, `gh` and ordinary operator credentials. There is
  no fork-routing or direct-write fallback.
- Directory custody needs no Git, `gh`, `.git` or fabricated repository.
  A directory inside **any Git working tree**, even ignored, is rejected:
  relabeling Git custody cannot bypass review.
- Use physical, non-symlinked, nonoverlapping paths. Keep state outside bases and
  source homes/worktrees; keep the bindings file outside state and bases. Local
  Git locators must not be disposable linked worktrees. Directory lock/journal
  artifacts also must not overlap state, sources or another base.
- Settings are `bindings-file`, `state-dir` (both required, absolute host
  paths), `harvest-runtime` (`pi`, `claude`, `codex`, default `pi`), and
  optional `harvest-model` — the complete list a 2.1.3 payload may carry.
  Choose an installed, authenticated
  worker runtime independently of the source; omitted models use that runtime's
  configured default. V1 record-window settings are not v2 settings.

### Owner and base descriptors

Each persistent soul declares `soul/okf.json`:

```json
{"version":1,"owner":"domain-expert-stable-id","owns":["project/expert"],"reads":["project/steward","team/operations"]}
```

The accepted project base declares `okf-base.json`:

```json
{"version":1,"id":"project-knowledge","nodes":{"expert":{"path":"expert","owner":"domain-expert-stable-id"},"steward":{"path":"steward","owner":"steward-stable-id"}}}
```

The team base similarly declares its ID and `operations` node. Nodes are
nonoverlapping subdirectories with an `index.md` and `log.md`; each has one stable
owner. Base roots have their own index and append-only log. Stable owner IDs must
not ambiguously identify different souls within one state namespace.

`owns` identifies harvest destinations; it does not make a working instance the
author or direct maintainer of the base. `reads` selects initial context.
**Neither is an ACL.** All configured bases are discoverable/readable. Missing
bindings, owner declarations, base metadata or indexes fail required spawn rather
than silently bootstrapping empty knowledge.

Provisioning is an explicit operator action. Prepare node-map files (the
`nodes` object above, without its wrapper), then run from the **deployment
directory** (the one holding `oats-local.yaml`), naming the soul whose
`knowledge:` payload and `settings.oats.okf` the command should run with:

```bash
# New directory base: refuses an existing destination.
oats okf init --base team --nodes /absolute/config/team-nodes.json --confirm --soul domain-expert --json
# Git: writes an operator proposal, never pushes or claims acceptance.
oats okf init --base project --nodes /absolute/config/project-nodes.json --output /absolute/new-bundle-stage --soul domain-expert --json
```

These run **before any instance exists**. Outside an instance home the kernel
resolves `oats okf … --soul <name>` exactly as `oats spawn <name>` would
(discover → resolve → the soul's `oats.okf` module at its locked commit and
integrity), fetches that module into the deployment's module store
(`<deployment>/.oats/modules/oats.okf@<commit12>/`) and dispatches to that copy
with the soul's merged payload as `OATS_SETTINGS`; `--soul` is required
(`E_BAD_ARGS` names it) unless the namespace's capability is a workspace
default. It never runs "the newest instance's copy" and never a cache read the
lock does not pin (`E_PACKAGE_MISSING` until `oats sync` locks the declared
version; drifted content is `E_PACKAGE_INTEGRITY`).
*0.25.0 still answers `E_CAPABILITY_INACTIVE` here (the operator-level dispatch
lands in 0.25.1); the interim is to run the module binary directly with
`OATS_SETTINGS` and `OATS_CLI_BIN` set, as the tarball smoke does.*

Put the Git proposal at the configured root in an operator-owned checkout and
review/merge it through a PR before spawning working sources. Existing ownership
changes require an explicit reviewed operator change, not harvest. The standalone
capability includes JSON Schemas; filesystem containment, ownership and full OKF
validation remain additional runtime checks.

## Working-agent reads and capture

At session start, after compaction and on resume, read `STATE.md` and the relevant
knowledge indexes. `knowledge/view.json` identifies each base's relative path,
digest and Git accepted head. Content lives under `knowledge/bases/<alias>/`.
Follow relevant links only; do not bulk-load bases. A link `/expert/decision.md`
is rooted in **that base**, not filesystem `/`. Consult prior decisions before
re-deriving them and cite base/node/concept paths.

**Working agents never write accepted knowledge or soul knowledge.** This is an
instruction boundary, not an OS sandbox; tools still have the operator's access.
Snapshots are immutable by protocol, not live mounts. For current accepted text:

```bash
# From the source home:
oats okf read --base project --path expert/index.md --json
oats okf refresh --json
# From the deployment directory (oats-local.yaml), even after source retirement — --soul selects the resolution:
oats okf read --source /absolute/state/sources/UUID/source.json --base project --path expert/index.md --soul domain-expert --json
oats okf refresh --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
```

Home-selected commands create a new `knowledge-view-<uuid>/` in that home.
**Every `--source` read/refresh** places its view under
`<stateDir>/sources/<source-id>/views/`, even while the source is live. It never
writes a cache into the invoking repository, a retired home or a replacement
home. Results identify the actual path and provider receipts. Choose `--home`
or `--source`, not both. `read` returns full Markdown text; it has no preview cap.

A Git PR is not accepted until its merge is visible on the accepted branch.
Directory reads hold the cooperative publication lock while copying; a pending
journal blocks fresh views, not existing snapshots. All bases and references
validate before a view is published. Old views remain available; there is no
automatic garbage collection.

Working agents keep state current, append milestones and capture non-obvious
insights as Markdown notes with provenance. They are not instructed to run a
harvest after commits or taught worker mechanics. Capture should be cheap;
importance is the independent judge's decision.

## Durable evidence and retirement

Required spawn registers a random source ID outside the home; the home retains
only a pointer. The durable descriptor freezes bindings, owner destinations,
source role and allowlisted provenance, not credentials or wholesale launch
metadata. State includes:

```text
<stateDir>/owners.json
<stateDir>/sources/<uuid>/source.json
<stateDir>/sources/<uuid>/status.json
<stateDir>/sources/<uuid>/inputs/<hash>.json
<stateDir>/sources/<uuid>/runs/<uuid>/
<stateDir>/sources/<uuid>/views/
<stateDir>/migrations/<uuid>/
```

Every capture includes content-versioned **notes AND record**. Changed live notes
remain untouched. Through the supported `OATS_CLI_BIN` boundary, capture uses
native `capture --home`, then `recall --ids-only` byte metadata to plan bounded
windows before fetching full text. Full returned record text is copied into
custody, not saved as commands that still need the source home. Privacy-excluded
sessions remain excluded; raw excluded transcripts are not copied.

Final capture drains the visible backlog before certifying custody. The capture
budget is 85 seconds; timeouts, holds, skips, malformed/incomplete records or a
single turn over 1 MiB fail closed and retain the source home for retry rather
than truncate evidence. A genuinely empty record is reported honestly.
Retirement captures/enqueues; **it does not wait for a model or GitHub**.
After successful custody transfer the home may disappear while judgment and
publication continue. Unexpected disappearance leaves existing evidence usable
but reports `finalCaptureUncertified`, not fictitious final capture success.
Durable evidence has no automatic deletion.

One scheduler **command job per source** runs from stable deployment context,
using the durable descriptor and source soul selector. Dispatch remains activation
and trust gated after retirement, without inheriting another instance's identity.
Registration idempotently creates/verifies the job; setup failures are retryable,
and disabled jobs are not silently re-enabled. No host timer is installed without
explicit operator consent. See [schedules](schedules.md#okf-v2-source-jobs).

## Independent judgment and delivery

A worker uses **`work: directory`**, never an attached source tree. It stages
`work/bases/<alias>/` independently of the source branch, runtime and lifetime.
It reads durable `input.json` and `staging.json`, edits only owned staged nodes
and allowed navigation, and writes `judgment.json`. A scaffold-only request
stops before any model launch. Service agents do not register/capture themselves;
no-launch sources cannot cause scheduled model launches.

OKF's two-part promotion test is: would a future instance act differently, **and**
could it not discover this by reading the repository? Decisions and rationale,
rejected alternatives, discovered limits and owned/freshness-marked slow state
qualify. Code descriptions, task residue, secrets and verbatim third-party
messages do not. Preserve explicit human acceptance evidence instead of
re-judging accepted decisions. These are OKF choices, not kernel-wide doctrine.

Each input gets `promote`, `merge` or `drop`, a reason and actual concept paths.
Concepts cite input hashes and record turn IDs. Completion validates ownership,
base navigation/history, full OKF conformance, baseline, provenance and explicit
judgment; credential-shaped output checks do not replace human/model judgment.
Deleting a staged concept requires an explicit removal reason. Workers never
edit live notes, accepted bases or soul skills themselves.

| Provider | Successful delivery |
|---|---|
| Git | Verified content delta, real commit/push and same-repository PR through native `git`/`gh`. No force push, source-branch commit or direct fallback. Merge-visible acceptance is separate from PR delivery. |
| Directory | Durable proposal, cooperative base lock, baseline comparison, publication journal, file-by-file atomic replacement and full validation/digest receipt. Pending publication blocks fresh reads. No Git dependency. |

Directory recovery is single-host cooperative recovery, not a distributed
transaction. Multiple destinations can be partially delivered with separate
receipts. Inputs are processed only when required destinations resolve. All-drop
or no-change judgment can be successful without inventing a PR. Enqueue, worker
spawn and command exit alone are not successful learning.

## Knowledge operations

> **Version scope:** oats.okf **4.0.0** on kernel **0.29.0** (package souls,
> triggers and workspace automations). Everything above describes the 2.x runtime, which 4.0.0 keeps for
> capture, custody and delivery. The design and its decisions are in
> [the knowledge-operations plan](design/2026-09-26-okf-knowledge-operations.md).
> The setup procedure is the `oats-onboarding` skill ("Knowledge operations with
> OKF") and okf's `okf-trigger-setup`.

From 4.0.0, harvested knowledge is judged by a harvester, reviewed by a
maintainer and merged without an operator in the loop, except where a merge
would supersede a human-accepted decision.

### The flow

1. **Capture.** A working soul whose knowledge slot is `oats.okf`, on a host
   where harvest is on (below), registers a source at spawn. Capture and
   custody are as above: notes and bounded transcript windows, copied outside
   the home.
2. **Harvest.** The source's `run-source` job spawns the package soul
   `oats.okf/knowledge-harvester` (team `okf`). It reads the input in full,
   transcript windows included, and judges it with the OKF promotion
   doctrine. It stages edits on the owned nodes and opens a PR on the
   knowledge-base repo, labelled `okf-harvest`, whose body carries a fenced
   `okf-harvest` provenance block (the run, the source soul and instance, the
   owned and read nodes, the task references, the harvester's alias). It
   stays alive, answering questions in `okf`, until the PR is merged or
   closed, then retires. `harvester-max-age` (default 7d) bounds it; it never
   closes its own PR.
3. **Trigger.** The workspace declares the trigger in a member repo,
   `oats-triggers/okf-harvest-review.yaml` (`kind: oats-trigger`), from the package template
   `oats.okf:harvest-review`. It names the host that runs it (`runsOn`, that
   machine's `host.name`) and the GitHub account it acts as (`owner`, which
   must be able to merge on the knowledge-base repo). Only that host, logged
   in to `gh` as that account, polls for such PRs. For each one it spawns a
   NEW `oats.okf/knowledge-maintainer`, joining `okf`. The event reaches it as
   `OATS_TRIGGER_EVENT_FILE`. A local trigger (`oats trigger add`, this host
   only) is the machine-private alternative. Triggers are described in
   [schedules.md, "Triggers"](schedules.md#triggers).
4. **Review.** The maintainer checks out the PR and situates it: the
   provenance, the source soul's owned and read nodes, the neighbouring
   concepts, and the source's tickets when a tasks capability can read them.
   It records a verdict on the PR (`merge`, `amend+merge`, `request-changes`
   or `close`), amends what needs amending, and merges with the host's `gh`. A
   PR that would supersede a concept with human acceptance evidence is not
   merged: it is labelled `okf-needs-human` for the workspace's human. The
   maintainer tells the harvester the outcome and retires.

### Who gets which okf skills

| Capability | Composed into | Skills | Inject |
|---|---|---|---|
| `oats.okf` | every working soul whose knowledge slot it fills | `okf-consultation` (reading soul knowledge and citing it); `okf-instance-knowledge` (what instance knowledge is worth capturing, and the form of `STATE.md`, `log.md` and `notes/`) | the work mode: consult instance memory and soul knowledge at task start, after compaction and before decisions; capture before compaction |
| `oats.okf-harvest` | `oats.okf/knowledge-harvester` only | `knowledge-theory` (the OKF promotion doctrine); `knowledge-harvest` (the procedure, through the PR's lifetime); `okf-authoring` | the harvester's: a judge, not a worker; the staged roots are its only write surface |
| `oats.okf-maintenance` | `oats.okf/knowledge-maintainer` only | `knowledge-theory`; `knowledge-review`; `okf-authoring`; `okf-trigger-setup` | the maintainer's: one PR per instance; supersede explicitly, never silently |

Working souls get no promotion doctrine: the harvester is the only judge of
what is promoted, and the maintainer the only one who merges. The shared
skills ship as identical copies in each capability. The harvester and the
maintainer hold no knowledge slot, so nothing harvests them.

### The harvest switch

Harvest is off unless both the host and the soul allow it:

| Where | Setting | Effect |
|---|---|---|
| The host, `oats-local.yaml` | `settings.oats.okf.harvest: on` (default `off`) | This host harvests its working souls. |
| A soul, `soul.yaml` | `knowledge: { harvest: off }` | This soul is never harvested, whatever the host says. |

Off means **no capture at all**: no source is registered and no transcript or
notes enter custody, so nothing accumulates for later. Turning it on starts
with the next session. `oats okf setup --harvest on|off` writes the host
setting, and `oats okf harvest-status [--soul <soul>]` reports the effective
value, the row that decided it and the registered sources.
`oats schedule disable <job>` on a source's `run-source` job is an emergency
brake for one source, not the switch. The review trigger does not depend on the
switch: a host can review harvest PRs from other hosts without harvesting.
Keep harvest off until the end-to-end check in `okf-trigger-setup` passes.

### The `okf` team

The package souls carry `team: okf`. The workspace declares the label and maps
it to a messaging team:

```yaml
teams:
  okf: { description: Knowledge operations }
messaging:
  byTeam:
    okf: { team: <messaging team id> }
```

Harvesters and maintainers talk there (subjects prefixed `okf:` with the PR's
URL) without writing into the working teams. Like every label it organises and
gates nothing. A workspace without it reports `E_TEAM_UNKNOWN` on both package
souls in discovery. They still spawn, but into no messaging team, so the
harvester and the maintainer cannot talk, and `oats trigger test` fails its
team check.

## Inspection and operator commands

Run home-local commands from that source home: inside an instance the
dispatcher resolves `okf` from the home's materialized module
(`instance.json.modules` → `<home>/.oats/modules/oats.okf/`). For cross-source
or retired-source commands, run from the **deployment directory** (the one
holding `oats-local.yaml`) in a clean operator shell without another instance's
`OATS_*`/`PI_*` identity, and select the source soul with `--soul <name>`: the
kernel resolves that soul as a spawn would and dispatches to the deployment's
copy of its `oats.okf` module with the soul's merged payload (see
[Acquire, bind and provision explicitly](#acquire-bind-and-provision-explicitly)).
No `oats-config.yaml` chain is consulted; a namespace no module of the soul
provides is `E_UNKNOWN_COMMAND`.

```bash
# Read-only; no capture, refresh, scheduling or worker launch:
oats okf inspect --home /absolute/instance-home --json
oats operation run knowledge:inspect --home /absolute/instance-home --json
# Durable source selection after the home disappears:
oats okf inspect --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
# Explicit manual request; --no-launch still captures and creates a worker scaffold:
oats okf harvest --no-launch --json
oats okf run-source --source /absolute/state/sources/UUID/source.json --manual --no-launch --soul domain-expert --json
```

`inspect` reports frozen `owns`, `reads`, `bases`, the registered `acceptedView`
(not a fresh accepted-branch read), durable capture/processing/delivery/acceptance
receipts and scheduler health. `status.lastCapture` is the last attempt, not
proof the source is still present.

For a **live identity-matching source**, `documents` includes labeled Markdown:
`Working state (STATE.md)`, `Log (log.md)` and sorted `Pending note: <name>`
entries, including nested notes. Missing documents are omitted. A
`Durable processing receipts` text document follows. `liveMemory` supplies
`available`, `reason` and `observedAt`. Retired, missing, reused or unverified
homes expose only durable documents, with an explicit reason. Inspection checks
the source pointer and any instance metadata before and after reading; it rejects
unsafe live files/symlinks/hard links instead of returning a partial success.
Unsafe home identity withholds live memory but retains durable inspection. This
is a best-effort live observation, not a locked multi-file snapshot.

Inspection retains the **explicit 256 KiB per-document preview cap**. Larger
documents report `truncated: true` and original `bytes`; smaller documents are
byte-exact. The **whole JSON envelope drains through stdout**, even with large
receipts or multiple Markdown documents. Do not confuse this labeled preview
with evidence capture or `read`: those preserve full returned text.

Completion uses the worker's generated, safely quoted command:

```bash
oats okf complete --source /absolute/state/sources/UUID/source.json --run RUN_UUID --judgment /absolute/worker/work/judgment.json --soul domain-expert --json
oats okf retry --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
```

Retry preserves uncertain delivery. `--launch` explicitly starts a ready worker;
`--rejudge` preserves old proposals and refreshes only outstanding destinations,
never redelivering settled ones. A pending directory journal must recover, not
be removed to force rejudgment. After a PR merges, repeat `complete` for the
same source/run without `--judgment` to reconcile acceptance. If launch status
is unknown, inspect the worker session before retrying. See the
[standalone runtime guide](https://github.com/awebai/oats-okf#independent-worker-and-completion)
for exact recovery, adoption and lock-release procedures.

## Without a knowledge capability

`capabilities.layers.knowledge: none` is valid. The kernel creates no OKF state,
notes, bundle or harvest flow. Other capabilities may adopt, adapt or replace
the reference model; they do not inherit OKF's directories or judge. Native
record capture remains a separate surface. Selecting `none` is not a data
migration and does not erase existing memory.
