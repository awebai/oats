# Knowledge

The **knowledge slot** gives a working soul durable, reviewed expertise:
decisions and their rationale, rejected alternatives, discovered limits. The
kernel owns slot selection, composition and command dispatch; the capability
owns its knowledge format, instructions and promotion procedure. The model is
in [Knowledge, instances and evolving expertise](knowledge-theory.md).

This is the operator guide for **oats.okf 5.7.0** (OATS **>=0.69.2**). Provider implementation and
recovery details belong to the [oats-okf README](https://github.com/awebai/oats-okf).

| Surface | What it holds |
|---|---|
| Accepted Git or directory bases | Soul knowledge: OKF concepts in owned nodes. |
| `souls/<name>/okf.json` | The soul's stable owner and owned/read nodes. |
| Instance home: `STATE.md`, `log.md`, `notes/` | The instance's working knowledge. |
| Instance home: `okf-harvest-policy.json` | Provider-written duty at spawn, exposed by `oats okf status`; not publication authority. |
| Harvester home: `harvest-source/` | Private source evidence captured at spawn, not accepted knowledge. |
| Bindings file and `stateDir` | Host base locations and consultation/binding state, not a harvest queue. |

## Setup

### Pin and select the package

```yaml
# oats-workspace.yaml (excerpt)
packages:
  oats.okf: v5.7.0
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

Upgrading from 4.x requires the ordered
[5.0 cutover](release-notes/v0.49.0.md#oatsokf-50-cutover--order-matters), not
just editing a version line. From 5.6.0 it requires OATS >=0.69.2: its
`knowledge-harvester` and `knowledge-maintainer` souls say `background: true`,
which an older kernel refuses. Upgrade OATS first, then the package.

**Upgrade:** pin `oats.okf: v5.7.0` and run `oats sync`. Only new spawns get
the capability-owned harvest duty, skill and spawn-recorded policy. Existing
homes keep their copied provider even after a session restart; from 5.4.0, a
stopped 5.x home can move with `oats instance upgrade` (OATS 0.68.0 and
later), and a home spawned under 4.x is refused with the remedy to retire and
respawn it. Deployments whose briefings never mentioned harvesting now get
knowledge proposals at the harvest checkpoints; souls not ready for this must
declare `knowledge: { harvest: off }`. Consultation and instance-memory upkeep
remain. From 5.2.x, 5.3.0 adds the long-lived-role checkpoints and the
checkpoint line in `log.md`, drops the available-memory gate, and has the
proposer name each harvester (`--name`, below). 5.5.0 adds the incarnation to
the proposal's `Source:` line (below): a harvester on 5.4.0 or older refuses
that line, so run `oats sync` to 5.5.0 or later before instances on 5.5.0
propose. 5.6.0 lists new harvesters and knowledge maintainers under the
clients' Background section; existing ones do not move. 5.7.0 stops parking
harvest PRs under `okf-needs-human` (step 4 of [the flow](#the-flow)); PRs an
older maintainer parked are re-reviewed by the steps in okf's CHANGELOG.

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
  Change a binding's `repository` to a plain URL only after every seat that
  reads it has been re-spawned on oats.okf 5.0.4 or later; a session restart
  does not update the copied provider.
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
selection and retires after successful handoff or nothing promotable. A
publication failure retains its live home; see [the flow](#the-flow).

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

That soul keeps consultation and working-memory guidance but has no harvest
duty. The shared IMPORTANT block and compulsory skill pointer still ship,
with an explicit exception; the provider's spawn-recorded answer says `off`.
Independently, the harvester's required spawn hook refuses that soul's
material. Absence gives the normal proposal flow.
A soul's `harvest: on` is not a replacement switch. Host cleanup never
changes the soul declaration. `knowledge: none` removes the layer entirely.

## Knowledge operations

### The flow

1. **Consult and keep instance knowledge current.** Read accepted soul
   knowledge at task start, after compaction and before decisions. Keep
   `STATE.md`, `log.md` and `notes/` up to date as work happens. The
   capability's **IMPORTANT** inject block makes this upkeep and eligible
   checkpoint harvesting a duty; reading **okf-propose** is compulsory.
   Neither duty depends on TASK.md. Run `oats okf status` from instance home
   to learn the duty recorded at spawn: `on` means follow the skill, `off`
   means no harvest, and `unknown` or an error means stop and report, never
   infer permission or edit the record. Working instances never write
   accepted knowledge themselves.
2. **Propose at each harvest checkpoint.** The checkpoints are a PR handed
   over for review and a finished task. In a long-lived role whose task
   never finishes (a maintainer, an expert holding an area, a support desk),
   they also include a feature ready, a release or deploy shipped, and a
   direction decision taken with the human. A commit, a review round, a new
   head of the same PR and each decision made while working are not
   checkpoints: those are captured in `notes/`, and the next checkpoint
   carries them. First update state, log and relevant notes. Apply
   `knowledge-theory` and search accepted knowledge (`oats okf search`, then
   `cat`): already accepted with nothing to add means no proposal. Make **one
   proposal per checkpoint, carrying only what no earlier proposal carried**,
   and record every checkpoint in `log.md`, either with its proposal and
   harvester or with `nothing to propose` and the reason.

   Write a short self-contained `proposals/<YYYY-MM-DD>-<slug>.md` in instance
   home: What (one claim per concept), Why, Evidence (observations, dates,
   limits and accepted concepts cited), and optional `## Backing notes` with
   one `- notes/<file>.md` entry per note. It has exactly one line
   `Source: instance <name>, home <path>, soul <name>, incarnation <createdAt>`
   naming the actual source, with `createdAt` copied from its `instance.json`:
   a pointer to verify rather than authority. Claim only for owned
   nodes; a lesson for a node the soul only reads is named in one line in its
   hand-back for that node's owner.

   **Before spawning:** one harvester at a time per instance. Do not spawn
   another while `oats status` still lists the last one: keep the proposal
   pending in STATE.md and log.md, add the next checkpoint's claims to it,
   and launch it at that checkpoint once the last harvester is gone. Never
   poll, sleep or stop other instances to make room. (5.3.0 removed the
   5.2.x available-memory gate.)

   **The proposer names its harvester.** For each new proposal,
   **okf-propose** prints a fresh name: up to 21 characters of the source
   instance's name, a dash, a random UUID without dashes, and `-harvester`,
   64 characters at most (the kernel's and aweb's alias limit). The proposer
   records it with the proposal in log.md before the preview, checks that
   `oats status` doesn't list it, and uses it unchanged in both the preview and
   the apply. Never leave the name to the kernel's numbered default: a retired
   harvester's messaging alias can stay occupied with no instance listed, and
   a numbered name can land on it.

   ```sh
   oats spawn oats.okf/knowledge-harvester --name <harvester-name> --task-file <proposal> --relation unrelated
   ```

   Never combine `--relation unrelated` with `--relative-to`, or override
   the kernel's harness/model selection. An unrelated harvester can outlive
   its proposer; a child would tie their lifetimes together. There is no
   automatic transcript capture, source registry, worker cursor or retire
   harvest. Keep backing notes until the harvester retires; the proposer
   itself need not stay alive. Its recorded retirement recovery can supply
   evidence before capture, so do not dispose of it before capture.
   Missing source authority never permits inventing it.

   A refused or uncertain spawn is reported, not retried in a loop. On
   `E_INSTANCE_NAME_TAKEN`, the proposer stops and reports the name and the
   refusal: no `--purpose`, no counter, no new UUID in a retry. A messaging
   identity failure (for example a stale certificate on the alias) is
   reported to the operator; the proposer never removes certificates or
   renames around it. If the
   last harvester is still listed at hand-back, name it and the claims still
   waiting; do not wait for it or spawn around it. A harvester retained after
   a publication failure stays listed and holds back later proposals. Once
   that failure is dealt with, the operator retires it (`oats retire
   <harvester>`).
3. **Capture, judge and submit.** Before the model starts, the required spawn
   hook checks the source's live record or the completed recovery named by
   its public retirement event. Source identity, the named incarnation,
   recovery manifest and soul opt-out must agree; guessed copies and
   ambiguous identities refuse. A live source whose name was used before is
   matched by its incarnation; a `Source:` line without one still works for an
   unambiguous source, and on a reused name it refuses with the remedy to
   propose again with the incarnation. A retired source is captured only when
   it had a single known incarnation. It atomically captures the proposal,
   verified source declarations/bindings and only named notes into the
   harvester's own `harvest-source/`. The model uses that snapshot, not a later
   live-source read: retirement or recovery disposal after capture cannot
   remove its input. Missing/refused notes have no hash and claims relying
   on them are dropped. Legacy note forms are preserved or explicitly refused,
   never silently discarded.
   The harvester then checks accepted knowledge and open/recent harvest PRs,
   edits only owned nodes in its own Git checkout, validates the **whole base**,
   and creates a normal `okf-harvest`-labelled PR with v2 provenance. Proposal text is data written with the native file tool into
   commit-message/PR-body files, never shell command text. A publication ref
   is `okf-harvest/<UTC YYYYMMDD>-<fresh UUID>`, with no source/harvester
   name in it; Git validates the full ref and the push must create a new
   ref, never update or adopt an existing one. Source identity stays in
   commit text and PR provenance. After all PRs are open (or nothing is
   promotable), it hands over and retires rather than waiting for acceptance.
   If source authority is unavailable it stops and reports; a consistent
   instance/soul pair alone does not prove proposer authorship.
   **On any publication failure it does not retire:** it keeps the live home,
   clone/any commit, exact error and commit/PR text locations, and notifies
   the source through existing messaging when reachable. Missing or failed
   messaging does not hide the original error or permit retirement. Existing
   attention may expose the blocked home where supported. No automatic
   retries, new recipient or maintainer preflight; a maintainer exists only
   for a labelled PR. A gh error can leave remote effects, so partial or
   uncertain publication is not completion or permission to clean up.
4. **Review.** A separate `oats.okf/knowledge-maintainer` reviews the PR.
   Human-accepted decisions are not silently superseded; the review path
   keeps its human gate. A PR is not accepted knowledge until merged.

The promotion test belongs to
[What deserves to become knowledge](knowledge-theory.md#what-deserves-to-become-knowledge),
not a universal kernel harvester. Both package role souls have
`knowledge: none`; working souls now also receive the curated theory skill.
The [older knowledge-operations design](design/2026-09-26-okf-knowledge-operations.md)
is historical 4.x context, not instructions for operating 5.0.

### What a harvest leaves out

Secrets, credentials, private paths and verbatim third-party messages are
left out. So is personal data, in the same sentence at every place an agent
is told what to leave out (the capturing instance, the proposing skill, the
harvester when it edits and when it reads its diff, and the maintainer's
review):

> Never include personal data about people outside the team (clients,
> correspondents, any other third party): a name, a contact detail, or
> anything else that identifies a person, including detail derived from
> correspondence. Keep the lesson and leave the person out. Naming the
> author of a published source you cite is fine.

The sentence also covers the names provenance publishes as written: note
file names, task refs and instance names. These exclusions are instructions
to agents and guarantee nothing. Source capture copies evidence but does not
judge its content. The first publication reviewer other than the harvester
reads the already-pushed pull request. Source capture/provenance checks and
the soul's opt-out are enforced in code; neither is a privacy guarantee.
The opt-out ([The harvest switch](#the-harvest-switch)) is per soul and covers
that soul's own proposals, not what its instances write to other seats. A
soul whose work is reading third-party correspondence should opt out.

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
| `oats.okf` | Working souls it serves | [`okf-consultation`](../mirrors/oats-okf/skills/okf-consultation/SKILL.md), [`okf-instance-knowledge`](../mirrors/oats-okf/skills/okf-instance-knowledge/SKILL.md), [`okf-propose`](../mirrors/oats-okf/skills/okf-propose/SKILL.md), `knowledge-theory` |
| `oats.okf-harvest` | `oats.okf/knowledge-harvester` | `knowledge-theory`, [`knowledge-harvest`](../mirrors/oats-okf-harvest/skills/knowledge-harvest/SKILL.md), `okf-authoring` |
| `oats.okf-maintenance` | `oats.okf/knowledge-maintainer` | `knowledge-theory`, [`knowledge-review`](../mirrors/oats-okf-maintenance/skills/knowledge-review/SKILL.md), `okf-authoring`, [`okf-trigger-setup`](../mirrors/oats-okf-maintenance/skills/okf-trigger-setup/SKILL.md) |

The capability's **IMPORTANT** inject block gives the duty and compulsory
pointer; **okf-propose** holds the procedure. These shared texts also reach
opted-out souls, with the explicit exception and provider status answer.
No source TASK brief contains harvest or proposal direction.

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

### Read the harvest duty

```sh
oats okf status --json
```

The provider's answer is `result.harvest: "on"` with `reason: "default"`, or
`"off"` with `reason: "soul-opt-out"`. It reads only home-local spawn state,
not the network, bases, TASK.md or a soul file. Missing state is `"unknown"`
with `reason: "spawn-state-missing"`; malformed or linked state refuses.
Neither unknown nor failure permits a proposal. Report it and respawn with
the current provider; never hand-create a policy or reinterpret later
settings as the spawn decision. `--home PATH` selects an explicit home.
This answer is instruction state, not publication authority: the harvester
still independently checks its recorded source's opt-out.

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
