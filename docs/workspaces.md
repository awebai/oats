# Workspaces — one workspace per organisation, members are trust, nothing is installed

This is the OATS workspace model (v2, the 0.25 line). It replaces the per-soul
`source:` grammar, the installed-capability tier and `oats-config.yaml`. The
normative record is the Decision concept
`agents/oats-expert/soul/knowledge/decisions/workspace-model-v2.md`; the module
contracts the kernel is built against are in
[design/2026-09-23-workspace-module-contracts.md](design/2026-09-23-workspace-module-contracts.md);
a full worked example (an imaginary company with three teams) is in
[design/2026-09-23-simplified-workspace-model.md](design/2026-09-23-simplified-workspace-model.md).

## The rule

**Every capability an instance runs is copied whole into that instance at
spawn. A capability comes from one of two kinds of source; only one kind is
versioned.**

| Source kind | `from:` | Versioned | Trust |
|---|---|---|---|
| Member repo | `<repo key>` or `here` | no — always the member's **latest** default-branch state | membership (the reciprocal handshake) |
| Package | `package` | yes — the version pinned in the workspace's `packages:`; `oats-lock.json` records the exact commit + integrity | the declaration in `packages:` (no separate approval) |

A soul names each capability **with where it comes from — a location, never a
version**. The workspace's `packages:` says which version; materialization
*records* the exact state (repo or package, commit, content digest) in the
instance's `instance.json`. Resolution is a handshake check plus a lookup —
never a search.

Nothing is installed. There is no installed-capability directory, no activation
step, no `oats install`/`use`/`init`/`restore`. A fetch cache may exist under
the OS cache directory as invisible plumbing; no file refers to it.

## The files

Four declaration files and one lock. Three of them are shared through Git
(`oats-workspace.yaml`, `oats-membership.yaml`, `soul.yaml`); one is per
machine (`oats-local.yaml`); the lock (`oats-lock.json`) sits beside
`oats-local.yaml` and is identical on every machine that synced the same
workspace commit. Schemas: [`oats-workspace.schema.json`](oats-workspace.schema.json),
[`oats-membership.schema.json`](oats-membership.schema.json),
[`soul.schema.json`](soul.schema.json), [`oats-local.schema.json`](oats-local.schema.json);
the lock's format is in [packages](packages.md#lock-v3). The JSON schemas encode
shapes; domain rules (declared teams, duplicate members, canonical `from:` keys,
the two `packages:` value forms) live in the kernel's `validateWorkspace` /
`validateSoul`, which are the authority.

### `oats-workspace.yaml` — the one shared declaration

Lives in the repository that **hosts** the workspace (often a dedicated
`agents` repo, but any member can host it). One per organisation.

```yaml
schemaVersion: 2
name: acme

members:                                   # repo refs, NO @revision (E_WORKSPACE_SCHEMA)
  - git:github.com/acme/agents             # the host is a member too — it backlinks like any other
  - git:github.com/acme/platform
  - git:github.com/acme/tools              # a member that ALSO publishes a package (see below)

packages:                                  # the ONLY versioned things
  oats.framework: v1.2.0                   # bare version → resolves through the official catalog
  oats.okf: v4.0.0
  acme.tools: git:github.com/acme/tools@v0.4.0   # outside the catalog → git:<repo>@<tag|OID>; still a package

teams:                                     # labels, declared once so they cannot drift
  global:      { description: Org-wide souls and house capabilities }
  engineering: { description: Platform and release automation }

defaults:
  capabilities:
    oats.core: { from: package }
    acme-house-style: { from: github.com/acme/agents }   # a CANONICAL repo key: host/path, no scheme, no .git
  knowledge: { oats.okf: { from: package } }             # one slot default at most; a soul may say `none`
  messaging: none
  tasks: none
  byTeam:
    engineering:
      capabilities: { acme-release-tooling: { from: github.com/acme/agents } }

stores:                                    # knowledge stores, declared once
  org: git:github.com/acme/knowledge

messaging:                                 # an opaque provider payload for the messaging slot
  private: per-human

external:                                  # souls borrowed from NON-members; revision REQUIRED
  - source: git:github.com/oss-collective/experts@9c4e1f2a9c4e1f2a9c4e1f2a9c4e1f2a9c4e1f2a
    soul: souls/security-reviewer
```

