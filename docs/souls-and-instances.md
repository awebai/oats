# Souls and instances

Souls and instances are the two layers the OATS kernel owns. A soul defines a
reusable specialisation. An instance is a named working incarnation, with its own
ID, home, work view and lifecycle—not necessarily one task or chat session.

An instance may be ephemeral, such as a developer or reviewer doing bounded work,
or long-running, carrying planning, investigation and domain understanding across
many tasks. Lifetime does not itself change the soul's identity. See the
[canonical knowledge and specialisation model](knowledge-theory.md) for how skills,
shared knowledge, working context and state differ.

Souls live in **member repos** of a [workspace](workspaces.md) and are
discovered over Git; their capabilities are resolved by `from:` and copied whole
into each instance. This page is the soul's and the instance's anatomy under
that model.

## Soul anatomy

A soul is durable and committed. It is the part you review, improve, and keep.

```text
<member-repo>/souls/<name>/          # discoverable in the workspace by convention
  soul.yaml            # schemaVersion 2: name, description, work, team, capabilities, provider payloads
  AGENTS.md            # canonical operating doc
  CLAUDE.md → AGENTS.md
  skills/              # skills specific to this expert
  okf.json             # if the soul uses oats.okf: { version: 1, owner, owns: ["<base>/<node>"], reads: […] } — the provider's, not the kernel's
```

(A deployment's `agents/<name>/souls/<commit12>/` has the same shape; a member
soul is fetched there at its discovered commit before its first spawn, and
`agents/<name>/soul` points at the current commit.)

### `soul.yaml` v2

```yaml
schemaVersion: 2
name: release-manager                     # must equal the directory name
description: Cuts, verifies and announces releases.
work: worktree                            # worktree | checkout | directory | workspace
team: engineering                         # optional label; else the repo's default (oats-membership.yaml); else unassigned

capabilities:                             # WHERE each capability comes from — a location, never a version
  acme-release-tooling: { from: here }    # here = this soul's own repo
  acme-warehouse-access: { from: github.com/acme/data }   # a canonical repo key of a confirmed member
  acme-deploy: { from: package }          # provided by a package pinned in the workspace's packages:
  acme-house-style: off                   # removes a workspace/team default

knowledge:                                # provider payloads — opaque to the kernel, consumed by the slot's capability
  harvest-runtime: claude                 #   (oats.okf 2.1.3 reads only its binding's settings keys here; what the soul
                                          #    owns/reads is in this directory's okf.json — see "Soul anatomy")
messaging:
  channels: [acme-eng]
tasks: none                               # `none` empties the slot (drops the workspace default)

compatibility:                            # optional floors on PACKAGE versions — constraints, not sources
  oats.okf: ">=2.1"
```

| Key | Meaning |
|---|---|
| `name`, `description`, `work` | Required. `work` is the work mode below. |
| `team` | A label, or a list of labels (the first the primary), declared in the workspace's `teams:`; each may add `defaults.byTeam` capabilities and is an eligible messaging team. Never gates or restricts. |
| `private` | **Ignored since 0.26.0:** souls have no private mode. Every soul of a confirmed member is listed and spawnable; a soul that still carries the field gets a `soul-private-ignored` warning. Remove it. |
| `capabilities` | `<cap>: { from: here \| <repo key> \| package }` or `<cap>: off`. Composed over `defaults.<slot>` ⊕ `defaults.capabilities` ⊕ `defaults.byTeam[team]`; the soul wins. |
| `knowledge` / `messaging` / `tasks` | The slot's provider payload (true of every instance of the soul), or `none`. Merged with `oats-local.yaml` `settings.<cap>` and `spawn --provider <cap>`; the provider's `binding` contract validates the result — and refuses keys it does not declare. For `oats.okf` 2.1.3 the admitted keys are its settings (`bindings-file`, `state-dir`, `harvest-runtime`, `harvest-model`); the soul's `owns`/`reads` live in `souls/<name>/okf.json`, which OKF reads from the soul directory. |
| `compatibility` | `<cap>: <semver range>` checked against the locked package version (`E_COMPATIBILITY`). |

