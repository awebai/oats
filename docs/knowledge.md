# Knowledge — layer 2

For the canonical design, defaults and alternatives, start with
[Knowledge, instances and evolving expertise](knowledge-theory.md). This page is
an operational guide to the version-scoped OKF implementation below, not a universal
knowledge layout or learning policy. The default direction is centralised per-soul
knowledge; other capabilities may provide different procedures and placements,
including co-location, without writing into immutable captured artifacts. For the
newer captured path, also read the [0.24 release scope](release-notes/v0.24.0.md).

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
> V1 soul-contained knowledge needs [explicit migration](knowledge-migration.md).

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

With a released OATS >=0.23.0 kernel, acquire published OKF 2.0.0 from the
intended deployment configuration context in an operator shell without inherited
instance identity (an explicit `--soul` does not override an invoking instance's
saved settings). The explicit Git source works before and after the v0.23.1
framework catalog integration:

```bash
oats install git:github.com/awebai/oats-okf@v2.0.0
oats trust oats.okf
oats use oats.okf --soul domain-expert --settings bindings-file=/absolute/config/okf-bindings.json
oats doctor --soul domain-expert --json
```

Acquisition activates nothing. An existing lock remains exact until an explicit
`oats update oats.okf`; v1 operators must plan migration before that update.
Executable changes need review and renewed trust. Target only configured source
souls; the service worker need not itself receive the knowledge layer.

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
- Settings are `bindings-file`, `harvest-runtime` (`pi`, `claude`, `codex`,
  default `pi`), and optional `harvest-model`. Choose an installed, authenticated
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
`nodes` object above, without its wrapper), then:

```bash
# New directory base: refuses an existing destination.
oats okf init --base team --nodes /absolute/config/team-nodes.json --confirm --soul domain-expert --json
# Git: writes an operator proposal, never pushes or claims acceptance.
oats okf init --base project --nodes /absolute/config/project-nodes.json --output /absolute/new-bundle-stage --soul domain-expert --json
```

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
# From the deployment context, even after source retirement:
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

## Inspection and operator commands

Run home-local commands from that source home. For cross-source or retired-source
commands, use the durable deployment context in a clean operator shell without
another instance's `OATS_*`/`PI_*` identity; select the configured source soul.

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

## Without a knowledge integration

`capabilities.layers.knowledge: none` is valid. The kernel creates no OKF state,
notes, bundle or harvest flow. Other capabilities may adopt, adapt or replace
the reference model; they do not inherit OKF's directories or judge. Native
record capture remains a separate surface. Selecting `none` is not a data
migration and does not erase existing memory.