Refused by the schema: absolute filesystem paths as values anywhere (host state
belongs in `oats-local.yaml`), `@revision` on members, unknown top-level keys.
A `from:` value is `package`, `here` (souls only) or a **canonical repo key**
exactly as the kernel spells it (`parseRepoRef(ref).key`: lowercase host,
`org/repo`, no scheme, no `git:`, no `.git`; `local/<abs-path>` for a
file/bare-directory remote). Any other spelling is a schema error at
validation, not a late membership error.

### `oats-membership.yaml` — the backlink, in every member

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents      # "I am a member of acme"
team: engineering                          # optional: default team label for this repo's items
```

Nothing else. It replaces `oats.yaml`; there are no export lists.

### `souls/<name>/soul.yaml` — where each capability comes from

```yaml
schemaVersion: 2
name: release-manager
description: Cuts, verifies and announces releases.
work: worktree                             # worktree | checkout | directory | workspace
team: engineering                          # optional; else the repo's default; else "unassigned"

capabilities:
  acme-release-tooling: { from: here }     # `here` = the repo this soul.yaml lives in
  acme-deploy: { from: package }           # provided by acme.tools, pinned in packages:
  acme-house-style: off                    # removes a workspace default

knowledge:                                 # provider payload, opaque to the kernel — the slot capability's BINDING keys
  harvest-runtime: claude                  # (oats.okf 2.1.3: what this soul owns/reads is in souls/<name>/okf.json, not here — see below)
messaging:
  channels: [acme-eng]
tasks: none                                # empties the slot

compatibility:                             # optional FLOORS on package versions — constraints, not sources
  oats.okf: ">=2.1"