Schema: [`soul.schema.json`](soul.schema.json). Not in v2: `kind`, `type`,
`repo`, `harness`, `model`, `backend`, `yolo`, `launch-config`, `children`,
`requires`, `source:`, `stores.inherit`. Runtime, model, backend, yolo and the
launch configuration are spawn-time host choices (`--harness`, `--model`,
`--backend`, `--yolo`, `--launch-config`, or a launch configuration in
`oats-local.yaml`), not soul identity: a soul is model-agnostic as an artifact.
A child-spawn policy is a spawn flag too (`--no-child-spawns`).

A soul never runs by itself. It is incarnated as an instance. Editing a soul
is a code change, reviewed in its repo.

### OATS operational knowledge is a capability

An agent's knowledge of OATS itself — status, spawn, retire, finding other
souls — is ordinary capability content: **`oats.core`** (package
`oats.framework`). Workspaces give it to every soul through
`defaults.capabilities: { oats.core: { from: package } }`; a soul may say
`oats.core: off`. **`oats.setup`** (same package) carries the whole-architecture
knowledge an onboarding expert needs. Neither is kernel magic; the kernel still
composes its own instance-boundary and work-mode briefings, and the "You run
on OATS" briefing is `oats.core`'s inject (the kernel ships no copy since 0.26:
a soul without `oats.core` gets no OATS operating instructions, and
`oats doctor --soul` says so).

## Instance anatomy

An instance has a lifecycle, but need not be short-lived. It is the identity of
one instantiated soul while its assignment is alive. Supported session
continuations, compactions and restarts can preserve that continuity.
Retirement should account for valuable context and unfinished work, not assume
an experienced instance is cheap to replace.

An instance has a home directory, a task, and a worktree when the work mode
needs one. Its runtime setup is composed from the canonical soul plus **its own
full copy** of every capability the soul resolved to:

```text
<agents-root>/<soul>/instances/<instance>/
  AGENTS.md                        # generated: soul AGENTS.md + kernel/work-mode blocks + each module's inject
  CLAUDE.md → AGENTS.md
  .agents/skills/                  # canonical skill tree — soul skills + <capability>/<skill>/ full copies
    <capability>/<skill>/SKILL.md
  .claude/skills → ../.agents/skills
  .oats/modules/<capability>/      # the whole capability: oats.json, bin/, injects/, skills/ (hooks run from here)
  work/                            # worktree, checkout symlink, attached tree, or private directory
  TASK.md                          # briefing and task
  instance.json                    # provenance (below); `soulDir` = the soul directory hooks get as OATS_SOUL
  STATE.md, log.md, notes/         # optional, from the knowledge capability
```

Instances are transient and normally gitignored (`agents/*/instances/`). Expert
souls travel with the repo; different teams instantiate them into their own
local agent teams without collisions, because instance homes, logs, notes,
branches and messaging identities are local runtime state.

### `instance.json` — provenance is recorded, not declared

Besides the classic fields (repo, branch, lineage, launch recipe, composed
skills and instructions), a workspace spawn records:

```json
{
  "modules": {
    "acme-release-tooling": {
      "from": { "kind": "member", "repoKey": "github.com/acme/agents", "commit": "3f2a9c1e…" },
      "commit": "3f2a9c1e…", "digest": "sha256-…", "materializedAt": "2026-09-24T10:12:44.118Z"
    },
    "oats.okf": {
      "from": { "kind": "package", "package": "oats.okf", "version": "2.1.3", "commit": "b2e16f2e…", "integrity": "sha256-…", "repoKey": "github.com/awebai/oats-okf" },
      "commit": "b2e16f2e…", "digest": "sha256-…", "materializedAt": "2026-09-24T10:12:44.201Z"
    }
  },
  "providers": {
    "oats.okf": { "bindings-file": "/Users/ana/.oats/okf-bindings.json", "state-dir": "/Users/ana/.oats/okf", "harvest-runtime": "claude" },
    "acme-release-tooling": {}
  },
  "workspace": {
    "key": "github.com/acme/agents", "commit": "3f2a9c1e…", "resolution": "20ec8ec527311d71d0973086",
    "soul": { "repoKey": "github.com/acme/agents", "commit": "3f2a9c1e…", "team": "engineering" }
  }
}
```

