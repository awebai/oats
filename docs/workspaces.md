# Workspaces: one workspace per organisation, members are trust, nothing is installed

This is the OATS workspace model. The module contracts the kernel is built
against are in
[design/2026-09-23-workspace-module-contracts.md](design/2026-09-23-workspace-module-contracts.md).

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

### `oats-workspace.yaml`: the one shared declaration

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
  oats.framework: v1.4.1                   # bare version → resolves through the official catalog
  oats.okf: v4.1.0
  acme.tools: git:github.com/acme/tools@v0.4.0   # outside the catalog → git:<repo>@<tag|OID>; still a package

teams:                                     # SHARED teams: the same provider team for everyone
  engineering: { description: Platform and release automation, team: "engineering:acme.aweb.ai" }
  reviewers:   { description: Code review }   # declared, not created yet (no `team` id): readiness team-unmapped

defaults:
  capabilities:
    oats.core: { from: package }
    acme-house-style: { from: github.com/acme/agents }   # a CANONICAL repo key: host/path, no scheme, no .git
  knowledge: { oats.okf: { from: package } }             # one slot default at most; a soul may say `none`
  messaging: none
  tasks: none

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

### `oats-membership.yaml`: the backlink, in every member

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents      # "I am a member of acme"
```

Nothing else: there are no export lists, and team membership is local to each
deployment ([Teams](#teams)).

### `souls/<name>/soul.yaml`: where each capability comes from

```yaml
schemaVersion: 2
name: release-manager
description: Cuts, verifies and announces releases.
work: worktree                             # worktree | checkout | directory | workspace

capabilities:
  acme-release-tooling: { from: here }     # `here` = the repo this soul.yaml lives in
  acme-deploy: { from: package }           # provided by acme.tools, pinned in packages:
  acme-house-style: off                    # removes a workspace default

knowledge:                                 # provider payload, opaque to the kernel: the slot capability's settings
  harvest: off                             # (what this soul owns and reads is in souls/<name>/okf.json, not here)
messaging:
  channels: [acme-eng]
tasks: none                                # empties the slot

compatibility:                             # optional FLOORS on package versions: constraints, not sources
  oats.okf: ">=4.0"
