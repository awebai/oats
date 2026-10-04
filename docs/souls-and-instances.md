# Souls and instances

Souls and instances are the two layers the OATS kernel owns. A soul defines a
reusable specialisation. An instance is a named working incarnation, with its own
ID, home, work view and lifecycle; not necessarily one task or chat session.

An instance may be ephemeral, such as a developer or reviewer doing bounded work,
or long-running, carrying planning, investigation and domain understanding across
many tasks. Lifetime does not itself change the soul's identity. See the
[canonical knowledge and specialisation model](knowledge-theory.md) for how skills,
shared knowledge, working context and state differ.

Souls live in **member repos** of a [workspace](workspaces.md) and are
discovered over Git; their capabilities are resolved by `from:` and copied whole
into each instance. This page is the soul's and the instance's anatomy under
that model.

## Quick map

| Thing | Location |
|---|---|
| Shared declaration | `oats-workspace.yaml` in the host repo; `oats-membership.yaml` in every member |
| Per-machine config | `<deployment>/oats-local.yaml` (uncommitted; [configuration.md](configuration.md)) |
| Package lock | `<deployment>/oats-lock.json` ([packages.md](packages.md#lock-v3)) |
| Soul | `<member repo>/souls/<name>/`: `soul.yaml`, `AGENTS.md`, `CLAUDE.md → AGENTS.md`, `skills/` |
| Member capability | `<member repo>/capabilities/<name>/oats.json` (latest state) |
| Package capability | `<package repo>/oats-package/capabilities/<name>/` (versioned) |
| Instance home | `<deployment>/agents/<soul>/instances/<instance>/` |
| Instance operating doc | `<home>/AGENTS.md` (generated) |
| Instance skills | `<home>/.agents/skills/` |
| Instance modules | `<home>/.oats/modules/<capability>/` (the copies this instance runs) |
| Instance `oats` | `<home>/.oats/bin/oats` (a link to the kernel that last launched it) |
| Instance record | `<home>/instance.json` (`modules`, `providers`, `workspace`, `teams`) |

## Soul anatomy

A soul is durable and committed. It is the part you review, improve, and keep.

```text
<member-repo>/souls/<name>/          # discoverable in the workspace by convention
  soul.yaml            # schemaVersion 2: name, description, work, capabilities, provider payloads
  AGENTS.md            # canonical operating doc
  CLAUDE.md → AGENTS.md
  skills/              # skills specific to this expert
  okf.json             # if the soul uses oats.okf: { version: 1, owner, owns: ["<base>/<node>"], reads: […] } (the provider's, not the kernel's)
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

capabilities:                             # WHERE each capability comes from: a location, never a version
  acme-release-tooling: { from: here }    # here = this soul's own repo
  acme-warehouse-access: { from: github.com/acme/data }   # a canonical repo key of a confirmed member
  acme-deploy: { from: package }          # provided by a package pinned in the workspace's packages:
  acme-house-style: off                   # removes a workspace default

knowledge:                                # provider payloads: opaque to the kernel, consumed by the slot's capability
  harvest: off                            #   (what the soul owns and reads is in this directory's okf.json)
messaging:
  channels: [acme-eng]
tasks: none                               # `none` empties the slot (drops the workspace default)

compatibility:                            # optional floors on PACKAGE versions: constraints, not sources
  oats.okf: ">=4.0"

launch: { harness: claude, model: claude-opus-5-5 }   # optional (0.30): what the role should run on
```

| Key | Meaning |
|---|---|
| `name`, `description`, `work` | Required. `work` is the work mode below. |
| `capabilities` | `<cap>: { from: here \| <repo key> \| package }` or `<cap>: off`. Composed over `defaults.<slot>` ⊕ `defaults.capabilities`; the soul wins. |
| `knowledge` / `messaging` / `tasks` | The slot's provider payload (true of every instance of the soul), or `none`. Merged with `oats-local.yaml` `settings.<cap>` and `spawn --provider <cap>`; the provider refuses keys its manifest does not declare. For `oats.okf`, what the soul owns and reads lives in `souls/<name>/okf.json`. |
| `compatibility` | `<cap>: <semver range>` checked against the locked package version (`E_COMPATIBILITY`). |
| `launch` | Optional (0.30): `{ harness: pi \| claude \| codex, model? }`, the role's launch preference. Only a harness and a model: args, env, yolo and the executable stay host facts. Each machine may override it (`oats-local.yaml` `souls.launch`), and spawn flags win over both ([launch preferences](configuration.md#launch-preferences)). Add it to a committed soul only once every deployment runs 0.30. |

Schema: [`soul.schema.json`](soul.schema.json). Which teams a soul joins is the
deployment's choice (`oats-local.yaml`, [workspaces.md](workspaces.md#teams)),
and yolo and the launch configuration are spawn-time host choices
(`--yolo`, `--launch-config`, or a launch configuration in
`oats-local.yaml`), not soul identity. The harness and model are a soul's
*preference* at most (`launch:`), which each machine overrides and spawn flags
(`--harness`, `--model`) win over.
A child-spawn policy is a spawn flag too (`--no-child-spawns`).

A soul never runs by itself. It is incarnated as an instance. Editing a soul
is a code change, reviewed in its repo.

### OATS operational knowledge is a capability

An agent's knowledge of OATS itself (status, spawn, retire, finding other
souls) is ordinary capability content: **`oats.core`** (package
`oats.framework`). Workspaces give it to every soul through
`defaults.capabilities: { oats.core: { from: package } }`; a soul may say
`oats.core: off`. **`oats.setup`** (same package) carries the whole-architecture
knowledge an onboarding expert needs. Neither is kernel magic; the kernel still
composes its own instance-boundary and work-mode briefings, and the "You run
on OATS" briefing is `oats.core`'s inject: a soul without `oats.core` gets no
OATS operating instructions, and `oats doctor --soul` says so.

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
  .agents/skills/                  # canonical skill tree, flat: the soul's skills and every module's, full copies
    <skill>/SKILL.md               # one level deep, where every harness discovers skills
  .claude/skills → ../.agents/skills
  .oats/modules/<capability>/      # the whole capability: oats.json, bin/, injects/, skills/ (hooks run from here)
  .oats/bin/oats → <kernel>/bin/oats.mjs  # the kernel that last launched this home: first on the harness's PATH
  work/                            # worktree, checkout symlink, attached tree, or private directory
  TASK.md                          # briefing and task (0600; the home itself is 0700)
  instance.json                    # provenance (below); `soulDir` = the soul directory hooks get as OATS_SOUL
  STATE.md, log.md, notes/         # optional, from the knowledge capability
```

Instances are local runtime state and normally gitignored
(`agents/*/instances/`). Souls travel with their repository; several
deployments can incarnate the same soul without collisions, because instance
homes, logs, notes, branches and messaging identities are local.

### `instance.json`: provenance is recorded, not declared

Besides the instance's identity, repository, branch, lineage, launch recipe and
composed skills and instructions, a spawn records:

```json
{
  "modules": {
    "acme-release-tooling": {
      "from": { "kind": "member", "repoKey": "github.com/acme/agents", "commit": "3f2a9c1e…" },
      "commit": "3f2a9c1e…", "digest": "sha256-…", "materializedAt": "2026-09-24T10:12:44.118Z"
    },
    "oats.okf": {
      "from": { "kind": "package", "package": "oats.okf", "version": "4.1.1", "commit": "e1d604f7…", "integrity": "sha256-…", "repoKey": "github.com/awebai/oats-okf" },
      "commit": "e1d604f7…", "digest": "sha256-…", "materializedAt": "2026-09-24T10:12:44.201Z"
    }
  },
  "providers": {
    "oats.okf": { "bindings-file": "/Users/ana/.oats/okf-bindings.json", "state-dir": "/Users/ana/.oats/okf", "harvest-runtime": "claude" },
    "acme-release-tooling": {}
  },
  "workspace": {
    "key": "github.com/acme/agents", "commit": "3f2a9c1e…", "resolution": "20ec8ec527311d71d0973086",
    "soul": { "repoKey": "github.com/acme/agents", "commit": "3f2a9c1e…" }
  },
  "teams": [{ "label": "ana-acme", "team": "ana-acme:ana.aweb.ai", "default": true, "from": "local", "via": ["default", "local"] },
            { "label": "engineering", "team": "engineering:acme.aweb.ai", "default": false, "from": "shared", "via": ["workspace"] }],
  "defaultTeam": { "label": "ana-acme", "team": "ana-acme:ana.aweb.ai", "from": "deployment" }
}
```

- `modules.<cap>`: where the copy came from, at which commit, and its content
  digest. `oats status` compares these with the workspace's current state and
  shows `moved` / `missing` per module (drift is shown, not prevented).
- `providers.<cap>`: the merged provider payload the capability was bound with
  (soul ⊕ machine settings ⊕ `--provider`), so a later inspection can tell
  which instance holds a retained seat or a one-off state root. `spawn
  --preview` shows the same map before anything exists, as `settings.<cap>`,
  beside `providers` (the `--provider` flags as given).
- `workspace`: the workspace commit observed at spawn, the soul's repo/commit,
  and the **resolution revision** the spawn decision bound. `oats status`
  compares `workspace.soul` with the member's current commit too: `soul: <name>
  from <member> @ <c7>  [member moved since …]` (`--json`: `instances[].soul`).
- `teams` / `defaultTeam`: the soul's teams at spawn, exactly as the providers
  received them (mapped teams only, each with `via`: why the soul may join it)
  and its default: evidence, never rewritten.
  A running home's hooks and messaging commands read the teams live
  ([capabilities.md](capabilities.md#teams-in-the-provider-environment)).

A running instance never changes under itself: a member moving or a package
bump affects only new spawns.

### The harness starts normally

OATS is a skill contributor, not a skill sandbox. The harness (pi, Claude Code,
Codex) starts with cwd = the instance home and its **own** skill discovery
intact: it sees, nearest first, the instance's `.agents/skills/` (soul skills
and the copied capability skills, all flat at `.agents/skills/<skill>/SKILL.md`,
the one level deep Claude Code discovers through `.claude/skills`), the repo's own `.agents/skills/` once it
works in `work/`, and whatever the operator keeps at machine level. All three
are intended. Two *composed* skills with one name is a spawn error naming both
capabilities (`E_SKILL_DUPLICATE`); a composed skill versus an ambient one is
the harness's own precedence. The `CLAUDE.md → AGENTS.md` and
`.claude/skills → ../.agents/skills` aliases are kept. OATS composes
instructions and pins model/provider settings; it excludes nothing.

### Unattended launches: folder trust

Claude Code and Codex ask before they work in a folder they have not seen, and
every instance home is new. A launch stopped at that prompt waits for a human,
so the operator trusts the **deployment directory** (where `oats-local.yaml`
is) once per harness. OATS only reads the harnesses' configuration; it never
writes it.

- **Claude Code** looks for an accepted entry for its folder or an ancestor, up
  to a git root. Instance homes are not inside a git repository, so one entry
  for the deployment covers every home under it. To add it, run `claude` in the
  deployment once and accept the prompt. That records
  `projects["<deployment>"].hasTrustDialogAccepted` in `~/.claude.json`
  (`$CLAUDE_CONFIG_DIR/.claude.json` when that is set).
- **Codex** applies only an exact entry: a trusted parent does not cover the
  folders below it. To give the operator's consent, run `codex` in the
  deployment once and choose "Trust and continue". That records
  `[projects."<deployment>"] trust_level = "trusted"` in
  `~/.codex/config.toml` (`$CODEX_HOME/config.toml`). With that entry, or one
  for an ancestor of the deployment, each codex launch trusts its own new home
  for that session (`-c 'projects={"<home>"={trust_level="trusted"}}'`) and
  leaves the config file unchanged. A yolo launch always does this. The plan
  re-reads the entry at every start.
- Every codex launch also passes `-c check_for_update_on_startup=false`, so
  Codex's "Update available" choice cannot block it.

When a claude or codex home is not covered, the spawn says so (text and
`--json` `warnings`): `the <harness> session will stop at its folder-trust
prompt: trust <deployment> once (<the step>)`. `oats readiness` reports the
same in `checks.configured` (code `harness-trust`, not required).

### Codex tool commands and the instance environment

Codex can run tool commands under its shared app-server daemon rather than as
children of the session OATS launched, and then they do not inherit the
session's environment. Codex (0.157.1) runs a session that has `-c` overrides
embedded, without the daemon, and every kernel codex launch has them, so an
OATS codex session does not appear in `codex agents`. So that the environment
does not depend on this, a codex launch also sets it for tool
commands explicitly with `-c shell_environment_policy.set.<NAME>="<value>"`:

- the instance: `OATS_INSTANCE`, `OATS_INSTANCE_HOME`;
- every capability's launch environment (for example the messaging
  provider's identity home and delivery mode);
- the launch configuration's literal values. A reference's value never goes
  on a command line.

`PATH` comes from the launching shell, with the home's `.oats/bin` first, so
only the execution passes it; the persisted command does not carry it. Codex
runs tool commands through the user's login shell, and a profile that prepends
directories puts those entries ahead of `.oats/bin`. A second `oats` in such a
directory is found first.

A capability command (`oats <namespace> …`) runs in the instance home that
`OATS_INSTANCE_HOME` names, else `OATS_HOME`. With neither set, it finds its
instance from the working directory. It uses the nearest enclosing directory laid out as
`<agents-root>/<soul>/instances/<name>` whose `instance.json` records that
name, and validates it like a home named by the environment. The walk uses the
directory as the shell names it (`$PWD`). That matters for an attached
instance, whose `work/` links into its owner's tree: below it, the physical
path is the owner's. A process that has no `$PWD` there would act as the
owner, so an attached instance runs capability commands from its home.

Inside an instance home the namespace is that home's. A `--soul` naming
another soul is refused (`E_HOME_MISMATCH`), and a namespace the home does
not have is `E_UNKNOWN_COMMAND`. Both name the home and what chose it (the
variable, or the working directory). To run a command as a spawn of another
soul would, run it from the deployment with `OATS_INSTANCE_HOME` and
`OATS_HOME` unset.

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
soul among the confirmed members, `external:` souls and the locked packages'
souls (an ambiguous bare name is `E_SOUL_AMBIGUOUS`, naming each qualified
form: `<member>/<soul>` or `<package>/<soul>`; a soul listed in
`oats-local.yaml` `souls.disabled` is `E_SOUL_DISABLED`) → fetches the soul's
source into `<agents-root>/<soul>/souls/<commit12>/` at its commit (a package
soul at the locked commit, verified against the lock's digest — see
[package souls](packages.md#package-souls); the home links that
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
previous instance of the soul), `teams` and `defaultTeam` (the soul's teams here), the `resolution` revision, the decision
it would bind, `providers` (the `--provider` map exactly as given) and
`settings.<cap>` (the merged payload each provider's binding will receive);
the apply refuses with `E_DECISION_STALE` if a member
moved in between. `--provider <cap> key=value` (repeatable; dotted keys nest)
must name a capability the soul resolves (`E_CAPABILITY_MISSING` otherwise) and
needs a workspace deployment. Spawn takes one soul and the flags it reads:
another positional, or a flag it does not know, is `E_BAD_ARGS` naming the
argument, before anything is created (a bare `key=value` is a provider
setting given without `--provider <capability>`). The full DTOs are in
[desktop-cli-api.md](desktop-cli-api.md#workspace-model-workspaceapi-2).

Examples of spawn hooks:

- `oats.okf` validates the soul's declaration and the bindings, and creates the
  instance knowledge files. With harvest on, it also registers a durable source
  and its harvest schedule; with harvest off (the default) it registers nothing.
  Missing knowledge configuration is an error, never permission to bootstrap an
  empty substitute.
- `oats.aweb` mints a messaging identity or, with
  `--provider oats.aweb identity.source=/abs/path/of/the/.aw/to/retain`, re-takes a retained
  one for exactly this instance.

### Work

The instance works in `./work`. With `oats.okf` it also keeps `STATE.md`
current, appends milestones to `log.md`, and captures non-obvious insights in
`notes/`.

It consults accepted knowledge remotely, at its accepted state, with
`oats okf index`, `cat` and `search` (the `okf-consultation` skill), and never
writes accepted knowledge; this is instruction, not an OS sandbox. With harvest
on, an independent harvester judges the instance's notes and session record and
proposes promotions by pull request. See [knowledge](knowledge.md).

### Spawning and coordinating with other agents

OATS agents can run `oats spawn` when their instructions or the
human ask them to create another expert instance. The spawned agent is another
full OATS instance, with its own soul, home, worktree, and lifecycle.

Spawn lineage is **explicit** and relation-based:
`oats spawn --relation child|sibling|parent|unrelated --relative-to <instance>`
declares what the new instance IS to an existing one (`--parent <instance>` is
sugar for `--relative-to <instance> --relation child`):

- **child**: nests under the anchor: `parentInstance` = anchor,
  `spawnOrigin: instance`.
- **parent**: the NEW instance becomes the anchor's parent: it inherits the
  anchor's old lineage slot, and the anchor's `instance.json` is re-pointed so
  its `parentInstance` is the new instance (a reviewer/maintainer of your work
  sits above you). Retirement splices lineage: when any instance retires,
  instances pointing at it (parent or sibling links) inherit its COMPLETE
  surviving lineage (both its parent and sibling links, whichever edge type
  pointed at it), so a retired parent-relation maintainer hands its children
  back to the parent it displaced (restoring absorbed sibling links too), and
  no instance is left pointing at a missing one. The splice scans the
  deployment's agents root.
- **sibling**: a peer in the anchor's cluster: it shares the anchor's parent
  when one exists; when the anchor is a root, the new instance records an
  explicit `siblingInstance` link so the cluster is still derivable from
  `oats status --json` (`parentInstance` + `siblingInstance` edges).
- **unrelated** (default): no link, operator-origin, top-level.

Attached-mode spawns are ALWAYS children of the owner of the shared work tree,
because an attached agent serves that owner; relation flags other than a
redundant child-of-owner are rejected. Any other spawn, including one from a
shell that inherited an agent's environment variables, is operator-origin and
appears top-level.
Agents spawning sub-agents should pass `--parent "$OATS_INSTANCE"` (or the
relation that fits).

If the workspace has a messaging capability such as aweb, spawned instances
can also receive identities and coordinate with each other automatically. The
tasks capability can provide shared work state while messaging provides conversation.

### Cloning an instance

A clone is a new instance of an existing instance's soul that starts from a
curated brief of what that instance knows, for a new goal. It is not a copy of
the source's home. Cloning is the official
[`oats.cloning`](https://github.com/awebai/oats-cloning) package, not a kernel
verb; a soul that may request clones composes it
(`oats.cloning: { from: package }`). An instance with the capability runs:

```bash
oats cloning request <source> --goal-file goal.md --relation independent|child|sibling|parent \
  [--relative-to <instance>] [--name <slug>] [--transcript exclude] [--base source|default|<ref>]
```

From the deployment directory the operator adds `--soul oats.cloning/cloner`.
The relation is required and is the kernel's spawn relation of the clone to the
anchor (`--relative-to`, the source by default); `independent` is the kernel's
`unrelated` and takes no anchor. The request spawns a short-lived
`oats.cloning/cloner`, which reads the source (its home files, work state and,
unless excluded, its transcript), writes the brief, spawns the clone with its
own identity, reports and retires itself. Only instances on this host can be
cloned. [Reusing working understanding](knowledge-theory.md#reusing-working-understanding-context-handoffs-and-cloning)
says what a clone carries and what it does not.

### Retire

Retirement runs active capability retire hooks in reverse spawn order before the home disappears. The aweb
integration deletes the instance identity here. With harvest on, `oats.okf`
takes a final capture of notes and the session record into durable custody; an
incomplete capture keeps the home for a retry. Retirement never waits for a
model or GitHub: processing continues after the home is gone.

Before any retire hook runs, retire preserves the instance's uncommitted and
unmerged work: a verified recovery under `.oats-retirement/recovery/`, named in
the summary. One retire writes at most one recovery directory. A worktree
recovery is a standalone clone that carries the
repository's local exclude rules (`info/exclude`, a configured
`core.excludesFile`), its `info/attributes` and the settings that change what
status reports (`core.fileMode`, `core.ignoreCase`, …), so its Git status
matches the source's. A recovery that
cannot be verified refuses with `E_WORK_PRESERVATION_FAILED` and keeps the
home. **`--force` does not skip work preservation.** It forces only past a
missing or unusable cleanup marker and past incomplete hook cleanup
([capabilities.md](capabilities.md)).

The recovery holds the state before the retire hooks at its top level, and
what the hooks changed under `after-hooks/`:

```text
<recovery>/
  recovery.json
  home/               the home before the retire hooks
  repo/ or work/      the work before the retire hooks (worktree, directory)
  after-hooks/
    home/             the home again, only if a hook changed home bytes
    repo/ or work/    the work again, unless it is proven unchanged
```

After the hooks, retire copies again each part the hooks moved. The home
moved when its bytes did. The work is copied again unless it is proven
unchanged. A Git status with the same rows is not that proof: a hook can
rewrite a file that was already modified, and the row stays the same. In
directory mode the work state is the bytes of `work/`. In worktree mode it
is what a work copy holds, for the worktree and for each nested repository
alike:

- its Git status, its branch and commit, its index entries (what
  `git ls-files -s` lists, with the skip-worktree and assume-unchanged
  marks) and the index's resolve-undo records (what
  `git ls-files --resolve-undo` lists);
- the state of an operation in progress (a merge, a rebase, a cherry-pick, a
  revert, a bisect);
- its tags and its stash;
- its exclude rules (`core.excludesFile` with the file it names, and
  `info/exclude`) and the settings that change what `git status` reports
  (`core.fileMode`, `core.ignoreCase`, `core.precomposeUnicode`,
  `core.symlinks`, `core.autocrlf`, `core.eol`, and `info/attributes`);
- the bytes of its files, Git metadata left out.

A worktree's tags, stash, exclude rules and settings are kept by the
repository it belongs to. They are part of the state because a work copy
carries them, so a tag or a stash made in that repository while the retire
hooks run causes one more work copy. A repository's other branches are not
part of the state: a recovery does not hold them. The one exception is a
worktree whose `HEAD` is detached: its copy holds the branch that repository
has checked out, so that branch is part of the state.

**A worktree that cannot be proven unchanged.** Two things make a worktree
not provable:

- a repository inside a nested repository. It is copied as plain files, its
  Git directory included, and nothing proves such a directory unchanged;
- a read of the state that fails, while `git status` works: one of the Git
  commands the list above is read with, or one of the files it is read from
  (`info/attributes`, the stash's log, an exclude file, the operation
  state), in the worktree's repository or in a nested one. A nested
  repository that Git cannot read is such a case, and so is a repository
  whose path has a line feed in it: Git prints its directories over more
  than one line. A read that fails is never taken for "not set" or for
  "unchanged", and neither is a file or directory that the retire cannot
  test for (no permission, for example): only one that is not there is
  absent.

A worktree that is not provable always has its work in the pre-hook
snapshot, also when only the home has something to preserve, and the work is
copied again after the hooks whenever there is something to preserve. Its
recovery is therefore larger. With nothing to preserve it retires like any
other. The copy reads what the proof reads, so where the proof failed the
copy may fail too: the retire then refuses with `E_WORK_PRESERVATION_FAILED`
before any retire hook runs. No recovery was written and nothing was
deleted; the retire has already stopped the session of a launched instance
by then, the instance is not retired, and its home and work are kept.

A retire hook can leave the worktree in that state too. The snapshot before
the hooks was then taken of a provable worktree, and may hold the home only.
After the hooks the work is copied under `after-hooks/`, whether or not
anything in it moved. When that copy cannot be made, the retire refuses with
`E_WORK_PRESERVATION_FAILED` after the hooks have run, and the home, the
work and the recovery written before the hooks are all kept.

Every refusal of the copy made before the hooks, whatever its cause, ends by
saying what the retire has done by then: no retire hook has run, no recovery
was written and nothing was deleted, the instance is not retired, its home
and work are kept, and its session has been stopped, or this retire stopped
no session. A refusal after the hooks does not say that.

A snapshot that holds the home only (the work had nothing to preserve
before the hooks) has no work copy to stand for it. It gets the work under
`after-hooks/` when the hooks moved it, and also when they did not but
something beyond the home is there to preserve after them: a commit that no
other branch reaches any more, or a retirement baseline that is gone.

The Git state is read at every inspection. When there is something to
preserve before the hooks, the files are read once before the recovery is
written, and a pre-hook copy of the work is verified against that read. They
are read at most once more after the hooks: to prove the work unchanged when
the Git state did not move, or to verify the copy when it did. With nothing
preserved before the hooks, nothing is compared: a
recovery is written after them whenever there is something to preserve.

A worktree whose `git status` fails refuses the retire with
`E_WORK_INSPECTION_FAILED` at the first inspection: no recovery was written,
nothing was deleted, and the retire has not stopped the instance's session.
A directory in place of `info/exclude`, or of the file `core.excludesFile`
names, is such a case: Git itself refuses to use it. Any other read of the
state that fails does not refuse here: it makes the worktree not provable,
as described above.

**A socket, a FIFO or a device file in the worktree.** An entry that is not
a file, a directory or a symbolic link has no bytes to read or to copy, and
Git prints no status row for it, so a worktree that holds one can read as
clean. In worktree mode, when there is something to preserve before the
hooks, such an entry anywhere in the worktree refuses the retire:

- **before the hooks**, with `E_WORK_INSPECTION_FAILED`: no hook has run, no
  recovery was written and nothing was deleted, however often the retire is
  retried. The message names the entry and says what to do: safely stop the
  process or resource that owns it, or move the entry elsewhere, then retry.
  The entry may be a live endpoint, so deleting it is not the advice. The
  retire has already stopped the session of a launched instance by then: the
  instance's session is stopped, the instance is not retired, and its home
  is kept. The message says so, and says that this retire stopped no session
  when the instance had none to stop. To continue, deal with the entry and run
  `oats retire <instance>` again, or start the session again in the same
  home with `oats session start --home <abs>`. A self-retire (`--self`) is
  completed by its detached completion, which stops the session and refuses
  in the same way; the refusal is recorded beside the home, as described
  below. After a refused self-retire only `oats retire <instance>`
  continues: `oats session start` refuses while the self-retire's pending
  marker is there, and a retire clears it. Only `--self --keep-dir`, which
  stays in the calling process, refuses with the session still running;
- **after the hooks**, when a retire hook left the entry behind: the hooks
  have run, and the home, the work and the recovery written before the hooks
  are all kept. The code is `E_WORK_INSPECTION_FAILED` when the Git state is
  as it was, and `E_WORK_PRESERVATION_FAILED` when the hook also moved the
  Git state, because the copy then meets the entry before the files are
  read; that message names the entry too.

A worktree that cannot be proven unchanged is copied without the read, so
there the refusal comes from the copy, as `E_WORK_PRESERVATION_FAILED`.

The home is not copied again because the work is. Some entries of a home are
the kernel's own records and do not count as changes to it:
`.oats-events.jsonl`, `.oats-stop.json`, `.oats-stop-receipt.json` and
`.oats-stop-receipt.*.json`, `.oats-restart.json`,
`.oats-agents-md.*.previous`, `.claude/settings.json`, and the
`spawnCompleted` and `wake` fields of `instance.json`. They are copied with
the home and never on their own, so when a hook moved only the work the
recovery holds them as of the pre-hook snapshot. The retire's own events are
written to the workspace log (`<deployment>/.agents/events/`), never to the
home's.

Each part under `after-hooks/` is whole and verified, not a delta, and it is
verified before the worktree step and before the home is removed.
`after-hooks/` is not a complete picture of the instance after the hooks: its
`home/` exists only when the home's own bytes moved, and a part that is not
there is the one in the pre-hook snapshot. Nothing in
the pre-hook `home/`, `repo/` or `work/` is rewritten. If that copy fails or
cannot be verified, retire refuses with `E_WORK_PRESERVATION_FAILED`, keeps
the home and leaves the pre-hook recovery intact. An instance with nothing to
preserve before the hooks, and something after them, gets its one recovery
then: the hooks' bytes are under `home/`, `repo/` or `work/`, and there is no
`after-hooks/`.

The summary prints the recovery once. The path and the `after-hooks/` line
are how to find both snapshots; each line after the path appears only when
it applies:

```text
Retired dev-1 (agent dev)
Work that was not committed has been preserved: changed instance-home bytes, untracked or ignored worktree bytes
  /w/agents/dev/instances/.oats-retirement/recovery/dev-1-AbC123 (46.2 MiB)
  copied from the home: .oats/ (854 KiB), .agents/ (138 KiB), notes/ (2.0 KiB), STATE.md (512 B) — 1.0 MiB in total
  copied outputs: scratch/ (1.2 MiB), note.txt (12 B) — 1.2 MiB in total
  not copied: .aw, .oats-aweb (oats.aweb)
  after the retire hooks: home copied again under after-hooks/
```

`recovery.json` records the recovery's `phase`. It is `"before-hooks"` when the
pre-hook snapshot is written, and `"complete"` once the post-hook check has
concluded, together with `afterHooks: { home, work }` when `after-hooks/` was
written. `after-hooks/` counts only when `recovery.json` lists it. A retried
retire, after incomplete cleanup or after a refused or interrupted attempt,
starts over: it writes its own recovery, its receipt names only that one, and
it never reads, amends or deletes an earlier one. A directory that an earlier
attempt left at `before-hooks` is not corrupt: it is a complete, verified
pre-hook snapshot.

Home entries that a capability declared in `retirement.disposable.home`
([capabilities.md](capabilities.md#manifest)) are provider-owned state, not
the instance's work, and are not copied: neither before nor after the hooks.
They stay in the home until the home is removed, retire hooks still see them,
and a home kept for a retry keeps them. The summary lists the ones that
exist under "not copied", by name, with the declaring capability. The
declaration is recorded at spawn: a home spawned before its capability
declared them gains no exclusion from a package update, and is copied whole.

Retire stops the harness through the home's session receipt. A home spawned
before 0.25.9 has none. It retires only when its session is observably gone:
instance.json records no launch, or the recorded tmux server is not running,
or the recorded window is gone and no pane on that server works in the home;
and, always, no live process on this host works in the home (a harness
started by hand elsewhere counts). Retire then runs its hooks and preserves
its work as usual. If the recorded window is still there, a pane or a process
works in the home (the refusal names its pid), or the process scan (`lsof`)
cannot run, retire refuses with
`E_RUNTIME_ENDPOINT_UNKNOWN`, even with `--force`: stop that session yourself,
then retire again. `oats retire <instance> --plan` says which case applies.

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

When a retire hook reports incomplete cleanup, the home is quarantined before
any worktree step: the worktree, its git admin entry and the branch stay
exactly as they were, so the retry can reach the hook and the work it needs.
The retry does the worktree step only once nothing else is outstanding:
retain by default, remove with `--discard-worktree` or `--delete-branch`.
`--force` removes the home regardless, so it does the worktree step first. A
work directory whose git admin entry is gone is never removed: the hooks still
run, the home is kept, and `--force` refuses it until you move the directory
out or delete it by hand.

Retire never deletes a branch unless you pass `--delete-branch`, and then
only the verified branch: not on a quarantine, its retry or `--force`. A
spawn that fails deletes the branch it created only while the branch's tip
is still where the spawn created it. If something was committed there, the
branch is kept and the failure says so.

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
  the applicable review rules. The knowledge harvester proposes changes to the
  external knowledge base, never to soul files or skills.

Agents move between the two as the task needs; the boundary is what each
directory is for, not a place to settle in.

### `worktree` — isolated branch

`work/` is a git worktree on the instance's own branch, by default
`agents/<instance>`. The worktree is created from the member's **clone**, found
as `--repo`, then `oats-local.yaml` `clones:`, then `<deployment>/<member name>`
(`E_CLONE_MISSING` / `E_CLONE_MISMATCH` otherwise — see
[configuration.md](configuration.md)).

The branch starts at the commit of the soul's repository that the spawn
observed (the one it resolved the soul at), not at what the clone has checked
out: the clone may be a human's checkout or a shared reference, far behind.
The spawn fetches that commit by id into the clone from the remote that names
the repository, and never moves the clone's own branches, remote-tracking refs
or work tree. A commit that cannot be fetched refuses the spawn
(`E_REMOTE_UNREADABLE`, naming the clone and the commit); it never falls back
to the clone's branch. The fetch never prompts (ssh runs in BatchMode, askpass
is refused). A server that serves only its advertised refs (protocol v0 without
`allowAnySHA1InWant`) refuses a commit its branches have moved past; `--base`
is then the way on. `--base <ref>` names another start point in the clone;
a `--repo` that is not a clone of the soul's repository starts at its `HEAD`.
The spawn result and `instance.json` record the start point as
`base: {ref, oid}`.

Use this for agents that will edit code or docs independently.

Rules:

- Build, test, and commit from `work/`, on your own branch.
- Never run git from the repo's main checkout — it resolves to the wrong branch
  and skips review.
- Do not create extra worktrees. Ask for another instance if parallel work is
  needed.

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
instance's `<home>/work`); it is a spawn-time choice (`--work attached`) for
service agents such as reviewers.

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
composition, provider trust and harness preflight still apply. Retirement preserves nonempty work in verified recovery storage beside the
home (`workRecovery.path/work`) before deleting it, including files created by
hooks; directory work has no disposable-root exemptions. A retire hook's later
change to work is in the same recovery, under
`workRecovery.path/after-hooks/work` (under `workRecovery.path/work` when
nothing needed preserving before the hooks). The work-root cannot be
exchanged for a symlink. Recovery does not replace the worker's delivery protocol.

### `workspace` — cross-repo coordinator

`work/` is a symlink to the **whole deployment**: the directory holding
`oats-local.yaml`, with `agents/` and the member clones that sit beside it, not
a repo (a member cloned elsewhere is reached through `oats-local.yaml`
`clones:`). Every
member repo is read-context; the instance's product is coordination:
routing, analysis, task-writing, messaging, spawning specialists.

Use this for free agents that support cross-repo work but are not tied to
any one repo: coordinators, dispatchers, architects. The soul itself still
lives in (and is committed to) its member repository; where the soul lives and
where it works are decoupled.

Rules:

- Read freely across member repos; **never edit or commit inside them** —
  route changes to the owning repo's agents or the human.
- No git state operations in any member repo.
- Knowledge promotion follows the knowledge capability's own protocol, never
  direct edits through the workspace view.

The instance records no branch: the workspace is not a Git tree.

## Agents root

Instance homes live under the deployment's agents root,
`<deployment>/agents/<soul>/instances/<instance>/`. Commands find the
deployment by walking up to `oats-local.yaml`, so an agent that spawns after
`cd work/` reaches the same agents root as one spawning from the deployment
directory. `PI_AGENTS_ROOT` overrides the root.

Three things stay independent, and are meant to:

- **Invocation**: where you ran the command;
- **Scope**: the deployment, resolved from the context directory, and
  steerable with an explicit `--dir <path>`;
- **`work/`**: the instance's repository view, which may well be a linked
  worktree.

If an agents root sits inside a linked Git worktree, homes land in the
soul-owning repo's primary checkout instead: storage maps to the equivalent
path there, so homes never depend on a disposable worktree. When placement cannot be established (Git owns the
location but the repository cannot be read, the primary checkout is missing,
or the destination falls outside the agent's own directory), the spawn fails
closed with **`E_NO_CANONICAL_ROOT`** and creates nothing.

Every instance is told its own home as **`OATS_INSTANCE_HOME`** (absolute), and
instructions refer to it as `<instance-home>`. The two environments differ, so
they are stated separately:

- **Runtime session**: `OATS_INSTANCE_HOME` and `OATS_INSTANCE`, for every
  harness. The pi extension reads `OATS_INSTANCE_HOME` too; the `PI_AGENT_*`
  names are not set (they stay reserved, so a launch configuration cannot set
  them).
- **Lifecycle hooks**: `OATS_INSTANCE_HOME` and `OATS_HOME`, alongside the rest of
  the hook contract. `OATS_HOME` predates `OATS_INSTANCE_HOME` and is kept because
  shipped capability hooks read it; it is **not** exported to harness sessions.

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
```

Every agent is a soul: a member soul, or a package soul homed under
`agents/<package>--<soul>/`. There are no local souls: author a soul in a
member repository's `souls/<name>` (`soul.yaml` + `AGENTS.md`) and run
`oats sync`.

Homes left by mechanisms earlier releases removed are reported once by
`oats status` and `oats doctor`: `legacy-local-agents` (a `local-agents/`
directory) and `legacy-captured-home`. Retire such instances and re-spawn the
soul from the deployment.