- `modules.<cap>` — where the copy came from, at which commit, and its content
  digest. `oats status` compares these with the workspace's current state and
  shows `moved` / `missing` per module (drift is shown, not prevented).
- `providers.<cap>` — the merged provider payload the capability was bound with
  (soul ⊕ machine settings ⊕ `--provider`), so a later inspection can tell
  which instance holds a retained seat or a one-off state root. `spawn
  --preview` shows the same map before anything exists, as `settings.<cap>`,
  beside `providers` (the `--provider` flags as given).
- `workspace` — the workspace commit observed at spawn, the soul's repo/commit/
  team, and the **resolution revision** the spawn decision bound. `oats status`
  compares `workspace.soul` with the member's current commit too: `soul: <name>
  from <member> @ <c7>  [member moved since …]` (`--json`: `instances[].soul`).

A running instance never changes under itself: a member moving or a package
bump affects only new spawns.

### The harness starts normally

OATS is a skill contributor, not a skill sandbox. The harness (pi, Claude Code,
Codex) starts with cwd = the instance home and its **own** skill discovery
intact: it sees, nearest first, the instance's `.agents/skills/` (soul skills
and the copied capability skills), the repo's own `.agents/skills/` once it
works in `work/`, and whatever the operator keeps at machine level. All three
are intended. Two *composed* skills with one name is a spawn error naming both
capabilities (`E_SKILL_DUPLICATE`); a composed skill versus an ambient one is
the harness's own precedence. The `CLAUDE.md → AGENTS.md` and
`.claude/skills → ../.agents/skills` aliases are kept. OATS composes
instructions and pins model/provider settings; it excludes nothing.

## Lifecycle

### Spawn

```bash
oats spawn release-manager --purpose cut-3.2 --task "…"            # a soul of a confirmed member
oats spawn release-manager --preview --json                        # decide everything, create nothing
oats spawn release-manager --provider oats.aweb identity.source=/abs/path/to/retained/.aw   # instance-level payload
```

An instance is named `<soul>-<purpose>` by default, or exactly `--name <slug>`.
Names are unique per deployment (a workspace-model deployment has one agents
root): a derived name in use gets `-2`, `-3`…; an explicit `--name` in use is
refused (`E_INSTANCE_NAME_TAKEN`).

From a deployment (where `oats-local.yaml` is), a spawn: reads the local file →
discovers the workspace over its remotes and confirms membership → finds the
soul among the confirmed members (or `external:`; an ambiguous bare name is
`E_SOUL_AMBIGUOUS` — say `<repo>/<soul>`) → fetches the soul's source into
`<agents-root>/<soul>/souls/<commit12>/` at its commit (the home links that
directory; `<agents-root>/<soul>/soul` points at the current one) → resolves
every capability by
`from:` (member = latest, package = locked) → creates the home →
**materializes each module whole** into `.oats/modules/` and copies its skills
into `.agents/skills/` (a transaction: any failure leaves nothing behind) →
composes `AGENTS.md` → records `modules`/`providers`/`workspace` in
`instance.json` → prepares `work/` → runs the modules' spawn hooks (from their
copies) → writes `TASK.md` → launches the harness in tmux. The committed soul is
unchanged. This is a normal agent process with its own home and tools, not a
subagent call.

`--preview` reports `modules[]` (`from`, `layer`, `changedSince` the newest
previous instance of the soul), `team`, the `resolution` revision, the decision
it would bind, `providers` (the `--provider` map exactly as given) and
`settings.<cap>` (the merged payload each provider's binding will receive);
the apply refuses with `E_DECISION_STALE` if a member
moved in between. `--provider <cap> key=value` (repeatable; dotted keys nest)
must name a capability the soul resolves (`E_CAPABILITY_MISSING` otherwise) and
needs a workspace deployment. The full DTOs are in
[desktop-cli-api.md](desktop-cli-api.md#workspace-model-workspaceapi-2).

Examples of spawn hooks:

- `oats.okf` v2 requires explicit bindings and owner declarations, validates
  accepted bases, creates episodic files and an immutable reader view, and
  registers a durable source plus its per-source schedule definition. Missing
  knowledge is an error, not permission to bootstrap an empty substitute.
- `oats.aweb` mints a messaging identity — or, with
  `--provider oats.aweb identity.source=/abs/path/of/the/.aw/to/retain`, re-takes a retained
  one for exactly this instance.

### Work

The instance works in `./work`. With `oats.okf` it also keeps `STATE.md`
current, appends milestones to `log.md`, and captures non-obvious insights in
`notes/`.

It reads accepted external knowledge through `./knowledge/view.json` and
`./knowledge/bases/<alias>/`, index-first. It never writes accepted knowledge;
this is instruction, not an OS sandbox. `oats okf read`/`refresh` obtains a new
accepted view while old snapshots remain stable. Git PRs are unread as accepted
knowledge until their merge is visible; pending directory publication blocks
fresh reads rather than exposing partial bytes.

An independent worker judges durable **notes and full record windows**, not only
notes or a watermark left in the live home. Each source has a command job rooted
in durable deployment context; the operator may also request `oats okf harvest`.
Workers use their own `work: directory`, never the source branch or an attached
worktree. Validated Git output goes through real PR delivery; non-Git output
uses recoverable directory publication. Captured, processed, delivered and
accepted are distinct receipts; spawning a worker is not successful learning.
See [knowledge](knowledge.md).

### Spawning and coordinating with other agents

OATS agents can run `oats spawn` when their instructions or the
human ask them to create another expert instance. The spawned agent is another
full OATS instance, with its own soul, home, worktree, and lifecycle.

Spawn lineage is **explicit** and relation-based:
`oats spawn --relation child|sibling|parent|unrelated --relative-to <instance>`
declares what the new instance IS to an existing one (`--parent <instance>` is
sugar for `--relative-to <instance> --relation child`):

- **child** — nests under the anchor: `parentInstance` = anchor,
  `spawnOrigin: instance`.
- **parent** — the NEW instance becomes the anchor's parent: it inherits the
  anchor's old lineage slot, and the anchor's `instance.json` is re-pointed so
  its `parentInstance` is the new instance (a reviewer/maintainer of your work
  sits above you). Retirement splices lineage: when any instance retires,
  instances pointing at it (parent or sibling links) inherit its COMPLETE
  surviving lineage — both its parent and sibling links, whichever edge type
  pointed at it — so a retired parent-relation maintainer hands its children
  back to the parent it displaced (restoring absorbed sibling links too), and
  no instance is left pointing at a missing one. The splice scans every agents
  root in the team scope, since relations can cross member repos.
- **sibling** — a peer in the anchor's cluster: it shares the anchor's parent
  when one exists; when the anchor is a root, the new instance records an
  explicit `siblingInstance` link so the cluster is still derivable from
  `oats status --json` (`parentInstance` + `siblingInstance` edges).
- **unrelated** (default) — no link, operator-origin, top-level.

Attached-mode spawns are ALWAYS children of the owner of the shared work tree
(design decision: an attached agent serves that owner); relation flags other
than a redundant child-of-owner are rejected. Any other spawn — including one
from a shell that inherited
an agent's environment variables — is operator-origin and appears top-level.
Agents spawning sub-agents should pass `--parent "$OATS_INSTANCE"` (or the
relation that fits).

If the workspace has a messaging capability such as aweb, spawned instances
can also receive identities and coordinate with each other automatically. The
tasks capability can provide shared work state while messaging provides conversation.

### Retire

Retirement runs active capability retire hooks in reverse spawn order before the home disappears. The aweb
integration self-deletes the instance identity here. OKF v2 performs final
notes-and-record capture into durable external custody. An incomplete or
uncertified capture retains the home for retry. Successful retirement enqueues
evidence but never waits for a model or GitHub: independent processing and
source-targeted inspection continue after the home disappears.

Before any retire hook runs, retire preserves the instance's uncommitted and
unmerged work: a verified recovery under `.oats-retirement/recovery/`, named in
the summary. A worktree recovery is a standalone clone that carries the
repository's local exclude rules (`info/exclude`, a configured
`core.excludesFile`), so its Git status matches the source's. A recovery that
cannot be verified refuses with `E_WORK_PRESERVATION_FAILED` and keeps the
home. **`--force` does not skip work preservation.** It forces only past a
missing or unusable cleanup marker and past incomplete hook cleanup
([capabilities.md](capabilities.md)).

`oats retire <instance> --self` lets an instance retire itself when the human
or briefing says it is done. A live harness cannot give a stable final
inspection of its own work, so the calling process inspects, runs, and removes
nothing: it records the intent beside its home as
`.oats-retire-pending-<instance>.json` and starts a detached completion, then returns so the instance can report final
status before its tmux window dies a few seconds later. The completion then
retires the instance exactly as an external `oats retire` would: quiesce the
harness, preserve uncommitted work, run retire hooks, repair lineage, remove
the worktree and the home. Success leaves nothing behind: the home and the
marker are gone. A failure writes `.oats-retired-<instance>.json` beside the
retained home (plus the usual quarantine marker when hooks reported incomplete
cleanup), shows in `oats status` and the Desktop as a failed deferred
retirement, and is retried and cleared with `oats retire <instance>`.

## Work modes

A work mode decides what `./work` points at and what discipline the agent must
follow. Every mode sits inside the same home/work boundary, which the generated
instructions state first (`injects/instance-boundary.md`):

- `<instance-home>` — the gitignored instance directory, `$OATS_INSTANCE_HOME` —
  holds the brain (the composed `AGENTS.md`; there is no soul link), the task, the provenance
  (`instance.json`) and the episodic state (`STATE.md`, `log.md`, `notes/`), and
  is where OATS operational/lifecycle commands — and the commands of whatever
  capabilities are active, `aw` among them when aweb messaging is — are run,
  because they resolve scope from the working directory (`--dir <path>` to
  target another one deliberately).
- `<instance-home>/work` — the repository or workspace view — is where
  repository reading, editing, building, testing, git and commits happen, to the
  extent the mode below permits.
- The home has no soul link: the composed `AGENTS.md` already carries the
  soul's instructions, and `instance.json` `soulDir` records the (read-only,
  per-commit) soul directory every hook and dispatched command receives as
  `OATS_SOUL`. Durable soul edits go through tracked paths under `work/` under
  the applicable review rules. OKF v2 harvest edits external
  owned knowledge, not canonical soul files or skills.

Agents move between the two as the task needs; the boundary is what each
directory is for, not a place to settle in.

### `worktree` — isolated branch

`work/` is a git worktree on the instance's own branch, by default
`agents/<instance>`. The worktree is created from the member's **clone**, found
as `--repo`, then `oats-local.yaml` `clones:`, then `<deployment>/<member name>`
(`E_CLONE_MISSING` / `E_CLONE_MISMATCH` otherwise — see
[configuration.md](configuration.md)).

Use this for agents that will edit code or docs independently.

Rules:

- Build, test, and commit from `work/`, on your own branch.
- Never run git from the repo's main checkout — it resolves to the wrong branch
  and skips review.
- Do not create extra worktrees. Ask for another instance if parallel work is
  needed.

A config may define `work-modes.worktree.setup`. The kernel runs that command
inside each fresh worktree. Failures warn but do not block spawn.

### `checkout` — shared current branch

`work/` is a symlink to the repo checkout itself (the member clone, found as for
`worktree`).

Use this for maintainers, coordinators, auditors, or agents working on the
repo's current state.

Rules:

- Stay on the currently checked-out branch.
- Do not switch branches unless explicitly asked.
- Avoid destructive git operations unless the human explicitly asks.

### `attached` — another instance's tree

`work/` points at **another instance's work tree** — same branch, same
uncommitted state. Spawning attached requires `workDir` (the owning
instance's `<home>/work`); it is usually a spawn-time choice for service
agents such as reviewers, but a soul whose role is always-attached
service work may declare it as identity too.

Attached agents are guests: never switch branches or rewrite history, touch
only what the briefing names, keep commits small and attributable. Retiring
an attached instance never removes the shared tree. The packaged
`work-attached` instruction source carries this discipline into each generated instance AGENTS.md.

### `directory` — independent execution

`work/` is a new instance-owned directory, not a Git repo or a link to a source.
Use it explicitly for capability workers that need private execution space
without Git. `repo` (or `--repo`) supplies context only and may be an ordinary
directory; without it, the deployment directory (where `oats-local.yaml` is) is
used. No implicit fallback changes the other modes.

`--work-dir` and `--branch` are rejected. Canonical instructions, skill
composition, provider trust and harness preflight still apply. No worktree setup
runs. Retirement preserves nonempty work in verified recovery storage beside the
home (`workRecovery.path/work`) before deleting it, including files created by
hooks; directory work has no disposable-root exemptions. The work-root cannot be
exchanged for a symlink. Recovery does not replace the worker's delivery protocol.

### `workspace` — cross-repo coordinator

`work/` is a symlink to the **whole deployment** — the directory holding
`oats-local.yaml`, with `agents/` and the member clones that sit beside it —
not a repo (0.25.1; a member cloned elsewhere is reached through
`oats-local.yaml` `clones:`). Every
member repo is read-context; the instance's product is coordination:
routing, analysis, task-writing, messaging, spawning specialists.

Use this for free agents that support cross-repo work but are not tied to
any one repo — coordinators, dispatchers, architects. The soul itself still
lives in (and is committed to) its home repo (e.g. a workspace's
`lfx-agents/` repo); where the soul lives and where it works are decoupled.

Rules:

- Read freely across member repos; **never edit or commit inside them** —
  route changes to the owning repo's agents or the human.
- No git state operations in any member repo.
- Knowledge promotion follows the selected capability's custody protocol,
  never direct edits through the workspace view. In OKF v2 an independent
  worker publishes external knowledge through PRs for every Git base,
  irrespective of the source's work mode or the soul's repository.

Spawning workspace mode requires a deployment boundary for `./work`; the
instance records no branch — the workspace is not a git tree. *(Open thread:
the kernel still derives this boundary from the classic `team:` scope; binding
it to the `oats-local.yaml` directory is tracked in
[design/README.md](design/README.md).)*

## Agents root

The agents root is the nearest `agents/` directory walking upward from the
current directory. `PI_AGENTS_ROOT` overrides the search.

**Where instances are stored is a separate question from where you invoked
OATS.** Discovery finds the root from your current directory, but instance homes
always live in the **soul-owning repo's primary checkout**: when the root you
discovered is inside a *linked git worktree*, storage maps to the equivalent
path in that repository's primary checkout, so homes survive the worktree, stay
visible to the whole deployment, and never depend on where a command happened to
run. An agent that spawns after `cd work/` reaches the same home as one spawning
from the deployment root.

Three things stay independent, and are meant to:

- **Invocation** — where you ran the command;
- **Config/package scope** — resolved from the context directory, and steerable
  with an explicit `--dir <path>`;
- **`work/`** — the instance's repository view, which may well be a linked
  worktree; only *storage* is redirected, never your work tree.

Roots that Git does not own are unaffected: a non-Git agents root stores
instances exactly where it sits.

Every instance is told its own home as **`OATS_INSTANCE_HOME`** (absolute), and
instructions refer to it as `<instance-home>`. The two environments differ, so
they are stated separately:

- **Runtime session**: `OATS_INSTANCE_HOME` and `PI_AGENT_HOME` (plus
  `OATS_INSTANCE`/`PI_AGENT_INSTANCE`). The `PI_`-prefixed names are
  compatibility aliases for the separately published pi extension.
- **Lifecycle hooks**: `OATS_INSTANCE_HOME` and `OATS_HOME`, alongside the rest of
  the hook contract. `OATS_HOME` predates `OATS_INSTANCE_HOME` and is kept because
  shipped capability hooks read it; it is **not** exported to harness sessions.

Neither is `OATS_HOME_DIR`, which is the package store root — do not conflate
them.

When placement cannot be established — Git owns the location but the repository
cannot be read, a linked worktree whose primary checkout is missing, or a
resolved destination outside the agent's own directory — the spawn fails closed
with **`E_NO_CANONICAL_ROOT`** and creates nothing.

### Deployment prerequisite: the agents directory must be operator-owned

The canonical deployment (the agents root and the instance homes under it) **must be owned by the operator and not writable by untrusted
users or processes.** OATS validates resolved destinations and re-checks the home
immediately before creating anything in it, but it cannot defeat a concurrent
local attacker who already has write access there: Node offers no
`openat`/`O_NOFOLLOW`-relative directory creation, so a path can in principle be
swapped between the check and the creation. Anyone with that access also
controls souls, generated instructions, hook declarations and instance state, so
this is a deployment prerequisite — filesystem ownership and permissions — not
something the kernel can close from inside.

Default layout:

```text
<deployment>/
  oats-local.yaml
  agents/
    docs-expert/         # a workspace soul, defined in a member repository's
      souls/<commit12>/  #   souls/docs-expert/ and copied here per commit
      instances/
    memory-harvest/      # a capability-defined agent: only instances/, no soul
      instances/
