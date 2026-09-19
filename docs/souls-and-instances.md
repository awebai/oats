# Souls and instances

Souls and instances are the two layers the OATS kernel owns. A soul defines a
reusable specialisation. An instance is a named working incarnation, with its own
ID, home, work view and lifecycle—not necessarily one task or chat session.

An instance may be ephemeral, such as a developer or reviewer doing bounded work,
or long-running, carrying planning, investigation and domain understanding across
many tasks. Lifetime does not itself change the soul's identity. See the
[canonical knowledge and specialisation model](knowledge-theory.md) for how skills,
shared knowledge, working context and state differ.

This operational guide includes the configuration-based soul and lifecycle forms.
Portable source definitions and captured lifecycle have their own versioned scope;
see the [0.24 release notes](release-notes/v0.24.0.md) rather than assuming every
legacy example below applies to a captured instance.

## Soul anatomy

A soul is durable and committed. It is the part you review, improve, and keep.

```text
<agents-root>/<agent>/soul/
  soul.yaml            # name, repo, work mode, runtime, model
  AGENTS.md            # canonical operating doc
  CLAUDE.md → AGENTS.md
  skills/              # skills specific to this expert
  okf.json             # OKF v2 owner/owns/reads declaration, when selected
```

`soul.yaml` keys:

