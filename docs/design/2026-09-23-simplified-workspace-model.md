# A simpler multi-repo model for OATS — brainstorm with a worked example

**Status:** **ACCEPTED DIRECTION** — every question closed with the human on 2026-09-23; nothing implemented yet. This document is the worked example; the normative record is the Decision concept `agents/oats-expert/soul/knowledge/decisions/workspace-model-v2.md` and the adoption plan. Implementation is a clean v2 (no migration), planned separately. **Decided so far (human, 2026-09-23):** (1) reciprocal membership stays a hard gate; (2) workspace-tier trust = membership, nothing more; (3) everything in a member is discoverable by default — a soul or capability that wants to stay internal says `private: true` in its own definition; (4) the repo's half of the handshake is a one-line **`oats-membership.yaml`** (replaces `oats.yaml`); (5) **no migration path** — a clean break to v2; (6) a soul names each capability **with where it comes from** (`from: <member repo>` or `from: package`) — a location, never a version; resolution is a handshake check + lookup, not a search; (7) **full per-instance materialization** — every capability (skills, injects, scripts, hooks) is copied into the instance at spawn; a running instance never changes under itself; (8) **nothing is "installed"** — a package is just a second kind of source, fetched at the pinned version and copied in like a member's capability; the lock records exact commit/integrity and the one-time executable approval per version; (9) **discovery and resolution work against Git remotes, never local clones** — the only thing that needs a clone is a soul's work target; the local layout is the operator's — onboarding asks for the directory, no named convention; (10) the handshake is *observed* with the operator's own read access to both halves — no access to the workspace repo means no membership from that seat, by design; (11) **members carry no revision** — a member is always its latest state; a team that wants frozen capabilities publishes them as a package and pins that; (12) **one workspace per org, teams are labels** — `team:` on a soul/capability (or a repo default in `oats-membership.yaml`) organises and can supply additive defaults, but never gates, restricts or partitions anything; (13) **harnesses start normally and resolve skills from their own default places** — OATS contributes materialized capability skills into the instance's `.agents/skills/` and stops excluding machine-level or repo-level skills. **All questions closed; ready to be written up as a Decision.**
**Date:** 2026-09-23
**Author:** oats-expert, from a conversation with the human about the weight of the current declaration files.

The current model (`docs/workspaces.md`) is functional but heavy: provenance is declared *per soul per capability*, three files each know about versions, membership needs a reciprocal handshake, and the workspace file must import every soul it wants from its own member repos. This document proposes a lighter model and walks it through an imaginary company end to end.

---

## 1. The one idea

**Every capability an instance runs is copied whole into that instance at spawn. A capability comes from one of two kinds of source, and only one kind is versioned.**

| Source kind | Comes from | Versioned? | Trust decision | Fetched |
|---|---|---|---|---|
| **Member repo** | A repo that has completed the membership handshake | **No** — the member's *latest state* | **Membership is the trust.** Same model as a repo's `.agents/skills/`: you run what is on the branch because you trust who can push to it | At spawn, latest, copied in |
| **Package** | A published package (official catalog or a git ref) | **Yes** — the version pinned in the workspace's `packages:`; `oats-lock.json` records the exact commit + integrity | Per version: executables approved once, recorded in the lock, inherited by every instance materializing that version | At spawn, at the locked version, copied in |

Nothing is *installed* in a deployment. There is no installed-capability directory, no activation step, no "is it installed?" question: a package is a place to fetch from with a version attached, a member is a place to fetch from without one. A fetch cache may exist as invisible plumbing.

A soul names each capability **with where it comes from** — `from: <member repo>` or `from: package`. That is a **location, never a version**: the soul says *which repo* or *which kind*, the workspace's `packages:` says which version, and materialization *records* the exact state (commit, content hash) in the instance. Resolution is then a handshake check plus a lookup — no search across members, no name-collision rules.

That removes: per-soul `source:` lines, the `git:` / `repo:` / `path:` grammar from soul files, `from: installed | owned` in deployment config, the version triplication across soul → catalog → lock, and the whole notion of an installed-package tier with `oats install` / `oats use` activation.

**One relation is kept as a hard gate: reciprocal membership.** A repo is a member of a workspace only when the workspace lists the repo **and** the repo's `oats-membership.yaml` lists the workspace. One file per side of the handshake: `oats-workspace.yaml` says "these are my members", `oats-membership.yaml` says "this is my workspace". This is decided (human, 2026-09-23). It is the consent that makes "trust per member" honest: a workspace cannot pull in a repo's souls or run its capabilities' executables just by naming it, and a repo cannot inject itself into a workspace just by claiming it.

**And membership is the whole trust decision (decided, human, 2026-09-23).** Member capabilities are trusted exactly the way teams already trust skills committed to their own repos: the repo's access control — who can push to it — is the boundary, and the latest state of the branch is what runs. There is no second approval layer for members. Packages keep a one-time executable approval **per version** because they come from **outside** that boundary; the approval lives in the lock next to the commit it approved.

---

## 2. The imaginary company: Northwind

Northwind builds a shipping platform. Northwind has an **engineering** team and a **marketing** team, and a few things that belong to everyone (**global**). They share **one workspace** — marketers use engineering capabilities and vice versa; teams are labels for organising, not walls. Their agent setup spans **six of their own repos** plus **one public repo** they borrow an expert from, and **four packages**.