```

Beside it: `AGENTS.md` (canonical), `CLAUDE.md → AGENTS.md`, `skills/`, and
whatever the slot providers read from the soul directory. For `oats.okf` that
is **`okf.json`** (`{ version: 1, owner, owns: ["<base>/<node>"], reads: […] }`),
the soul's knowledge declaration; it travels with the soul into the per-commit
soul cache ([knowledge.md](knowledge.md)). A slot payload on `soul.yaml` reaches
the provider as `OATS_SETTINGS` and may carry only the settings the provider's
manifest declares; the provider refuses any other key.

Every `souls/*/soul.yaml` in a member is listed and spawnable; souls have no
private mode. A soul's `name` must equal its directory name; the first of two
souls declaring one name (by path) is listed, the second is a problem.

### `capabilities/<name>/oats.json`: the manifest

The capability manifest is described in [capabilities.md](capabilities.md).
Discovery relies on `capability` (the same
`^[a-z0-9][a-z0-9._-]*$` grammar every `capabilities:` key uses), `version`,
`layer`, and may read `private: true` (a **repo-owned** capability). `version` is
informational for member capabilities — a materialized copy is identified by
its content digest.

### `oats-local.yaml`: the only per-machine file

Which workspace this machine realizes, where member clones live, host-owned
provider settings, this deployment's local teams and team membership, host
facts for automations, and launch configurations. The full reference is
[configuration.md](configuration.md).

### `oats-lock.json`: lock v3

Written by `oats sync`; the only persisted state at the deployment besides
`oats-local.yaml`. See [packages.md](packages.md).

## Membership and trust

**Reciprocal membership is a hard gate.** A repo is a member only when
`oats-workspace.yaml` lists it **and** the repo's `oats-membership.yaml` names
the workspace back. One file per side; a copied backlink in a fork, or a folder
with the right name, is not admission.

**Membership is the whole trust decision for member capabilities**, the same
model as a repo's committed `.agents/skills/`: whoever can push to the repo
decides what runs, and the branch's latest state is what runs. Packages come
from *outside* that boundary, and **declaring one in the workspace's
`packages:` is the trust decision** ([packages.md](packages.md#trust)). A spawn admits only a locked package the workspace
**still declares**: one removed from `packages:` but left in a stale lock is
`E_PACKAGE_MISSING { reason: "undeclared" }` until `oats sync` drops it.

**The handshake is observed with the operator's own Git read access, in one
access context.** The kernel reads both halves over the remotes
(`git ls-remote`, shallow fetches, the operator's own credential helpers,
never a prompt). A half that cannot be read makes the member *unconfirmed*,
never a half-success. A remote's current head is read with Git's protocol v0
(one round trip) unless your Git configuration sets `protocol.version`, which
is then used as set; a tag or branch is read as before. A remote whose v0 ref
advertisement is over 4 MiB is read with protocol v2 from then on: the 4 MiB
bounds what OATS keeps, not the download, so the first read transfers that
advertisement once before falling back. A remote that times out under v0
fails as before and is read with protocol v2 for the next 7 days; a read
ended by the 12 s budget of `oats status` or `oats workspace status` is not
the remote's own timeout, and is neither remembered nor warned about. One that
fails under v0 for another reason than an authentication refusal, a missing
repository or the local cache is read again with v2. Each case prints one
`oats: warning`; the first two are remembered in the remote cache. `oats workspace status` and `oats sync` show each member
as `confirmed` or the reason it is not:

| status | meaning |
|---|---|
| `confirmed` | listed and backlinks to this workspace |
| `not-listed` | the workspace does not list the repo |
| `no-backlink` | no (or invalid) `oats-membership.yaml` at the member's default branch |
| `backlink-elsewhere` | the member names a different workspace (a case-only difference is flagged: repo paths are case-sensitive identities) |
| `cannot-read` | the operator cannot read the member (auth / not-found / network / timeout / killed: the system killed git, e.g. out of memory), or this machine's remote cache could not be written (cache) |

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
its slots.

**Package souls.** A package may ship souls (`souls:` in `oats-package.json`):
they are listed from the lock for each package the workspace declares,
named `<package>/<soul>` (a bare name when unique), resolved like any soul
(`from: here` = their own package at the locked commit) and trusted as the
package is. See [packages](packages.md#package-souls).

## Member tier vs package tier: the non-collapse rule

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

A publisher that also keeps copies of its package's capabilities (a mirror, a
fixture) keeps them outside `capabilities/`, or discovery lists them as member
capabilities too: the same capability offered twice, once at latest state. The
`oats` repository keeps its mirrors of the official packages in `mirrors/`.

So the framework's own souls say `oats.okf: { from: package }` even though
`oats-okf` is a member of the OATS workspace, and every package repo carries a
member soul that is the expert in that capability (`oats-okf-expert`,
`oats-aweb-expert`, …), discoverable at latest state like any member soul.

## Packages, lock, catalog

`packages:` values have two forms, a **bare version** resolved through the
official catalog and a **`git:<repo>@<ref>`** direct ref; both are versioned
and locked, and a ref that resolves to a branch is refused. `oats sync`
confirms membership, resolves every entry to a commit and content digest,
writes `oats-lock.json`, creates `agents/` if absent and reports what changed.
`oats package add | remove` edit `packages:`. The grammar, the lock, trust and
the catalog are in [packages.md](packages.md).

## Resolution, spelled out

For each `(name, from)` in
`defaults.<slot>` ⊕ `defaults.capabilities` ⊕
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

At spawn every resolved capability is **copied whole** into the instance home
(skills, injects, scripts, hooks) from the remote at the recorded commit, and
`instance.json` records each module's source, commit and digest. Nothing is
symlinked or shared between instances, and a running instance never changes
under itself: a member moving or `packages:` being bumped affects only new
spawns. The home's layout and records are in
[souls-and-instances.md](souls-and-instances.md).

**Drift is shown, not prevented.** `oats status` compares each instance's
recorded modules — and its recorded **soul source** (`instance.json.workspace.soul`)
— with the workspace's current picture: `current`, `moved` (member or package
now at another commit) or `missing` (capability no longer present, member
unconfirmed, package no longer locked). The text form is `soul: <name> from
<member> @ <c7>  [member moved since …]` above the module rows; `--json`
carries `instances[].soul`. `oats spawn --preview` lists `changedSince` the
newest previous instance of the same soul, plus `providers` (the `--provider`
map as given) and `settings.<cap>` (the merged payload each provider receives).

Harnesses start normally, with their own skill discovery intact
([souls-and-instances.md](souls-and-instances.md)).

## Teams

A team is a messaging-provider team (for oats.aweb, an
aweb team id `<team>:<namespace>`) under a **label**. Two files declare them:

- **Shared teams**: the committed `oats-workspace.yaml` `teams.<label> =
  { description?, team? }`: the same provider team for everyone, edited by a PR.
  A shared team without `team` is declared but not created yet (readiness
  `team-unmapped`): its owner creates it with the messaging provider, then
  commits the id.
- **Local teams**: the deployment's `oats-local.yaml` `teams.<label> = { team,
  description? }`: a team only this deployment uses (a personal team). A label in
  both files is `team-label-collision` (a warning); the **shared** definition
  wins, and the fix is renaming the local label.

`oats-local.yaml` also says which teams each soul belongs to **here**:

- `defaultTeam: <label>`: the team every instance of this deployment lives in
  (its default-team identity);
- `souls.teams`: `"*"` for every soul, and a soul's own entry (its bare name, or
  `<package>/<soul>` for a package soul) adds to it;
- `souls.default`: a per-soul override of `defaultTeam`; it must be one of that
  soul's teams (`E_TEAM_NOT_ELIGIBLE`).

A soul's default is `souls.default[soul] ?? defaultTeam`; its teams are that
default ∪ `souls.teams["*"]` ∪ `souls.teams[soul]`. A label no file declares is
`E_TEAM_UNKNOWN` (a spawn, preview or `inspect --soul` of that soul is
refused). At spawn an instance joins its **default** only; the others are
eligible: offered, and joined on request through the provider (`join=` at
spawn, or its own verbs later). Nothing committed besides the shared `teams:`
says anything about teams, and capabilities compose from the workspace defaults
and the soul only, the same for everyone. **A label never gates, restricts,
changes trust or partitions the knowledge store.**

The verbs edit `oats-local.yaml` in place; they never call a provider:

```
oats teams [--json]                                  # this deployment's teams, ids, the default, problems
oats teams add <label> --team <id> [--description d] # declare a local team (the first one becomes the default)
oats teams remove <label>                            # refused while referenced (E_TEAM_IN_USE) or shared (E_TEAM_SHARED)
oats teams default <label>
oats soul teams <soul>|'*' [--add a,b] [--remove a,b] [--default <label> | --clear-default] [--json]
```

The messaging provider's own setup creates provider teams and records them with
`oats teams add` (see the provider's documentation). The spawn preview, `inspect` and `oats souls` report a soul's
`teams` and `defaultTeam`; readiness reports the team problems in
`checks.configured` (`E_TEAM_UNCONFIGURED` when a messaging layer is active and
there is no default; `team-unmapped`, blocking when it is the default;
`default-team-changed` for a running instance). The provider receives them in
its environment — see [capabilities.md](capabilities.md#teams-in-the-provider-environment).
Exact shapes: [desktop-cli-api.md](desktop-cli-api.md#team-model-v2-feature-team-model-2-oats-0300-replaces-feature-teams).

### Preparing for team model 3 (0.36.x)

OATS 0.37.0 commits a soul's teams in the workspace (team model 3,
awebai/oats#484): the teams an organisation's instances may join become its
own decision, visible and reviewable in its git, so a deployment's
`oats-local.yaml` no longer adds one by accident. 0.36.x prepares for it, so
every workspace and deployment can migrate first:

- **`oats-workspace.yaml` accepts the new keys** and validates them, but
  **does not apply them**: a soul's teams and default are still resolved as
  above, from `oats-local.yaml`.

  ```yaml
  defaultTeam: engineering          # the workspace's fallback default team
  localTeams: true                  # deployments may declare their own teams (absent: false)
  souls:                            # per pattern: "*", <member|package>/*, <member|package>/<soul>
    "*": { teams: [] }              # default only ({} says the same)
    security-souls/*: { default: security, teams: [engineering] }
    oats.engineering/*: { teams: any }   # every shared team
  ```

  `<member|package>` is the name `souls.disabled` uses. Every label (`defaultTeam`,
  a `souls:` `default`, each of its `teams`) must be a shared team in `teams:` of
  the same file; anything else is `E_WORKSPACE_SCHEMA` when the file is read. A
  key naming a member or package the workspace does not have is not an error.
- **The readiness warning `team-model-3-migration`** (never blocking) names
  what 0.37.0 will refuse: `souls.teams` / `souls.default` in `oats-local.yaml`
  (they move to `souls:`), and local `teams` / `defaultTeam` while the workspace
  does not say `localTeams: true` (fix: add `localTeams: true`, or commit the
  teams and `defaultTeam` in the workspace file). `oats teams`, readiness (and
  so the Desktop) and `oats doctor` show it. The migration steps are in the
  [0.36.1 release notes](release-notes/v0.36.1.md).

## Provider payloads have three homes

| What it is | Where | Example |
|---|---|---|
| True of every instance of the soul | `soul.yaml` → `knowledge:` / `messaging:` / `tasks:` | `messaging: { channels: [acme-eng] }`; `knowledge: { harvest-runtime: claude }` |
| A fact about this machine | `oats-local.yaml` → `settings.<cap>.<key>` (absolute paths are refused in the workspace file) | `settings.oats.okf.state-dir: /Users/ana/.oats/okf` |
| A fact about **this spawn** | `oats spawn … --provider <cap> key=value` (repeatable; dotted keys nest) → `instance.json.providers.<cap>` | `--provider oats.aweb identity.source=/abs/path/to/retained/.aw` |

The merged payload is `workspace.messaging` (messaging slot only) ⊕ soul slot
payload ⊕ `local.settings[cap]` ⊕ `spawn.providers[cap]` — objects deep-merge,
later wins on scalars and arrays. The provider's own `binding` contract
(its readiness check) runs over the merged payload. Teams are **not** settings:
they reach the provider beside them, in its environment ([Teams](#teams)).
Where a provider keeps its own state (for oats.aweb, its identity roots) is the
provider's concern; see its documentation.

A store (`stores: { <name>: <repo ref> }`) names a repository; where a
knowledge base lives inside it is the knowledge provider's own concern. For
oats.okf that is the **bindings file** (`bases.<alias>.repository` + `root`,
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

The deployment directory is **yours to choose**: an existing folder that already holds your member clones is the usual case, and `oats onboard <dir>` adds what the kernel needs and nothing else ([configuration.md](configuration.md#the-deployment-directory)):

```
~/acme/                           ← the directory you chose
├── oats-local.yaml               ← which workspace this machine realizes, and host facts
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

**Executables from public members.** Membership is the trust: a
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
- **Member capabilities' `version` field**: informational; the content digest
  recorded at spawn identifies a copy.
- **Souls in members.** A soul is spawned from its repo's current state; the
  commit is recorded in `instance.json.workspace.soul`.
- **The deployment layout**: the operator's; only the convention is taught.

What **is** versioned: `packages:` (the workspace's one list), the lock's exact
commits and digests, and `external:` pins (a stranger's repo is never "latest").

## Related

- [Souls and instances](souls-and-instances.md) · [Packages](packages.md) ·
  [Configuration (`oats-local.yaml`)](configuration.md)
- [Capability manifests](capabilities.md) · [Contracts](layers.md) ·
  [Desktop CLI API — workspace model](desktop-cli-api.md#workspace-model-workspaceapi-2)
- [Design navigation](design/README.md)