| Key | Meaning |
|---|---|
| `name` | Agent name. |
| `kind` | `persistent` for committed agents, `local` for full local souls under `local-agents/` (legacy `tmp` reads as `local`). |
| `description` | Short role description. |
| `repo` | Target repo, absolute or relative to the agents root's parent. |
| `work` | `worktree`, `checkout`, `attached`, `workspace`, or `directory`. |
| `runtime` | `pi` or `claude` — the harness new instances launch on; a spawn can override with `--runtime`. For `claude`, the binary is `claude` unless a local-only `oats-claude-config` file (closest one walking up from the repo; one line naming the binary, e.g. `claude-personal`) selects another — a personal machine preference for account selection, never committed. With the aweb messaging integration active, claude sessions get the `aweb-channel` plugin wired at spawn for real-time push events. |
| `model` | Optional default model — a `provider/id[:thinking]` pattern or a comma-separated preference list (`github-copilot/x:high, anthropic/x:high`); at spawn the first entry whose provider/model is available wins (pi models probed via `pi --list-models`). For the `claude` runtime the value is translated to what the claude CLI accepts: `anthropic/<id>[:thinking]` becomes the bare `<id>`, aliases and bare `claude-*` ids pass through, other providers' entries are dropped, and nothing usable falls back to claude's own default. A spawn can override it. |
| `launch-config` | Optional default launch configuration for new instances (a name declared under `launch-configs:` in the scope's config; see docs/design/launch-configurations.md). `oats spawn --launch-config <name|none>` overrides it; `oats soul set --launch-config <name>` / `--no-launch-config` edit it. |

A soul is model-agnostic as an artifact. Its files are plain operating docs,
skills and capability-owned declarations. `model` is only the default choice
for new instances, not part of the expert's identity.

A soul never runs by itself. It is incarnated as an instance. Editing a soul
is a code change.

Core soul artifacts are `AGENTS.md` and `skills/`, plus any declarations the
selected knowledge integration needs. OKF v2 stores knowledge externally, not
in a soul bundle; see [knowledge](knowledge.md) for its prepared version scope.
Future integrations may add expert-specific artifacts such as rule files or
runtime-specific guidance, while keeping `AGENTS.md` canonical.

## Instance anatomy

An instance has a lifecycle, but need not be short-lived. It is the identity of
one instantiated soul while its assignment is alive. Supported session continuations,
compactions and restarts can preserve that continuity. Model or harness changes must
follow the selected execution profile; they are not permission to reinterpret a
captured recipe. Retirement should account for valuable context and unfinished work,
not assume an experienced instance is cheap to replace.

An instance has a home directory, a task, and a worktree when the work mode
needs one. Its runtime setup is composed from the canonical soul plus
capabilities selected for that soul by the config scopes governing it.

A soul can have as many instances as people need. Instances are transient and
normally gitignored (`agents/*/instances/`). That matters for large or open
source repos: the expert souls can travel with the repo, while different
engineering teams instantiate those souls into their own local agent teams.
Their instance homes, logs, notes, branches, and messaging identities do not
collide because they are local runtime state, not shared soul state.

```text
<agents-root>/<agent>/instances/<instance>/
  soul → <agent>/soul/             # the agent setup for this instance
  AGENTS.md                        # generated: canonical soul + selected blocks
  CLAUDE.md → AGENTS.md
  .agents/skills/                  # exact soul + active capability set
  .claude/skills → ../.agents/skills
  work/                            # worktree, checkout symlink, or attached tree
  TASK.md                          # briefing and task
  instance.json                    # repo/branch, spawn lineage, capabilities, skills, instructions, trust
  STATE.md, log.md, notes/         # optional, from the knowledge integration
```

Why durable expertise must be incarnation-invariant while task state is local
to this branch and moment is covered in [knowledge theory](knowledge-theory.md).
This distinction does not require knowledge bytes to live in the soul.

The kernel does not define memory files. With `oats.okf` selected under
`capabilities.layers.knowledge`, v2 creates `STATE.md`, `log.md`, `notes/` and an
immutable external-knowledge snapshot. `knowledge: none` creates none of these;
it does not erase pre-existing memory.

## Lifecycle

### Spawn

The kernel creates the home, links the soul for reference, resolves capability
targets, generates instance instructions, materializes the exact local skill
set, prepares `work/`, runs active capability hooks, writes `TASK.md`, and
launches a full coding agent session in tmux. The committed soul is unchanged.
This is not a Claude Code subagent call; it is a normal agent process with its
own home and tools.

Examples of spawn hooks:

- `oats.okf` v2 requires explicit bindings and owner declarations, validates
  accepted bases, creates episodic files and an immutable reader view, and
  registers a durable source plus its per-source schedule definition. Missing
  knowledge is an error, not permission to bootstrap an empty substitute.
- `oats-aweb` mints a messaging identity.

### Work

The instance works in `./work`. With oats-okf it also keeps `STATE.md` current,
appends milestones to `log.md`, and captures non-obvious insights in
`notes/`.

It reads accepted external knowledge through `./knowledge/view.json` and
`./knowledge/bases/<alias>/`, index-first. It never writes accepted knowledge;
this is instruction, not an OS sandbox. `oats okf read`/`refresh` obtains a new
accepted view while old snapshots remain stable. Git PRs are unread as accepted
knowledge until their merge is visible; pending directory publication blocks
fresh reads rather than exposing partial bytes.

An independent worker judges durable **notes and full record windows**, not only
notes or a watermark left in the live home. V2 working-agent instructions do not
require after-commit harvesting. Each source has a command job rooted in durable
deployment context; the operator may also request `oats okf harvest`. Timer
installation is explicit, and no-launch sources cannot schedule model launches.

Workers use their own `work: directory`, never the source branch or an attached
worktree. Validated Git output goes through real PR delivery; non-Git output
uses recoverable directory publication. Workers leave live notes and soul skills
untouched. Captured, processed, delivered and accepted are distinct receipts;
spawning a worker is not successful learning. See [knowledge](knowledge.md) for
inspection, completion and recovery, and [migration](knowledge-migration.md) for
preserving v1 bundles and source cursors before owner/source cutover.

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

If the workspace has a messaging integration such as aweb, spawned instances
can also receive identities and coordinate with each other automatically. The
task layer can provide shared work state while messaging provides conversation.

### Retire

Retirement runs active capability retire hooks in reverse spawn order before the home disappears. The aweb
integration self-deletes the instance identity here. OKF v2 performs final
notes-and-record capture into durable external custody. An incomplete or
uncertified capture retains the home for retry. Successful retirement enqueues
evidence but never waits for a model or GitHub: independent processing and
source-targeted inspection continue after the home disappears.

`oats retire <instance> --self` lets an instance retire itself when the human
or briefing says it is done. A live runtime cannot give a stable final
inspection of its own work, so the calling process inspects, runs, and removes
nothing: it records the intent beside its home as
`.oats-retire-pending-<instance>.json` and starts a detached completion, then returns so the instance can report final
status before its tmux window dies a few seconds later. The completion then
retires the instance exactly as an external `oats retire` would: quiesce the
runtime, preserve uncommitted work, run retire hooks, repair lineage, remove
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
  holds the brain (`AGENTS.md`, `soul/`), the task, the provenance
  (`instance.json`) and the episodic state (`STATE.md`, `log.md`, `notes/`), and
  is where OATS operational/lifecycle commands — and the commands of whatever
  capabilities are active, `aw` among them when aweb messaging is — are run,
  because they resolve scope from the working directory (`--dir <path>` to
  target another one deliberately).
- `<instance-home>/work` — the repository or workspace view — is where
  repository reading, editing, building, testing, git and commits happen, to the
  extent the mode below permits.
- The home's `soul` link is to be treated as read-only: writes through it bypass
  the branch and review path. Durable soul edits go through tracked paths under
  `work/` under the applicable review rules. OKF v2 harvest edits external
  owned knowledge, not canonical soul files or skills.

Agents move between the two as the task needs; the boundary is what each
directory is for, not a place to settle in.

### `worktree` — isolated branch

`work/` is a git worktree on the instance's own branch, by default
`agents/<instance>`.

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

`work/` is a symlink to the repo checkout itself.

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
without Git. `repo` (or `--repo`) supplies configuration context only and may be
an ordinary directory; without it, the deployment scope is used. An
`oats-config.yaml` below laptop scope supports package-only deployments before
any local souls exist. No implicit fallback changes the other modes.

`--work-dir` and `--branch` are rejected. Canonical instructions, skill
composition, provider trust and runtime preflight still apply. No worktree setup
runs. Retirement preserves nonempty work in verified recovery storage beside the
home (`workRecovery.path/work`) before deleting it, including files created by
hooks; directory work has no disposable-root exemptions. The work-root cannot be
exchanged for a symlink. Recovery does not replace the worker's delivery protocol.

### `workspace` — cross-repo coordinator

`work/` is a symlink to the **whole workspace** (the team scope declared by
`team:`, else the workspace-scope config directory) — not a repo. Every
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

Spawning workspace mode requires a declared boundary (a `team:` block or a
workspace-scope config); the instance records no branch — the workspace is
not a git tree.

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
  shipped capability hooks read it; it is **not** exported to runtime sessions.

Neither is `OATS_HOME_DIR`, which is the package store root — do not conflate
them.

When placement cannot be established — Git owns the location but the repository
cannot be read, a linked worktree whose primary checkout is missing, or a
resolved destination outside the agent's own directory — the spawn fails closed
with **`E_NO_CANONICAL_ROOT`** and creates nothing.

### Deployment prerequisite: the agents directory must be operator-owned

The canonical deployment (the agents root, `local-agents/`, and the instance
homes under them) **must be owned by the operator and not writable by untrusted
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
<scope>/
  agents/              # committed souls
    docs-expert/
      soul/
      instances/
  local-agents/        # local souls — same shape, never committed
    scratch-agent/
      soul/
      instances/
```

`local-agents/` sits BESIDE `agents/` at the scope level and holds **full local
souls**: complete definitions with instructions, skills, capability declarations
and instances, not committed to the repo. `oats create <name> --local` creates one — the directory
is created on first use, and when the scope is a git repo the kernel adds
`local-agents/` to its `.gitignore` automatically. A scope with only
`local-agents/` is fully operable: people can use OATS with local agents alone.
Ad hoc agents from `oats spawn --instructions-file`/`--def-file` land here too.
Legacy nested `agents/local-agents/` and `agents/tmp-agents/` are still read
for compatibility.

Instances of a local soul receive a `local-soul` briefing: work and commits
are normal, but soul updates are plain file edits (nothing to commit), and
durability is the machine's — promote the soul to `agents/` when it starts to
matter beyond one machine. That concerns soul artifacts, not a knowledge
provider's custody: a local soul using OKF v2 still reads external bases and
uses PR-only delivery for any Git base.

Alternative agents-root layouts are planned but not built. Today the default
layout is the only implemented layout.