```

Beside it: `AGENTS.md` (canonical), `CLAUDE.md → AGENTS.md`, `skills/`, and
whatever the slot providers read from the soul directory — for `oats.okf`
2.1.3 that is **`okf.json`** (`{ version: 1, owner, owns: ["<base>/<node>"],
reads: […] }`, written by `oats okf init|migrate`), the soul's knowledge
declaration; it travels with the soul into the per-commit soul cache. The
`knowledge:` payload on `soul.yaml` reaches OKF as `OATS_SETTINGS` and may
carry only the binding's settings keys (`bindings-file`, `state-dir`,
`harvest-runtime`, `harvest-model`); `owns`/`reads`/`root` there are refused by
the provider, not read (a soul payload grammar is an OKF follow-up). Every
`souls/*/soul.yaml` in a member is listed and spawnable — souls have no
private mode (`private:` in a soul.yaml is ignored since 0.26.0, with a
`soul-private-ignored` warning). A soul's
`name` must equal its directory name; the first of two souls declaring one
name (by path) is listed, the second is a problem.

### `capabilities/<name>/oats.json` — the manifest, unchanged shape

The capability manifest is the one file that did not change (see
[capabilities.md](capabilities.md)). Discovery relies on `capability` (the same
`^[a-z0-9][a-z0-9._-]*$` grammar every `capabilities:` key uses), `version`,
`layer`, and may read `private: true` (a **repo-owned** capability) and
`team: <label>`. `version` is
informational for member capabilities — a materialized copy is identified by
its content digest.

### `oats-local.yaml` — the only per-machine file

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents      # observed over the remote; need not be cloned
clones:                                    # optional: where member clones live, if not the convention
  github.com/acme/platform: /Users/ana/src/acme-platform
settings:                                  # host-owned values the manifests ask for
  oats.okf:
    bindings-file: /Users/ana/.oats/okf-bindings.json
    state-dir: /Users/ana/.oats/okf
souls:
  disabled: [data-analyst]                 # not run on this machine (E_SOUL_DISABLED); oats.okf/knowledge-harvester names a package soul
host:
  name: ana-laptop                         # this machine's name: runs the workspace triggers/schedules whose runsOn names it
triggers:
  disabled: [knowledge/okf-harvest-review] # workspace triggers this host does not run (oats trigger disable)
schedules:
  disabled: [platform/nightly-digest]      # workspace schedules this host does not run (oats schedule disable)
```

`host`, `triggers.disabled` and `schedules.disabled` (0.29.0) are machine facts:
see [schedules.md#workspace-triggers-and-schedules](schedules.md#workspace-triggers-and-schedules).

See [configuration.md](configuration.md). `oats-config.yaml` no longer exists.

### `oats-lock.json` — lock v3

Written by `oats sync`; the only persisted state at the deployment besides
`oats-local.yaml`. See [packages.md](packages.md).

## Membership and trust

**Reciprocal membership is a hard gate.** A repo is a member only when
`oats-workspace.yaml` lists it **and** the repo's `oats-membership.yaml` names
the workspace back. One file per side; a copied backlink in a fork, or a folder
with the right name, is not admission.

**Membership is the whole trust decision for member capabilities** — the same
model as a repo's committed `.agents/skills/`: whoever can push to the repo
decides what runs, and the branch's latest state is what runs. No per-operator
trust lists, no per-capability approval for members. Packages come from
*outside* that boundary, and **declaring one in the workspace's `packages:` is
the trust decision** (human decision, 2026-09-24): people install a package only
when they trust it, so there is no second, per-version approval step. The lock
is reproducibility, not approval — it pins the exact commit and content
integrity, and `oats sync` refuses drift (a moved tag, changed content, an
edited capability list). A spawn admits only a locked package the workspace
**still declares**: one removed from `packages:` but left in a stale lock is
`E_PACKAGE_MISSING { reason: "undeclared" }` until `oats sync` drops it.

**The handshake is observed with the operator's own Git read access, in one
access context.** The kernel reads both halves over the remotes
(`git ls-remote`, shallow fetches, the operator's own credential helpers,
never a prompt). A half that cannot be read makes the member *unconfirmed*,
never a half-success. `oats workspace status` and `oats sync` show each member
as `confirmed` or the reason it is not:

| status | meaning |
|---|---|
| `confirmed` | listed and backlinks to this workspace |
| `not-listed` | the workspace does not list the repo |
| `no-backlink` | no (or invalid) `oats-membership.yaml` at the member's default branch |
| `backlink-elsewhere` | the member names a different workspace (a case-only difference is flagged: repo paths are case-sensitive identities) |
| `cannot-read` | the operator cannot read the member (auth / not-found / network / timeout) |

An unconfirmed member contributes nothing but its row: its souls are invisible,
its capabilities unresolvable (`E_NOT_A_MEMBER` / `E_MEMBERSHIP_UNCONFIRMED`).
Reading the workspace repo *is* being in the workspace — a workspace's access
control is Git's.

**Repo-owned capabilities.** `private: true` in a capability's `oats.json`
makes it **repo-owned**: it is listed like any other capability (with
`private: true`; the human table marks it "(repo-owned)"), and it is usable
only by souls of the same repo (`E_CAPABILITY_PRIVATE` otherwise). Souls have
no private mode: every soul of a confirmed member is listed and spawnable.

**External souls.** `external:` adopts a soul by reference from a repo that is
**not** a member, pinned to a full commit. No handshake is asked for and none is
read; the soul gets no member-tier capabilities of its own repo; it is
"source-complete" (its skills travel with it) and the workspace's defaults fill
its slots. An `external[].team` overrides the soul's own `team`.

**Package souls.** A package may ship souls (`souls:` in `oats-package.json`,
0.28.0): they are listed from the lock for each package the workspace declares,
named `<package>/<soul>` (a bare name when unique), resolved like any soul
(`from: here` = their own package at the locked commit) and trusted as the
package is. See [packages](packages.md#package-souls).

## Member tier vs package tier — the non-collapse rule

A repository may be a **member** (it completed the handshake; its `souls/*` and
`capabilities/*` are member-tier: latest state, trusted by membership) **and** a
**package publisher** (its `oats-package/` is consumed only through
`packages:`: versioned and locked). The two never collapse:

- `from: <repo key>` looks **only** under `<repo>/capabilities/<name>/oats.json`
  at the member's latest state. It never looks inside `oats-package/`. A name
  that exists only inside the repo's package fails with `E_CAPABILITY_MISSING`
  and the hint `provided by package <id>; use from: package`.
- `from: package` looks **only** in the lock (which package provides the
  capability). It never looks at member capabilities, even when the package's
  repo is a member.
- Discovery reports a member's `oats-package/` as `publishes: { package,
  version }` on the member row (informational) and does **not** list the
  package's capabilities as member capabilities.

So the framework's own souls say `oats.okf: { from: package }` even though
`oats-okf` is a member of the OATS workspace — and every package repo carries a
member soul that is the expert in that capability (`okf-expert`, `aweb-expert`,
…), discoverable at latest state like any member soul.

## Packages, lock, catalog

`packages:` values have exactly two forms:

- a **bare version** (`v2.1.3`, `2.1.3`, `v1.0.0-rc.1`) — resolved through the
  official catalog (`package-catalog.json` in the `oats` repo; the reviewed
  list, see [official-catalog.md](official-catalog.md)). This is
  the only way a package becomes *pinnable by id*.
- **`git:<repo>@<ref>`** — a direct package ref: `<repo>` is any ref the kernel
  understands (`github.com/org/repo`, `https://…`, `git@host:…`, `/abs/bare.git`,
  `file:///…`), `<ref>` a tag name or a full commit OID. The package is read at
  `oats-package/` inside that repo.

Both are packages: versioned and locked. A ref that resolves to a **branch** is
refused (`E_PACKAGE_INTEGRITY { why: "branch" }`) — versions are immutable. A
tag that moved (same version string, different commit), or content that no
longer matches the locked integrity, fails with `E_PACKAGE_INTEGRITY` on the
next `oats sync`.

**There is no package approval** (human decision, 2026-09-24). Declaring a
package in `packages:` is the trust decision; `oats sync` asks nothing and
`--approve` is `E_BAD_ARGS`. `oats sync` confirms membership, resolves every
`packages:` entry to a commit + content digest, writes `oats-lock.json`
(lockfileVersion 3), creates `agents/` if absent, reports what changed and
exits `0`. A lock written by an earlier kernel may still carry an `approved`
record per entry: it is ignored, and the next write drops it. `oats package add <id> <version|git:…@…>` / `oats package remove <id>` edit
`packages:` in the workspace file when it is tracked by the current checkout,
else print the line to add — the workspace file is shared through Git. Details:
[packages.md](packages.md).

## Resolution, spelled out

For each `(name, from)` in
`defaults.<slot>` ⊕ `defaults.capabilities` ⊕ `defaults.byTeam[<soul team>]` ⊕
`soul.capabilities` (later wins; `off` removes; a soul `<slot>: none` drops
the workspace's slot default):

```
from: package → some locked package provides `name`            else E_PACKAGE_MISSING (run `oats sync`)
              → read its manifests at the locked commit; the lock's capability list must match   else E_PACKAGE_INTEGRITY
              → copy; record package/version/commit/digest
from: <repo>  → <repo> is a CONFIRMED member                     else E_NOT_A_MEMBER / E_MEMBERSHIP_UNCONFIRMED
 (or `here`)  → it has capabilities/<name>/oats.json             else E_CAPABILITY_MISSING
              → not private, unless <repo> is the soul's own    else E_CAPABILITY_PRIVATE
              → copy from the member's current state; record repo/commit/digest

slots   a module whose manifest says `layer: X` fills slot X; two → E_SLOT_CONFLICT;
        a slot default must be a capability of that layer; soul `X: none` empties X
skills  duplicate names within the composed set → E_SKILL_DUPLICATE (names both capabilities)
floors  soul.compatibility.<cap> is checked against the package's version → E_COMPATIBILITY
```

The result is an immutable **resolution** with a `revision` (a hash of
everything above); the spawn decision binds it, so a member that moved between
preview and apply is `E_DECISION_STALE`, not a silent drift.

## Materialization and the instance home

At spawn every resolved capability is **copied whole** into the instance home —
skills, injects, scripts, hooks — from the remote at the recorded commit.
Nothing is symlinked, nothing is shared between instances.

```
<agents-root>/<soul>/instances/<instance>/
├── AGENTS.md                          # composed: soul AGENTS.md + kernel/work-mode blocks + each module's inject
│                                      #   (the "You run on OATS" block is oats.core's inject; the kernel ships no copy)
├── CLAUDE.md → AGENTS.md
├── .agents/skills/<capability>/<skill>/SKILL.md    # full copies; where pi/codex look
├── .claude/skills → ../.agents/skills
├── .oats/modules/<capability>/        # the full capability copy: oats.json, bin/, injects/, skills/
├── instance.json                      # modules{}, providers{}, workspace{} recorded here
├── TASK.md
└── work/
```

`instance.json.modules.<cap>` records `from` (`{ kind: "member", repoKey,
commit }` or `{ kind: "package", package, version, commit, integrity, repoKey }`),
`commit`, `digest` (sha256 of the copied tree) and `materializedAt`;
`instance.json.providers.<cap>` records the merged provider payload. A running
instance never changes under itself: a member moving or `packages:` being
bumped affects only new spawns. Details and DTOs:
[souls-and-instances.md](souls-and-instances.md), [desktop-cli-api.md](desktop-cli-api.md).

**Drift is shown, not prevented.** `oats status` compares each instance's
recorded modules — and its recorded **soul source** (`instance.json.workspace.soul`)
— with the workspace's current picture: `current`, `moved` (member or package
now at another commit) or `missing` (capability no longer present, member
unconfirmed, package no longer locked). The text form is `soul: <name> from
<member> @ <c7>  [member moved since …]` above the module rows; `--json`
carries `instances[].soul`. `oats spawn --preview` lists `changedSince` the
newest previous instance of the same soul, plus `providers` (the `--provider`
map as given) and `settings.<cap>` (the merged payload each provider receives).

**Harnesses start normally.** OATS is a skill contributor, not a skill sandbox:
cwd = the instance home, the harness's own skill discovery intact
(`~/.pi/agent/skills`, `.agents/skills` up the tree, `.claude/`, …); machine-
and repo-level skills resolve exactly as they would without OATS. OATS
composes instructions (`AGENTS.md`) and pins model/provider settings; it does
not exclude anything.

## Teams

`teams:` declares labels once (`global`, `engineering`, …) so they cannot drift
into typos. A soul carries `team:` — one label or a list (`team: [engineering,
reviewers]`, the first the primary) — else its repo's default from
`oats-membership.yaml` (same shape), else `unassigned`; a capability carries one
label. A label not declared in `teams:` is `E_TEAM_UNKNOWN` (the item is still
listed); a declared label without a `messaging.byTeam` entry is the
`unmapped-team-label` warning. `defaults.byTeam.<team>.capabilities` adds
capabilities additively for souls with that label, for each label in order
(`off` removes; two labels that disagree are `E_TEAM_CONFLICT`). Each label is
an *eligible* messaging team the provider may join on request — see
[capabilities.md](capabilities.md#several-team-labels). **A
label never gates, restricts, changes trust or partitions the knowledge
store** — it organises and can supply defaults. The messaging provider's payload
(private teams, channels) lives under `messaging:`, so "team" means one thing.

## Provider payloads have three homes

| What it is | Where | Example |
|---|---|---|
| True of every instance of the soul | `soul.yaml` → `knowledge:` / `messaging:` / `tasks:` | `messaging: { channels: [acme-eng] }`; `knowledge: { harvest-runtime: claude }` |
| A fact about this machine | `oats-local.yaml` → `settings.<cap>.<key>` (absolute paths are refused in the workspace file) | `settings.oats.okf.state-dir: /Users/ana/.oats/okf` |
| A fact about **this spawn** | `oats spawn … --provider <cap> key=value` (repeatable; dotted keys nest) → `instance.json.providers.<cap>` | `--provider oats.aweb identity.source=/abs/path/to/retained/.aw` |

The merged payload is `workspace.messaging` (messaging slot only; its base
keys, with `byTeam` stripped) ⊕ soul slot payload ⊕ `local.settings[cap]` ⊕
`spawn.providers[cap]` — objects deep-merge, later wins on scalars and arrays.
**No `byTeam[<label>]` is merged into it, the primary's included** (teams
amendment K): each label's `base ⊕ byTeam[label]` reaches the provider only as
that label's entry in `OATS_TEAMS` (the preview's `teams`). So `settings.team`
(and `OATS_TEAM_ID`) is the personal team if the host, the soul or the spawn
set one; empty means the provider's own default. The provider's own `binding` contract
(`normalize → bind → check`) runs over the merged payload exactly as before.
Two teams, two messaging identities, one workspace:

```yaml
teams: { oss: { description: Open protocol }, cloud: { description: Hosted application } }
messaging:
  byTeam:
    oss:   { team: aweb:example.oss }
    cloud: { team: aweb:example.cloud }
```

A soul with `team: cloud` hands its messaging provider the eligible team
`{ label: cloud, team: aweb:example.cloud, mapped: true, payload: { team: aweb:example.cloud, … } }`
in `OATS_TEAMS`; its settings carry no `team` unless the host, soul or spawn set
one. A label under `byTeam` that is not declared in `teams:` is
`E_WORKSPACE_SCHEMA`. **Joining an eligible team is the provider's explicit
act.** `spawn --preview` shows the merged `settings.<cap>` and the `teams`, so
the delivery is verifiable, and `instance.json` records both. With oats.aweb
1.13.1 (which reads `team` from its settings and ignores `OATS_TEAMS`) the
primary identity therefore mints into the personal team: the `.aw` root's
active team, or the one the host set. What the payload does not change is
**where the `.aw` root is found**: the hook still searches
bounded candidates, first hit wins — the instance home, the Git repository
containing it, the soul's work repository and the Git repository containing
it, then the deployment directory (`OATS_WORKSPACE`); never the user home or
above the deployment — and that root must hold a membership of the named team (the deployment's `.aw`
joined to every team its labels name is the simple layout). On oats.aweb
1.11.2 `team` was ignored (the root's active team won), so `byTeam` there is
a recorded intent only.
A store (`stores: { <name>: <repo ref> }`) names a repository; where a
knowledge base lives inside it is the knowledge provider's own concern — for
OKF 2.1.3 that is the **bindings file** (`bases.<alias>.repository` + `root`,
`oats-local.yaml settings.oats.okf.bindings-file`), not a soul payload key; a
repo ref never carries a `#path`.

`--provider` for a capability the soul does not resolve is `E_CAPABILITY_MISSING`;
`__proto__`/`constructor`/`prototype` as a key at any depth is refused.

## Discovery over remotes and the deployment directory

Discovery and resolution work against **Git remotes, never local clones**. The
kernel fetches `oats-workspace.yaml`, each member's `oats-membership.yaml`,
every `souls/*/soul.yaml` and `capabilities/*/oats.json`, and every package by
URL — with the operator's own git configuration (`GIT_TERMINAL_PROMPT=0`, ssh in
BatchMode: nothing ever prompts). Neither the repo that defines a capability nor
the repo that hosts the workspace needs to be cloned.

**The only thing that needs a clone is a soul's work target** (`work:
worktree | checkout`). The kernel finds it, first hit wins: (1) `oats spawn
… --repo <abs path>`; (2) `oats-local.yaml` `clones: { <repo key>: <abs
path> }` (keys are canonical repo keys — any ref spelling is normalised through
`parseRepoRef`); (3) the convention `<deployment>/<member name>` (the last
segment of the repo key; a member named `agents` is looked for at
`<deployment>/agents-repo`, since `agents/` is the instance root). None →
`E_CLONE_MISSING` naming the three remedies; a directory whose `origin` is a
different repo → `E_CLONE_MISMATCH`. Spawning a soul whose repo is not yet
cloned is a guided clone-then-spawn, a job for the onboarding skill, not the
kernel.

The deployment directory is **yours to choose** (decision 9) — an existing folder that already holds your member clones is the usual case; `oats onboard <dir>` adds what the kernel needs and nothing else:

```
~/acme/                           ← the directory you chose
├── oats-local.yaml               ← which workspace this machine realizes + host paths + disabled souls
├── oats-lock.json                ← exact commit + integrity per package
├── agents/                       ← instance homes (each self-contained) + fetched soul sources
├── platform/                     ← clone of github.com/acme/platform (only if someone works IN it; may live elsewhere — see clones:)
└── tools/
```

The kernel never depends on this shape: `oats-local.yaml` is found by walking
up from the current directory (`E_LOCAL_MISSING` otherwise); `agents/` is
created by `oats sync` when absent; clones are found through `--repo`,
`clones:` or the convention, in that order. A soul that lives in a member repo
is fetched into `<agents-root>/<soul>/souls/<commit12>/` at its discovered
commit before its first spawn (idempotent per commit; `<agents-root>/<soul>/soul`
points at the current one); its instances then materialize as above.

## The standalone case

A repo you can read whose workspace you **cannot** read (a contractor with
access to `platform` but not to the private `agents` repo) still offers its
souls: their `from: here` capabilities resolve; `from: <other member>` and
`from: package` are unresolvable (the version list lives in the workspace
file); workspace defaults do not apply because they cannot be seen. This is the
workspace's access control working, not a degraded mode to paper over: make
the host repo readable (it holds declarations, no secrets) or grant access.

Two things keep the standalone spawn useful rather than hollow: `oats.core`
(the framework's own operational package) is the kernel's default here as
well, resolved from the official catalog through the operator's own lock like any
package (a soul may say `oats.core: off`); and the
operator's `oats-local.yaml` may name the repo directly (`workspace: <member
ref>` — the kernel notices it is a member whose workspace it cannot read and
falls back to the standalone view — or `standalone: <repo ref>` to ask for
that view explicitly). `oats onboard` lists the host among the clones to make
like any member (the host is a member; its souls may need a work clone); under
an explicit `standalone:` header its next steps say so and name that one repo.

**Executables from public members.** Membership is the trust (decision 2): a
member capability's hooks and command scripts run on every operator's machine at
spawn, gated by nothing but the handshake. In a mixed public/private
organisation keep **souls only** in public members and let executable
capabilities come from packages (declared in `packages:`, pinned by the lock)
or from private members.

**Hosting the workspace file when some members are private.** Everyone who
can read the workspace file sees the member list. So: a public member never
hosts it when any member is private (it would publish the private repo's
name); the private member hosting it hides the workspace from public
contributors, who then live in the standalone case above. A dedicated private
repo (`<org>/workspace`) is the honest shape for a mixed organisation; the
onboarding skill asks this question first.

## What is deliberately not versioned

- **Members.** A member is always its latest state; there is no `@revision`
  on `members:`. A team that wants frozen capabilities publishes them as a
  package and pins that.
- **Member capabilities' `version` field** — informational; the content digest
  recorded at spawn identifies a copy.
- **Souls in members.** A soul is spawned from its repo's current state; the
  commit is recorded in `instance.json.workspace.soul`.
- **The deployment layout** — the operator's; only the convention is taught.

What **is** versioned: `packages:` (the workspace's one list), the lock's exact
commits and digests, and `external:` pins (a stranger's repo is never "latest").

## Removed

Per-soul `source: git:…@v#…` lines and the `git:`/`repo:`/`path:` grammar;
`imports:` of member souls; `exports:` lists; `oats.yaml`; the
installed-capability tier (`.agents/capabilities/installed/`) and
`oats-config.yaml` entirely; `oats init` / `use` / `install` / `restore` /
`trust` / `list` / `catalog` / `remove` / `migrate` / `config` (each answers
`E_UNKNOWN_COMMAND` naming its replacement); per-soul `stores.<x>.inherit`;
ambient-skill exclusion at launch. Lock v1/v2 files are `E_LOCK_SCHEMA`.
There is no converter and no dual-schema reader: a 0.24.x kernel keeps
spawning 0.24.x deployments.

## Related

- [Souls and instances](souls-and-instances.md) · [Packages](packages.md) ·
  [Configuration (`oats-local.yaml`)](configuration.md)
- [Capability manifests](capabilities.md) · [Contracts](layers.md) ·
  [Desktop CLI API — workspace model](desktop-cli-api.md#workspace-model-workspaceapi-2)
- [Design navigation](design/README.md)