```
github.com/northwind/agents        ← hosts the workspace file; org-wide souls + capabilities   (team: global)
github.com/northwind/platform      ← the product; exports souls that work IN this repo         (team: engineering)
github.com/northwind/data          ← analytics; exports a soul + a data-access capability       (team: engineering)
github.com/northwind/marketing     ← campaigns; exports souls + brand/metrics capabilities      (team: marketing)
github.com/northwind/knowledge     ← the shared OKF knowledge base (a store, not a member)
github.com/northwind/nw-tools      ← MEMBER *and* PACKAGE PUBLISHER: publishes package `nw.tools` (versioned, pinned,
                                      approved) AND exports the member soul `tools-expert` who knows that package (team: engineering)

github.com/oss-collective/experts  ← PUBLIC; Northwind borrows one soul, pinned (not a member)

packages (versioned; fetched at spawn, never "installed"):
  oats.framework v1.1.3   → oats.core, oats.setup          (official catalog)
  oats.okf       v2.1.3   → knowledge layer                (official catalog)
  oats.aweb      v1.11.2  → messaging layer                (official catalog)
  oats.jira      v1.0.0   → tasks layer                    (official catalog)
  nw.tools       v0.4.0   → nw-lint, nw-deploy             (Northwind's OWN package, from a member repo — written as git:…@v0.4.0)
```

Two operators realize this workspace on their machines: **Ana** (macOS, works mostly on `platform`) and **Bo** (Linux, works on `data`). They share the declarations through Git and share nothing else.

---

## 3. Repo by repo

### 3.1 `northwind/agents` — the workspace host

> **Who may read the host** (team review, decision 26). Everyone who can read
> `oats-workspace.yaml` sees the member list. Northwind is all-private, so a
> member (`agents`) hosting it is fine. A mixed organisation — a public
> `awebai/aweb` and a private `awebai/ac`, say — hosts the file in a private
> repo that is **not** a public member (`awebai/workspace`): a public host
> would publish the private repo's name, and hosting inside the private
> member hides the workspace from public contributors. Those contributors get
> the public member's souls through the standalone case (§6): `from: here`
> capabilities plus `oats.core` (decision 25). Two teams with two messaging
> identities stay in the one workspace via `messaging.byTeam.<label>`
> (decision 23); a store names a repo, the root inside it is the provider's
> (`root`, decision 24).

```
agents/
├── oats-workspace.yaml              ← THE shared declaration (only one in the whole company)
├── oats-membership.yaml             ← the backlink (+ optional default team label: global)
├── souls/
│   ├── release-manager/
│   │   ├── soul.yaml
│   │   ├── AGENTS.md
│   │   ├── CLAUDE.md  → AGENTS.md
│   │   └── skills/release-checklist/SKILL.md
│   └── support-triager/
│       └── …
└── capabilities/
    ├── nw-release-tooling/          ← a WORKSPACE-tier capability (unversioned, latest state)
    │   ├── oats.json
    │   ├── skills/cut-release/SKILL.md
    │   ├── injects/release-policy.md
    │   └── bin/nw-release.mjs
    └── nw-house-style/
        ├── oats.json
        └── injects/house-style.md
```

#### `oats-workspace.yaml`

```yaml
schemaVersion: 2
name: northwind

# Member repos. Membership is RECIPROCAL: a repo listed here is a member only if
# its own oats-membership.yaml lists this workspace back (§3.2). A member has NO
# revision — it is always its latest state. Want something frozen? Publish it as
# a package and pin it under `packages:`. Everything a member exports
# (souls, capabilities) is then discoverable here. Trusting a member = trusting
# its capabilities' executables.
members:
  - git:github.com/northwind/agents          # this repo is a member too — it backlinks like any other
  - git:github.com/northwind/platform
  - git:github.com/northwind/data
  - git:github.com/northwind/marketing
  - git:github.com/northwind/nw-tools          # a member that ALSO publishes a package (below)

# The ONLY versioned things. Chosen once for the whole team; the lock records the
# exact commit + integrity each version resolves to, and the one-time executable
# approval for that version. Nothing is installed: instances fetch these at spawn.
packages:
  oats.framework: v1.1.3                       # bare version → resolves through the official catalog
  oats.okf: v2.1.3
  oats.aweb: v1.11.2
  oats.jira: v1.0.0
  nw.tools: git:github.com/northwind/nw-tools@v0.4.0   # not in the catalog → written as a git ref; STILL a package:
                                                       # versioned, locked, approved — membership does not change that

# Org teams — LABELS, declared once so they cannot drift into typos. A team never
# gates, restricts or partitions anything; it organises (grouping, filtering,
# ownership signal) and may supply additive defaults below.
teams:
  global:      { description: Org-wide souls and house capabilities }
  engineering: { description: "Platform, data and release automation" }
  marketing:   { description: "Campaigns, content and positioning" }

# What every soul gets unless it says otherwise.
defaults:
  capabilities:
    oats.core: { from: package }
    nw-house-style: { from: northwind/agents }
  knowledge: { oats.okf: { from: package } }     # slot default — a soul may name another or `none`
  messaging: { oats.aweb: { from: package } }
  tasks: { oats.jira: { from: package } }
  byTeam:                                        # additive, per team label; same semantics, `off` removes
    engineering:
      capabilities: { nw-release-tooling: { from: northwind/agents } }
    marketing:
      capabilities: { nw-brand-voice: { from: northwind/marketing } }

# Knowledge stores, declared ONCE (today each soul repeats `stores.x.inherit`).
stores:
  org: git:github.com/northwind/knowledge

# Messaging policy — a PROVIDER payload consumed by oats.aweb, kept under the slot
# it belongs to so "team" means one thing in this file. Enrolls nobody by itself.
messaging:
  private: per-human
  channels: [northwind-eng, northwind-mkt]

# By-reference adoption of souls from repos that are NOT members. A stranger's
# repo cannot be "latest state", so these stay pinned.
external:
  - source: git:github.com/oss-collective/experts@9c4e1f2a9c4e1f2a9c4e1f2a9c4e1f2a9c4e1f2a
    soul: souls/security-reviewer
```