```

A capability-defined agent (declared by a package or member module, such as
the OKF harvester) homes under the agents root exactly like a soul; its
directory holds only `instances/`. A name that is both a workspace soul and a
capability agent is ambiguous (`E_SOUL_AMBIGUOUS`).

There are no local souls. A soul is a member repository's `souls/<name>`
(`soul.yaml` + `AGENTS.md`); author it there and run `oats sync`. OATS 0.25
and earlier kept local souls and capability-agent homes under
`<scope>/local-agents/`: this kernel never reads, spawns into or retires from
that directory; it only detects it. Onboarding refuses into a directory that
holds one, and `oats status` and `oats doctor` report it once, as the
`legacy-local-agents` problem naming the instances found there; retire them
with the 0.25 kernel, or delete the directory once they are stopped.

A *captured home* (spawned through 0.24–0.25's captured path, removed in 0.26:
its `instance.json` records `executionBinding`, `incarnationId` or `captured`) is
reported by `oats status` and `oats doctor` as the `legacy-captured-home`
problem. It has no 0.26 runtime: start, restart, inspect/readiness/operation
`--home` and its in-home commands refuse it (`E_UNSUPPORTED_MODE`). `oats retire`
still works; it warns once per capability whose retire hook did NOT run, since
identities and memberships those capabilities created are not revoked — remove
them with the provider's own tooling. Re-spawn the soul from the deployment.

Alternative agents-root layouts are planned but not built. Today the default
layout is the only implemented layout.