Note what is **absent** compared to today: no `imports:` for the company's own souls (they are discovered), no per-soul revisions. The backlink is **still required** — it is the other half of the handshake — but it is now its own one-line file, `oats-membership.yaml`.

#### `souls/release-manager/soul.yaml`

```yaml
schemaVersion: 2
name: release-manager
description: Cuts, verifies and announces platform releases.
work: worktree
team: engineering                       # a label: overrides this repo's default (global)

# Each capability says where it lives. `from` is a LOCATION (a member repo, or
# `package` = one of the workspace's pinned packages) — never a version.
# oats.core + nw-house-style arrive from workspace defaults; nw-release-tooling
# from the engineering team default — named here anyway for readability.
capabilities:
  nw-release-tooling: { from: here }    # `here` = the repo this soul.yaml lives in

# Provider payloads stay opaque to the kernel — same as today, just shorter:
knowledge:
  owns: release-manager                 # store defaults to the workspace's `org`
  reads: [platform-engineer, data-analyst]
messaging:
  channels: [northwind-eng]
```

#### `souls/support-triager/soul.yaml` — opting out of a default

```yaml
schemaVersion: 2
name: support-triager
description: Triages inbound support issues into Jira.
work: directory
# no `team:` → this repo's default from oats-membership.yaml (global)

capabilities:
  nw-house-style: off                   # removes a workspace default
tasks: { oats.jira: { from: package } } # explicit, same as the default; harmless
knowledge: none                         # opts out of the knowledge slot entirely
```

#### `capabilities/nw-release-tooling/oats.json` — unchanged shape

The capability manifest is the one file that does **not** need to change. It already says everything the kernel needs:

```json
{
  "capability": "nw-release-tooling",
  "team": "engineering",
  "version": "0.0.0-workspace",
  "description": "Northwind release checklist, changelog and tag automation.",
  "compatibility": { "oats": ">=0.24.0" },
  "requires": ["oats.core"],
  "skills": ["skills/cut-release"],
  "inject": "injects/release-policy.md",
  "commands": { "cut": "bin/nw-release.mjs cut", "verify": "bin/nw-release.mjs verify" }
}
```

`version` is informational for workspace-tier capabilities — what identifies a materialized copy is the **content hash**, recorded at spawn (see §5).

### 3.2 `northwind/platform` — the product repo, exporting souls that work in it

```
platform/
├── src/ …                            ← the actual product
├── oats-membership.yaml              ← REQUIRED: the handshake (+ default team: engineering)
└── souls/
    ├── platform-engineer/soul.yaml
    └── platform-reviewer/soul.yaml
```

**Convention replaces declaration for exports; the handshake stays.** `oats-membership.yaml` is **required** in every member and carries one mandatory line — the backlink — plus, optionally, a default `team:` label for the items in the repo. (It replaces today's `oats.yaml`; the export lists that file carried are gone, see below.) Because `platform` backlinks and the workspace lists it, every `souls/*/soul.yaml` and `capabilities/*/oats.json` in it is a workspace soul/capability, **discoverable by default**:

```yaml
# oats-membership.yaml — REQUIRED in every member repo
schemaVersion: 2
workspace: git:github.com/northwind/agents     # the handshake: "I am a member of northwind"
team: engineering                              # optional: default team label for items in this repo
```

Both halves are observed at spawn/sync with compatible identity and access context; a copied backlink in a fork, or a neighbouring folder with the right name, is not admission — same rule as today.

**Something that wants to stay internal says so itself.** There is no export list anywhere; the decision lives next to the thing it is about, so it survives a move between repos and never drifts from an index:

```yaml
# souls/platform-reviewer/soul.yaml — internal to this repo
schemaVersion: 2
name: platform-reviewer
private: true                         # not discoverable in the workspace; usable only from this repo
…
```

```json
// capabilities/nw-experimental-linter/oats.json — half-finished, not for the team yet
{ "capability": "nw-experimental-linter", "private": true, "…": "…" }
```

A private soul can still be spawned when the spawner stands in its own repo (it is not hidden from its owners); a private capability can be named only by souls of the same repo. `oats capabilities` shows private items to their own repo with a `private` badge and to nobody else.

```yaml
# northwind/agents/oats-membership.yaml — the host repo backlinks to itself
schemaVersion: 2
workspace: git:github.com/northwind/agents
team: global                          # optional: default team label for items in this repo
```

#### `souls/platform-engineer/soul.yaml`

```yaml
schemaVersion: 2
name: platform-engineer
description: Implements platform features on a branch and opens PRs.
work: worktree
capabilities: {}                     # only the workspace defaults
knowledge:
  owns: platform-engineer
  reads: [release-manager]
```

The soul's **work target** is whatever repo the spawner points it at (by default, the repo the soul lives in). Where a soul is *published* and where it *works* remain independent, exactly as today.

### 3.3 `northwind/data` — a repo that exports a soul AND a capability

```
data/
├── warehouse/ …
├── oats-membership.yaml              ← { workspace, team: engineering }
├── souls/data-analyst/soul.yaml
└── capabilities/nw-warehouse-access/
    ├── oats.json
    ├── skills/query-warehouse/SKILL.md
    └── bin/nw-wh.mjs                  ← an executable; trusted because `data` is a trusted member
```

```yaml
# souls/data-analyst/soul.yaml
schemaVersion: 2
name: data-analyst
description: Answers questions against the warehouse with attributable evidence.
work: directory
capabilities:
  nw-warehouse-access: { from: here }  # `here` = the repo this soul.yaml lives in
knowledge:
  owns: data-analyst
```

`nw-warehouse-access` is now **discoverable across the whole workspace**: `release-manager` in `northwind/agents` could add `nw-warehouse-access: { from: northwind/data }`, and `oats capabilities` / the Desktop Capabilities view list it with origin `workspace (northwind/data)`. Reading any `soul.yaml` tells you where each of its capabilities lives without running anything.

### 3.4 `northwind/marketing` — the second team, same workspace

```
marketing/
├── campaigns/ …
├── oats-membership.yaml              ← { workspace, team: marketing }
├── souls/
│   ├── campaign-writer/soul.yaml
│   └── positioning-analyst/soul.yaml
└── capabilities/
    ├── nw-brand-voice/               ← injects/brand-voice.md + skills/tone-check
    └── nw-campaign-metrics/          ← bin/nw-cm.mjs (queries the ads APIs)
```

```yaml
# souls/campaign-writer/soul.yaml
schemaVersion: 2
name: campaign-writer
description: Drafts launch campaigns from what engineering is actually shipping.
work: directory
# team: marketing — inherited from this repo's oats-membership.yaml
capabilities:
  nw-campaign-metrics: { from: here }
  nw-release-tooling: { from: northwind/agents }   # a marketer using an ENGINEERING capability — nothing stops it
knowledge:
  owns: campaign-writer
  reads: [release-manager, platform-engineer]      # marketers learning what is shipping
messaging:
  channels: [northwind-mkt]
```

```json
// capabilities/nw-brand-voice/oats.json
{ "capability": "nw-brand-voice", "team": "marketing", "inject": "injects/brand-voice.md", "skills": ["skills/tone-check"], "…": "…" }
```

Because `nw-brand-voice` is a marketing team default (`defaults.byTeam.marketing`), every marketing soul carries the brand voice without naming it; `release-manager` (engineering) could still add `nw-brand-voice: { from: northwind/marketing }` for its release announcements. **Nothing about trust, handshake, packages or the store is different for this team** — it is one more member repo with a label.

### 3.5 `northwind/nw-tools` — a member that also publishes a package (decisions 19–20)

```
nw-tools/
├── oats-membership.yaml              ← { workspace, team: engineering }   — it IS a member
├── souls/tools-expert/soul.yaml      ← the MEMBER soul: knows and evolves the nw.tools package
├── capabilities/nw-tools-dev/        ← member-tier: latest state, for people working ON nw-tools
└── oats-package/                     ← PACKAGE-tier: versioned, tagged v0.4.0, pinned in packages:, approved
    ├── oats-package.json             ← { package: "nw.tools", version: "0.4.0", capabilities: [...] }
    └── capabilities/
        ├── nw-lint/oats.json
        └── nw-deploy/oats.json       ← has bin/ → executables approved once per version
```

Two roles, two tiers, one repo — and they do not collapse into each other:

- `souls/*` and `capabilities/*` are **member-tier**: discoverable at latest state because `nw-tools` completed the handshake. `nw-tools-dev` is what `tools-expert` uses while working on the package itself.
- `oats-package/*` is **package-tier**: it is consumed only through `packages:` (`nw.tools: git:…@v0.4.0`), locked to a commit, integrity-checked, executables approved per version. `release-manager` says `nw-deploy: { from: package }` — never `from: northwind/nw-tools` — even though that repo is a member. Membership does not turn a package into a latest-state capability.

```yaml
# souls/tools-expert/soul.yaml — the package's own expert, an ordinary member soul
schemaVersion: 2
name: tools-expert
description: Knows the nw.tools package — its manifests, executables, release tags and consumers; evolves it through PRs.
work: worktree
capabilities:
  nw-tools-dev: { from: here }          # member-tier, latest
  nw-lint: { from: package }            # eats its own published food, at the pinned version
```

This is exactly the shape the OATS workspace itself takes: `oats-okf`, `oats-aweb`, `oats-jira`, `oats-linear`, `oats-authoring`, `oats-dev` are members that publish packages **and** each carries its expert soul (`okf-expert`, `aweb-expert`, …); the framework's souls say `oats.okf: { from: package }`. The **official catalog** (`package-catalog.json` in the `oats` repo) stays as the reviewed marketplace: a bare-version entry like `oats.okf: v2.1.3` resolves through it; a package outside it is written as `git:<repo>@<ref>`.

### 3.6 `northwind/knowledge` — a store, not a member

Contains the OKF base. It appears in the workspace under `stores:`, not `members:` — it exports no souls or capabilities. Publication to it stays PR-only, as today.

### 3.7 `oss-collective/experts` — the borrowed public soul

```
experts/
└── souls/security-reviewer/
    ├── soul.yaml
    ├── AGENTS.md
    └── skills/threat-model/SKILL.md
```

```yaml
# souls/security-reviewer/soul.yaml (written by oss-collective, not Northwind)
schemaVersion: 2
name: security-reviewer
description: Reviews changes for security regressions.
work: worktree
capabilities: {}
compatibility:                       # optional FLOORS — constraints, not sources
  oats.okf: ">=2.1"
```

Northwind adopts it through `external:` with a pinned revision. There is deliberately **no handshake** here: oss-collective has not consented to be in Northwind's workspace and Northwind is not asking — it borrows one soul by reference. That is exactly why `external` souls get no workspace-tier capabilities of their own repo and stay pinned. It is a **source-complete** soul: its skills travel with it. Its knowledge slot is filled by Northwind's default (`oats.okf`), and Northwind decides at spawn whether it gets a node in the team store. Northwind never joins oss-collective’s workspace and never reads its `oats-membership.yaml`.

---

## 4. The deployment side — any layout, one convention

**Nothing below is shared, and none of it is required to look a particular way.** Discovery and resolution work against **Git remotes**: the kernel fetches `oats-workspace.yaml`, each member's `oats-membership.yaml`, every `souls/*/soul.yaml` and `capabilities/*/oats.json`, and every package, **by URL** — shallow fetch or host contents API, at latest or at the locked commit. A capability is copied into an instance straight from the remote. The repo that defines a capability never needs to be cloned; neither does the repo that hosts the workspace.

**The only thing that needs a local clone is a soul's work target** — a soul with `work: worktree | checkout | directory` works *in* a repo, so that repo must be on disk. Spawning a soul whose repo is not yet cloned is therefore a *guided clone into the conventional place, then spawn*: a job for the onboarding skill (`oats-setup-expert`), not the kernel.

**The deployment directory is the operator's choice** (decision 9): an existing folder that already holds the member clones is the usual case; onboarding asks for it (`oats onboard <dir>`) and adds the three entries the kernel needs. Shown here as Ana's `~/northwind/`, with the member clones inside it:

```
~/northwind/                      ← the directory Ana chose (any name, any place)
├── oats-local.yaml               ← which workspace this machine realizes + host paths + disabled souls
├── oats-lock.json                ← exact commit + integrity + per-version approval per package
├── agents/                       ← instance homes, each self-contained
├── agents-repo/                  ← clone of github.com/northwind/agents   (only if someone works IN it)
├── platform/                     ← clone of github.com/northwind/platform
└── data/                         ← clone of github.com/northwind/data
```

The kernel never depends on this shape. It finds clones through `oats-local.yaml` (or by matching a clone's remote URL to a member), and an operator who prefers `~/src/nw-platform` simply points at it.

### Ana (macOS)

```
~/northwind-oats/
├── oats-local.yaml                      ← this machine's overrides (host paths, disabled souls)
├── oats-lock.json                       ← exact commit + integrity + approval per package version
└── agents/
    └── <soul>/instances/<instance>/     ← instance homes; each carries its own full copy of its capabilities
(a fetch cache, if any, lives under the OS cache dir and is not part of the model)
```

```yaml
# oats-local.yaml — replaces the role of today's oats-config.yaml
schemaVersion: 2
workspace: git:github.com/northwind/agents      # observed over the remote; this repo need not be cloned

clones:                                         # optional: where member clones live, if not the convention
  northwind/platform: ~/src/nw-platform

settings:                               # host-owned values the manifests ask for
  oats.okf:
    bindings-file: /Users/ana/.oats/okf-bindings.json
    state-dir: /Users/ana/.oats/okf
  oats.aweb:
    delivery: channel

souls:
  disabled: [data-analyst]              # Ana doesn't run analytics agents
```

### Bo (Linux)

```yaml
schemaVersion: 2
workspace: git:github.com/northwind/agents
settings:
  oats.okf:
    bindings-file: /home/bo/.oats/okf-bindings.json
    state-dir: /home/bo/.oats/okf
souls:
  disabled: [release-manager, support-triager]
```

There is no per-operator trust list: Bo is in the workspace, so Bo runs the workspace's capabilities — the same way cloning `northwind/data` already means running whatever skills its `.agents/skills/` carries. Package executables are approved once per version, in the lock.

### `oats-lock.json` — today's lock plus the per-version approval

```json
{
  "lockfileVersion": 3,
  "packages": {
    "oats.okf": {
      "source": "catalog:oats.okf", "path": "oats-package", "version": "2.1.3",
      "commit": "aafdd3ef0c2b…", "integrity": "sha256-…", "dependencies": [],
      "approved": { "executables": "sha256-…", "at": "2026-09-23T09:02:11Z" }
    },
    "oats.aweb":      { "…": "…" },
    "oats.jira":      { "…": "…" },
    "oats.framework": { "…": "…" }
  }
}
```

Ana's and Bo's locks are **identical** if they synced the same workspace commit — the lock is the one place exact commits, integrity and the per-version executable approval belong. A package version is approved once; every instance that materializes it inherits the approval. A moved tag (same version, different commit) fails integrity and asks again.

### Everything that disappeared from deployment config

Today's `capabilities.layers.messaging.{capability, from, global, souls, settings}` and `capabilities.additive.<x>.{from, global, souls}` blocks are gone. Activation and targeting are **derived**: workspace `defaults` + each soul's `capabilities` + slot names. The deployment only *overrides* (host paths, disabled souls).

---

### Provider payloads have three homes (team review, decided)

| What it is | Where | Example |
|---|---|---|
| True of every instance of the soul | `soul.yaml` → `messaging:` / `knowledge:` | `messaging: { channels: [northwind-eng] }`, `knowledge: { owns: release-manager }` |
| A fact about this machine | `oats-local.yaml` → `settings.<capability>.<key>` (absolute paths refused in the workspace file) | `settings.oats.okf.state-dir: /Users/ana/.oats/okf` |
| A fact about **this spawn** | `oats spawn … --provider <cap> key=value` → `instance.json` `providers.<cap>` (the Desktop's confirmed apply carries the same map) | `--provider oats.aweb identity.source=/abs/path/to/retained/.aw` — one instance takes the retained seat; other instances of the soul mint fresh |

The provider's `binding` contract (`normalize → bind → check`) runs over the merged payload exactly as today; the provider still enforces its own rules (e.g. a state root outside the work tree).

## 5. Materialization — a full copy inside the instance (decided)

At spawn, every capability a soul resolves to is **copied in full** — skills, injects, scripts, hooks — into the instance home. Nothing is symlinked; nothing is shared between instances; there is no deployment-level modules directory.

```
~/northwind-oats/agents/release-manager/instances/release-manager-v3/
├── .oats/modules/
│   ├── nw-release-tooling/              ← full copy: skills/, injects/, bin/
│   ├── nw-house-style/
│   └── oats.core/                       ← from a package: fetched at the locked version, copied the same way
├── AGENTS.md                            ← composed from the soul's AGENTS.md + every module's inject
├── instance.json
└── work/ …
```

```json
// instance.json — provenance is RECORDED here, not declared in the soul
{
  "instance": "release-manager-v3",
  "soul": "release-manager",
  "createdAt": "2026-09-23T10:12:44.118Z",
  "modules": {
    "nw-release-tooling": { "from": "northwind/agents", "commit": "3f2a9c1e…", "hash": "sha256-…" },
    "nw-house-style":     { "from": "northwind/agents", "commit": "3f2a9c1e…", "hash": "sha256-…" },
    "oats.core":          { "from": "package", "package": "oats.framework", "version": "1.1.3", "commit": "…" }
  }
}
```

What this buys, and why it was chosen over "shared latest with per-instance skills only":

- **A running instance never changes under itself.** Its hooks and scripts are the ones it started with; a member repo moving, or `packages:` being bumped, affects only *new* spawns.
- **"What an instance runs is what it was spawned with" stays provable** — the retirement baseline, the confirmed-apply contract (`decision` binds effective launch facts) and the Desktop's reported facts all rely on it.
- **How far behind a running instance is** is visible: `instance.json` records the commit; the spawn preview says "changed since release-manager-v2".
- **No shared state to reason about.** No cache invalidation, no "which instances still reference hash b71e…", no directory anyone has to know about. If fetch cost ever matters, a cache is an invisible implementation detail.

Cost: disk, a few MB per instance. Accepted.

**Drift is shown, not prevented** (team review): `oats status` and the Desktop roster show per instance `modules: nw-release-tooling from northwind/agents @ 3f2a9c1e` and, when the member has moved, `member moved since (now @ 9b0c…)` or `capability no longer present`. The preview already says "changed since release-manager-v2".

### The harness starts normally (decided)

OATS is a **skill contributor, not a skill sandbox**. Today the harness is launched with ambient skill discovery suppressed and only the capability-injected skills visible. That defended against content we have just decided to trust (decision 2: a repo's committed `.agents/skills/` is exactly as trusted as its committed capabilities). So:

- The harness (Pi, Claude, Codex) is started **the way it starts anywhere**, with cwd = the instance home and its own discovery intact — Pi's `~/.pi/agent/skills` and `.agents/skills` up the tree, Claude's `.claude/`, Codex's equivalent.
- Materialized capability skills are placed **where the harness already looks**: `<instance>/.agents/skills/<capability>/<skill>/SKILL.md` (copied from the capability's `skills/`). Precedence is the harness's own nearest-wins rule — no special profile, no exclusion list, no injected skill index.
- An agent therefore sees, in this order of proximity: its capability skills (instance home), the repo's own `.agents/skills/` once it works in `work/`, and whatever the operator keeps at machine level. **All three are intended.**
- What OATS still composes is **instructions** (`AGENTS.md` from the soul + every capability's inject) and the **model/provider settings** the deployment pins (e.g. a Pi profile). Neither touches skill discovery.
- **Duplicate names** (team review): two *composed* capability skills with the same name are still a spawn error naming both (`skill-overrides` picks one). A composed skill and an ambient repo/machine skill with the same name is **not** an error — the harness's precedence decides; the preview lists composed names so a clash is visible.

```
~/northwind/agents/release-manager/instances/release-manager-v3/
├── AGENTS.md                             ← canonical, composed: soul AGENTS.md + capability injects
├── CLAUDE.md → AGENTS.md                 ← relative symlink (unchanged from today)
├── .agents/skills/                       ← canonical; where Pi (and Codex) look
│   ├── nw-release-tooling/cut-release/SKILL.md
│   ├── nw-house-style/…
│   └── oats-core/oats-operate/SKILL.md
├── .claude/skills → ../.agents/skills    ← relative symlink alias for Claude (unchanged from today)
├── .oats/modules/                        ← the full capability copies (bin/, injects/, manifests)
│   ├── nw-release-tooling/
│   └── …
├── instance.json
└── work/                                 ← the worktree; its own .agents/ or .claude/ resolve as the harness sees fit
```

The canonical-plus-alias construction (`AGENTS.md` ⇐ `CLAUDE.md`, `.agents/skills` ⇐ `.claude/skills`) is kept exactly as the kernel builds it today. It covers **our contributed skills** only; repo-level or machine-level skills are the harness's own business — neither aliased nor excluded by OATS.

### What a spawn preview shows

```
release-manager-v3  ← soul release-manager · team engineering (northwind/agents @ 3f2a9c1e)
  modules
    nw-release-tooling   workspace  northwind/agents @ 3f2a9c1e   (changed since release-manager-v2)
    nw-house-style       workspace  northwind/agents @ 3f2a9c1e
    oats.core            package    oats.framework v1.1.3
  slots
    knowledge  oats.okf v2.1.3 → store org (owns release-manager)
    messaging  oats.aweb v1.11.2 → private + channels [northwind-eng]
  team       engineering
    tasks      oats.jira v1.0.0
```

The Desktop's existing spawn preview/apply contract (`decision.revision`, `--expect-decision`, idempotency) carries this as facts; nothing about that contract changes.

---

## 6. Resolution, spelled out

```
membership (before anything else; OBSERVED over the remotes with the operator's own Git access):
  member = listed in oats-workspace.yaml AND its oats-membership.yaml names this workspace
  both halves must be READ in the same access context (this operator's credentials for that host)
  a repo failing either half → not a member (E_MEMBERSHIP_UNCONFIRMED names the missing half)
  a half that cannot be READ → not confirmed (E_MEMBERSHIP_UNCONFIRMED: cannot read <url>) — never a half-success

standalone (a repo you can read whose workspace you cannot):
  its souls exist and can be spawned; their `from: here` capabilities resolve
  `from: <other member>` and `from: package` are unresolvable (the version list lives in the workspace file)
  workspace defaults do not apply — you cannot see them

for each (name, from) in workspace.defaults.capabilities ⊕ soul.capabilities   (soul wins; `off` removes):
  from: package
     → some entry in the workspace's `packages:` provides `name`          else E_PACKAGE_MISSING
     → fetch that package at the locked commit; verify integrity            else E_PACKAGE_INTEGRITY
     → its executables must be approved for that version (lock)             else E_PACKAGE_UNAPPROVED (asks once)
     → copy the capability into the instance; record package/version/commit
  from: <repo>  (or `here` = the soul's own repo)
     → <repo> must be a confirmed member                          else E_NOT_A_MEMBER
     → <repo> must contain capabilities/<name>/oats.json          else E_CAPABILITY_MISSING
     → it must not be `private: true` unless <repo> is the soul's own repo   else E_CAPABILITY_PRIVATE
     → materialize from the member's current state; record repo/commit/hash

team label:
  item's own `team:` → its repo's default in oats-membership.yaml → none ("unassigned")
  a name not in the workspace's `teams:` → E_TEAM_UNKNOWN (labels cannot drift into typos)
  defaults.byTeam.<team>.capabilities are added for a soul with that label, before the soul's own (soul wins; `off` removes)
  a label never gates, restricts, changes trust or partitions the store

launch:
  cwd = instance home; harness started with its default skill discovery — nothing excluded
  capability skills copied to <instance>/.agents/skills/<capability>/…; injects composed into AGENTS.md
  machine-level and repo-level skills resolve exactly as they would without OATS

slots (knowledge / messaging / tasks):
  a resolved capability whose manifest has `layer: X` fills slot X
  soul says `X: none` → slot empty; soul names nothing → workspace default fills it
  two capabilities with the same `layer` on one soul → E_SLOT_CONFLICT
```

No search, no ambiguity: `from` makes every reference a direct lookup. Two members may even export the same bare name — each soul says which one it meant. Discovery (`oats capabilities`, the Desktop view) still lists every non-private capability of every member with its origin, so choosing a `from` is a lookup in a list, not guesswork.

## 7. A day in the life

**Monday.** Bo lands a change to `northwind/data/capabilities/nw-warehouse-access/bin/nw-wh.mjs` on the default branch.

- `data-analyst-7`, already running on Bo's machine, keeps its **own full copy**. Nothing moves under it.
- Ana runs `oats sync`: fetches members, reports `nw-warehouse-access: 88d1c2… → 4a0f31… (northwind/data @ e91b…)`. Ana doesn't run data souls, so nothing else happens.
- Bo spawns `data-analyst-8`: preview shows the new hash and "changed since data-analyst-7"; apply materializes the new state. `instance.json` records the commit.

**Tuesday.** The team decides to move to `oats.okf` v2.2.0. One line changes in `oats-workspace.yaml` (`packages.oats.okf: v2.2.0`). The next `oats sync` on each machine resolves the new version to a commit, **asks for executable approval once**, and writes both to the lock. Nothing is installed; the next spawn of any soul with `oats.okf` fetches and copies v2.2.0. Running instances are untouched until re-spawned.

**Wednesday (a).** Someone adds `git:github.com/northwind/billing` to `members:` before the billing team has added their `oats-membership.yaml`. `oats sync` reports `billing: E_MEMBERSHIP_UNCONFIRMED (no backlink)`; billing's souls stay invisible until they consent. Nothing half-joins.

**Thursday.** A contractor, Cy, has read access to `northwind/platform` but not to the private `northwind/agents`. Cy can spawn `platform-engineer` standalone (it has no capabilities of its own). Spawning `release-manager` — not visible, it lives in `agents`. Naming `nw-house-style` — `E_MEMBERSHIP_UNCONFIRMED: cannot read git:github.com/northwind/agents`. That is the workspace's access control working: reading the workspace repo *is* being in the workspace. Northwind can make `agents` readable (it holds declarations, no secrets) or grant Cy access.

**Wednesday (b).** `oss-collective/experts` publishes an improved `security-reviewer`. Nothing happens until someone bumps the pinned revision in `external:` — a stranger's repo is never "latest".

---

## 8. `oats sync` — one command for the common path

```
$ oats sync
workspace  northwind  (github.com/northwind/agents @ 3f2a9c1e)
members    agents ✓↔   platform ✓↔ (@ 77c0…)   data ✓↔ (@ e91b…, changed)   marketing ✓↔   billing ✗ (no backlink)
packages   oats.framework 1.1.3 ✓   oats.okf 2.1.3 ✓ (approved)   oats.aweb 1.11.2 ✓   oats.jira 1.0.0 ✓ (approval needed → y)
changed    nw-warehouse-access  88d1c2… → 4a0f31…   (1 running instance still on the old state; new spawns get this)
souls      9 discovered (7 members, 1 external, 1 disabled here) · 1 private (platform-reviewer, platform only)
teams      global 2 souls · engineering 4 souls, 3 capabilities · marketing 2 souls, 2 capabilities
```

`sync` is what a person types: it confirms membership, resolves `packages:` versions to commits, verifies integrity, asks for any missing per-version approval, and reports what changed. `install`, `restore`, `init` and `use` go away — there is nothing to install or activate; `oats package add <id> <version>` edits `packages:` and syncs.

---

## 9. What this gives up — decisions for the human

| # | Today | Proposed | Who should decide |
|---|---|---|---|
| 1 | **Per-artifact executable approval** for every capability | **Members: membership IS the trust (decided).** Same as trusting a repo's committed skills. **Packages:** once per version, recorded in the lock, inherited by every instance | Decided |
| 2 | **Reproducible resolution** by construction | Members are *auditable* (commit + hash recorded in every instance), not reproducible-by-construction. **No `@revision` on members (decided)** — frozen capabilities are what packages are for | Decided |
| 3 | **Reciprocal backlink** as a membership gate | **Kept as a hard gate (decided).** The repo's half becomes a one-line `oats-membership.yaml` (replaces `oats.yaml`) | Decided: keep |
| 4 | **Per-soul software pins** (`source: git:…@v2.1.2#…` per capability) | A soul says **where** (`from: <member>` / `from: package`), never **which version** (**decided**). Optional `compatibility` floors | Decided |
| 5 | `imports:` for member souls; `exports:` lists in the old `oats.yaml` | Gone; discovery by convention, `private: true` on the item itself to stay internal (**decided**). `external:` stays pinned for non-members | Decided |

| 6 | `teams:` = messaging-provider payload (per-human/shared) | `teams:` = **org team labels** (global / engineering / marketing); the messaging payload moves under `messaging:` so the word means one thing (**decided**) | Decided |
| 7 | Harness launched with ambient skills **excluded**, only injected skills visible | Harness starts **normally**; OATS copies capability skills into `<instance>/.agents/skills/` and lets machine/repo skills resolve (**decided**) | Decided |

**Kept intact:** kernel-neutral provider payloads and `binding` validation; the lock (now also carrying per-version approval); executable approval for packages (per version, once); retained resolutions, decision revisions and the confirmed-apply contract; the official catalog; every published Desktop CLI contract (previews report "materialized from X @ commit"). **Gone:** the installed-capability tier, `.oats/packages/`, `oats install` / `use` / `init` / `restore`.

---

## 10. No migration — a clean break, and 0.24.x keeps working

Decided (human, 2026-09-23; refined with the team): "no migration" means no converter and no dual-schema reader — **not** that existing deployments stop. A 0.24.x kernel keeps spawning 0.24.x deployments indefinitely; v2 is the **0.25 line** and reads only v2 files; an operator installs 0.25 when ready to rebuild and not before. A written **rebuild guide** ships with the v2 schemas. So:

- **v2 only.** The kernel reads `oats-workspace.yaml` v2, `oats-membership.yaml`, `soul.yaml` v2 and `oats-local.yaml`; it does not read v1 declaration files and does not carry an `oats migrate`. A v1 file at a v2 path is an error naming the schema, not a silent fallback.
- **No dual-schema window**, no back-fill of `private: true`, no compatibility shims in the resolver.
- The framework's own repos are converted by hand as the first real workspace: the `oats` repo's workspace file drops its six `imports`, each of the five/six soul editions turns its `source: git:…@vX#oats-package` lines into `from: package` and drops its `stores.inherit` block, and each member repo gains its one-line `oats-membership.yaml`.
- The classic `oats-config.yaml` / `init` / `use` surface is **replaced**, not wrapped — `oats-local.yaml` + `oats sync` are the surface. (What remains of `oats-config.yaml`'s job is host paths and disabled souls; that is all `local.yaml` carries.)

## 11. Open questions

None. Every question raised in this brainstorm was closed with the human on 2026-09-23; the decisions are listed at the top of this document. Next step: write this up as a `Decision` concept in the oats-expert knowledge bundle (context, the model, the eleven decisions, what is removed, what is kept), update the adoption plan, and then plan the implementation — a clean v2 with no migration.
