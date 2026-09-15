_OATS architecture · accepted for infrastructure implementation · reconciled 15 September 2026_

# Portable Souls

> **Design accepted; implementation authorization is now explicit.** Baseline
> `428cd9af615652c4a93d754c1106674abd18545b` contains storage retention only, not
> migrated consumers or private-team guarantees. Desktop feature work is **later**.

How a multi-repository organization can publish expert souls, discover them through
existing Git access and prepare them on different machines, without an OATS registry:
private-first messaging choices and captured software compositions are the accepted
target, **not certified deployed behavior**.

> The **soul** declares what it needs and where it comes from.
> The **workspace** declares admission, defaults, knowledge stores, teams and catalogs.
> The **local deployment** resolves, installs, binds credentials and keeps state.

**Example boundary:** all LFX repository/package names, roles, versions, team
addresses, local layouts and scenarios below are **illustrations, not an inventory
or facts about a real deployment**. They are not claims that a named repository,
package export, release or provider behavior exists. No credentials or transcripts
are included. YAML shapes need parser/schema review; `repo:` semantics are accepted.
The [reconciled proposal](2026-09-14-portable-souls-and-git-workspaces.md),
[binding handoff](2026-09-15-portable-souls-handoff.md),
[public amendment](2026-09-14-portable-souls-contract-amendments.md) and
[implementation ledger](2026-09-15-portable-souls-implementation.md) are the common
baseline. There is no separate pre-review policy on this page.

_Concepts_

## The vocabulary

Every later section uses these words precisely. The LFX column illustrates the accepted model, not an actual checkout or live membership.

| Concept | What it is | In LFX |
|---|---|---|
| Soul | A durable expert definition: role, procedural curriculum, capability requirements, knowledge nodes, team aliases. Not a running process. | `self-serve-expert`, `self-serve-ux-expert`, `member-service-expert`, `mcp-data-expert`. Project experts can be committed in their own repositories' `agents/` directory and shared; local-only definitions are not a publication mechanism. |
| Instance | One incarnation of a soul: its own home, task, effective composition, runtime identity. Retired when done. | `self-serve-expert-1` working a PR in a worktree of `lfx-self-serve`. |
| Capability | A reusable runtime surface: skills, instructions, commands and hooks, helper agents. May implement a fundamental layer. | `lfx.local-review` (adversarial review workflows), `lfx.service-dev`, `lfx.ui-dev`, `oats.okf` (knowledge), `oats.aweb` (messaging), `oats.jira` (tasks). |
| Package | The acquisition and update unit: exports one or more capabilities, with payload and dependency declarations. | `lfx-engineering-capabilities#packages/local-review`; `awebai/oats-okf`. |
| Fundamental layer | Knowledge, messaging, tasks. Zero or one default implementation per slot in an instance is a v1 simplification, provisional; implementations are replaceable. | OKF, aweb, Jira as illustrative choices; a default fills an open role but cannot override a hard requirement. |
| Source repository | The versioned home of souls or packages. In the beginning this is simply the project repository itself: souls live under its conventional `agents/` directory, next to the code they work on. A dedicated souls repository is an option for souls that span repositories, not the starting point. | `lfx-self-serve/agents/self-serve-expert/`, `lfx-v2-member-service/agents/member-service-expert/`; `lfx-engineering-experts` for experts that span repositories (`mcp-data-expert`, `org-dashboard-expert`, `individual-dashboard-expert`); `lfx-engineering-capabilities` for packages. |
| Work target | The repository or directory an instance operates on. Not necessarily the soul's source repository. | `lfx-v2-member-service`, worked by a soul that may live in `lfx-engineering-experts`. |
| Workspace definition | A Git-hosted organisational authority: admitted repositories, layer defaults, knowledge stores, team references, catalogs. No secrets. | An illustrative `lfx-workspace` repository, separate from local deployment configuration. |
| Local deployment | One operator's installed realisation: artifacts, lock, repository mappings, credentials, trust approvals, private team, instance compositions. | Operator A's root, operator B's different root, or a laptop with only `lfx-self-serve` cloned. |
| Team | A messaging provider's membership boundary; catalog/live visibility, contact and history are separate grants requiring qualification. | `lfx` (everyone), `self-serve`, `platform`, `marketing`. |
| Private team | Intended per-human/workspace team for messaging-enabled instances, reused across hosts; wider teams are opt-in. No privacy guarantee until a named owner qualifies the provider. | Human A plus qualified workspace identity is the key, not a username or alias. |
| Knowledge store and node | Durable knowledge outside souls. Default OKF uses store-qualified nodes, one steward per node and explicit promotion destinations; other providers own their models. | `lfx-knowledge` with nodes such as `self-serve-service`, `lfx-review-conventions`. |
| Artifact and lock | Immutable capability artifact with package provenance. The lock holds new-preparation choices; captured resolutions outside homes govern instances/jobs. | `lfx.local-review / 4b7e02` selected by three instances; `lfx.local-review / c91a4f` by a fourth. |
| Channel and pin | A moving selector (`@main`, a release channel) or a fixed one (`@v4.1.0`, a commit). Resolved once per instance into an artifact. | Marketing follows `@main`; platform pins during a release. |

_Why_

## The fundamental issues

The symptoms (an uncommitted config, a gitignored `local-agents/` folder) are downstream of five structural problems. Each one is something the architecture has to answer, not something a tidier config file fixes.

| Issue | Root cause | Illustrative failure | What the design does |
|---|---|---|---|
| Expertise is trapped on machines | A soul is an accumulation of expertise, but its definition depends on things that exist only on the author's laptop. So the organisation cannot own, share or build on its own experts; each person re-creates them. | An unpublished `self-serve-ux-expert` depends on its author's local setup; colleagues must reconstruct its dependencies. | Souls become self-describing: every requirement carries its source, every knowledge node its store. A committed soul's *software sources* are complete; deployment inputs (credentials, team enrolment, store access) can still be missing and are reported as such. (see: Files) |
| Identity is inferred from location | What something is, where it came from, who admitted it and where it runs are all read off the filesystem. Nothing is addressable independently of a machine, so nothing can be reasoned about, trusted or moved. | A naive folder-based rule mistakes a fork or stray clone for a member and misses real members elsewhere; provenance becomes a folder name. | Qualified identities and reciprocal Git declarations. Source, install location, work target and team membership are four separate facts. (see: Org) |
| There is no organisational unit for agents | Repositories exist and machines exist; "LFX's agents" does not exist anywhere as a thing that can admit members, set defaults, list its knowledge or be asked what experts it has. | Without declarations, answering "which experts exist and where?" depends on the original operator instead of inspectable data. | A Git-hosted workspace definition: admission, defaults, knowledge stores, team references, catalogs. Discoverable from any member repository with existing GitHub access. (see: Onboarding) |
| Freshness and reproducibility fight | Humans want the latest and do not want to manage version numbers. Running agents need an exact, immutable composition or their behaviour changes under them and they cannot be retired or recovered safely. One mutable pointer cannot satisfy both. | Updating `lfx.local-review` in the shared store changes it for every instance already running, including a review sweep queued yesterday. Pinning it instead means someone manages versions by hand. | Channels and pins for humans; one immutable resolution per instance for machines; several artifacts per capability side by side; approval per revision for anything executable. (see: Updates) |
| Access is one blunt grant | Reading a repository, executing its hooks, joining a team, seeing a colleague's running agents and reading their conversations are five different permissions. When they are one, either too much is exposed or everything is locked. | Anyone who can read `lfx-self-serve` would, under a naive design, see and contact every instance spawned from it, including a manager reading an engineer's agents' mail. | Catalog/live visibility, contact and history are separate grants; private-first is the intended default pending provider qualification, not inferred from source access. (see: Teams) · (see: Permissions) |

A sixth constraint sits across all five: solving them must not add infrastructure LFX has to operate. No registry service, no discovery daemon, no OATS user database. Git hosting, the messaging provider and the machines people already have are the whole substrate.

_The model_

## Three responsibilities, kept apart

The design separates what travels with a soul, what the organisation asserts, and what one operator has actually installed. Source location, installation location, work target and team membership are four different things and none may be inferred from another.

**Soul**

_Owned by the soul's maintainer · committed with the soul_

- Role and procedural curriculum
- `requires` constraints and `defaults` fallbacks; each intrinsic capability has a **source-complete** reference: repository, package path, revision policy
- Source-complete knowledge locators or explicitly inherited bindings; store-qualified reads and optional owned-node destinations for OKF
- Logical team aliases (`self-serve`, `lfx`), never a provider's real team id
- Fundamental-layer needs it does not care about (any messaging provider)

**Workspace definition**

_Owned by workspace maintainers · the `lfx-workspace` repository_

- Admitted member repositories
- Default provider per fundamental layer
- The organisation's knowledge stores and tools, so authors and onboarding can find them
- Named team references mapped to provider-qualified ids
- Catalog sources for capability packages
- No secrets, no machine state

**Local deployment**

_Owned by one operator · on one machine_

- Retained artifacts; lock choices for new preparation and separate captured resolutions outside homes
- Repository mappings, work targets
- Credentials, knowledge-store connections
- The human's private team and each instance's wider memberships
- Executable trust approvals
- Per-instance compositions

Two boundaries fall out of this. A soul can carry the *software* needed to talk to Jira or a knowledge store; it cannot carry anyone's credentials, enrolment or paths, so a missing input produces an explicit `needs configuration` rather than a launch that pretends to have succeeded. And discovery may *advertise* a capability without *activating* it: only what a soul actually requires, plus its dependency closure, is installed.

_At org level_

## LFX, drawn

Illustrative topology, not a deployment inventory. Labels [new] indicate possible additions, not approved repository creation. A repository may hold several independently updated packages; every listed member follows the same reciprocal rule.

> **Souls live in project repositories first**
> - The default home of a soul is the repository it works on, under that repository's `agents/` directory: `lfx-self-serve/agents/self-serve-expert/`.
> - A repository carries as many repo-related souls as it wants. `lfx-self-serve` can hold `self-serve-expert`, `self-serve-ux-expert` and `self-serve-accessibility-expert` side by side, each exported.
> - Unpublished project-related definitions can be made portable there without a central soul repository.
> - A separate experts repository such as `lfx-engineering-experts` is for experts whose subject spans repositories (`mcp-data-expert`, `org-dashboard-expert`, `individual-dashboard-expert`), or later a marketing team with no code repository. Nothing requires souls to be centralised.
> - Souls are named for the expertise they hold, not for a job title: `self-serve-ux-expert`, not "UX engineer".

- _workspace definition_: **lfx-workspace (new)** — members · layer defaults · knowledge stores · teams (lfx, self-serve, platform, marketing) · catalogs

  (admits / backlink)

- _capability repository_: **lfx-engineering-capabilities** — `packages/local-review` · `packages/pr-flow` · `packages/service-dev` · `packages/ui-dev` · `packages/mcp-playbooks`
- _experts repository · subjects that span repositories_: **lfx-engineering-experts** — mcp-data-expert · org-dashboard-expert · individual-dashboard-expert
- _souls repository_: **lfx-marketing-souls (new)** — campaign-strategy-expert · newsletter-strategy-expert · community-content-expert
- _project repository · carries its own souls_: **lfx-self-serve** — `agents/self-serve-expert` · `agents/self-serve-ux-expert` · `agents/self-serve-accessibility-expert` · `packages/self-serve-dev` (project-local capability)
- _project repositories · each carries its own souls_: **lfx-v2-member-service, lfx-v2-meeting-service, lfx-v2-committee-service, …** — `agents/member-service-expert`, `agents/member-service-salesforce-expert`, `agents/meeting-service-expert`, … sharing lfx.local-review and lfx.service-dev
- _knowledge store_: **lfx-knowledge (new)** — one illustrative default store, not a one-store limit · explicit node stewards/destinations · default OKF promotion

_Sources that are not membership (see Reciprocal membership)_

- *every developer soul* → lfx-engineering-capabilities#packages/local-review
- *self-serve-expert* → its own repo, `repo:packages/self-serve-dev`
- *workspace defaults* → awebai/oats-okf, oats.aweb, oats.jira (third party: no backlink, not admitted)

### Shared capabilities in `lfx-engineering-capabilities`

One repository, several independently updated package roots. This illustrative grouping preserves examples of shared craft; it is neither an inventory nor a packaging decision.

| Package | Capability | What it groups |
|---|---|---|
| packages/local-review | `lfx.local-review` | Adversarial review workflows: the per-repository convention reviewers, the learnings reviewers fed by each repo's review knowledge base, and the general reviewer, launched together after every commit. |
| packages/pr-flow | `lfx.pr-flow` | Branching, PR readiness and preflight conventions; the pre-PR full-branch sweep. |
| packages/service-dev | `lfx.service-dev` | The Go service craft shared by the v2 services: Goa design and generated-code boundaries, NATS, FGA, indexer contracts, Helm chart wiring. |
| packages/ui-dev | `lfx.ui-dev` | UI conventions shared by `lfx-v2-ui` and `lfx-self-serve`: component patterns, accessibility, upstream API validation. |
| packages/mcp-playbooks | `lfx.mcp-playbooks` | MCP playbooks that `mcp-data-expert` could share with other MCP-facing souls. |

Souls pick from these individually: `self-serve-ux-expert` needs `lfx.ui-dev` and `lfx.local-review`, not `lfx.service-dev`. Only what a soul requires is installed.

_Admission_

## Membership is reciprocal, for every member

A repository belongs to the LFX workspace when two independent declarations agree: the workspace **admits** the repository, and the repository **names** the workspace. Neither alone is enough. This is the general rule for organisational membership; it does not care what the repository contains.

```
eligible(operator, repository, workspace) =
     operator can read lfx-workspace
 AND operator can read repository
 AND lfx-workspace admits repository
 AND repository identifies lfx-workspace
```

Why both directions: admission alone would let the workspace claim any public repository; a backlink alone would let any fork or copy join by keeping one line. Together they mean a member is something both sides chose, at recorded revisions, and nothing can be faked by moving folders or forking. Identities are qualified (canonical remote, provider repository id), so renames and transfers are handled explicitly rather than by whichever same-named folder wins.

### It applies to every kind of member

The rule is the same whether the repository holds code, souls, packages or knowledge. What admission *unlocks* differs by what the repository exports.

| Member | Example | Its backlink says | Admission makes it |
|---|---|---|---|
| Project repository | `lfx-self-serve`, `lfx-v2-member-service` | `workspace:` plus the souls it exports from its own `agents/`, and any project-local package | A candidate work target and source of souls discoverable with required repository access; preparation has separate readiness gates. |
| Experts repository | `lfx-engineering-experts`, `lfx-marketing-souls` | `workspace:` plus its exported souls | A source of souls whose subjects span repositories. |
| Capabilities repository | `lfx-engineering-capabilities` | `workspace:` plus its package roots | A catalog entry: its packages are advertised to soul authors. Nothing is installed by admission alone. |
| Knowledge repository | `lfx-knowledge` | `workspace:` plus the store it exposes | A listed knowledge store: authors and the onboarding expert can find it, harvesters can be pointed at it. Reading it still needs GitHub access to it. |

**lfx-v2-member-service/oats.yaml (a project repository)**

```yaml
workspace: git:github.com/linuxfoundation/lfx-workspace

exports:
  souls:
    - path: agents/member-service-expert
    - path: agents/member-service-salesforce-expert
```

**lfx-knowledge/oats.yaml (a knowledge repository)**

```yaml
workspace: git:github.com/linuxfoundation/lfx-workspace

exports:
  knowledge:
    - store: .              # this repository is the store
      description: LFX expert knowledge, soul-owned nodes
```

### What is not membership

- **Consuming a source.** The workspace defaults point at `awebai/oats-okf`, `oats.aweb` and `oats.jira`; souls may point at third-party packages. None of those repositories backlink, none are admitted, none become LFX members. A source declaration grants no membership, no execution trust and no credentials.
- **A fork.** A personal fork of `lfx-engineering-experts` still carries `workspace: linuxfoundation/lfx-workspace`. The workspace does not list the fork, so it is not a member: its souls are not discoverable as LFX's and its packages are not catalogued.
- **A neighbouring folder.** Something cloned under `~/lfx` that neither backlinks nor is admitted is just a directory.
- **A public reusable soul repository.** It cannot backlink to every organisation that uses it, so it is consumed, not admitted: LFX *imports* the soul by reference (below).

### Importing an external soul

The accepted contract resolves the external-adoption gap: A soul that lives in a repository LFX cannot admit is used by **reference, never by copy**. The reference has four fields: canonical source repository, exported soul path, revision selector, adopter-local alias. Preparation retains the exact resolved revision and the source files the soul needs; the upstream soul identity, the revision and the local alias stay distinct, so a newer revision is the same soul and a renamed alias is not a new one.

```
# lfx-workspace/oats-workspace.yaml
imports:
  - source: git:github.com/some-org/mcp-experts
    soul: agents/mcp-data-expert
    revision: v2.3.0                 # pin or channel, resolved once per prepare
    alias: mcp-data-expert
    adoption:                        # workspace-side defaults for this import, keyed to the qualified upstream identity
      teams: { experts: platform }     # advertises a destination; does not enrol
      knowledge-destination: lfx-knowledge
      tasks: oats.jira                # rebinds a default; cannot replace a hard requirement
```

- The workspace advertises the import in its catalog; the source repository is not admitted and needs no backlink. Private sources still need GitHub access.
- A standalone prepare accepts the identical reference with no workspace at all.
- Adoption defaults on the entry may bind extension points and rebind rebindable defaults; a spawn-time choice may override them within the same bounds. Neither edits the soul.
- The imported soul's original organisation never becomes a second source of policy; the instance selects exactly one workspace context.

Adding a member is two reviewed changes: a PR to `lfx-workspace` adding one line to `members`, and a PR to the new repository adding its `oats.yaml`. Removing a member is either one. Branch protection on both sides is the review process; no OATS service is involved.

_Concretely_

## What the files say

Illustrative syntax from the proposal, not an agreed schema. What matters is the shape: each file says only what its owner is entitled to say.

**lfx-self-serve/agents/self-serve-expert/soul.yaml**

```yaml
name: self-serve-expert
description: Ships lfx-self-serve features through reviewed PRs

requires:                       # hard constraints, never erased by an override
  capabilities:
    lfx.local-review:
      source: git:github.com/linuxfoundation/lfx-engineering-capabilities@main#packages/local-review
    lfx.self-serve-dev:
      source: repo:packages/self-serve-dev  # root of retained source repository
  messaging: any               # no concrete provider => needs configuration
  tasks: any

defaults:                       # fallbacks rebindable within requirements
  tasks:
    capability: oats.jira
    source: git:github.com/awebai/oats-jira@v1#oats-package

knowledge:                      # OKF payload, NOT a mandatory kernel node schema
  reads:
    - store: git:github.com/linuxfoundation/lfx-knowledge@main
      node: lfx-platform-architecture
    - store: git:github.com/linuxfoundation/lfx-knowledge@main
      node: lfx-review-conventions
  owns:
    - node: self-serve-service   # inherits explicitly selected write binding
    - node: self-serve-ui-patterns
      destination: git:github.com/linuxfoundation/lfx-knowledge@main

teams: [self-serve, lfx]         # opt-in aliases, not automatic wider enrollment
```

These conceptual fields require parser review, including how a fixed store source
is distinguished from a rebindable default. `owns` without a destination does not
invent a store: no explicit write binding means `needs configuration`. Each resolved
address includes store plus node; equal leaf names in different stores never collide.
All provider/version/team labels below are hypothetical, not install instructions.

**lfx-workspace/oats-workspace.yaml**

```yaml
name: lfx

members:
  - github.com/linuxfoundation/lfx-engineering-capabilities   # packages
  - github.com/linuxfoundation/lfx-engineering-experts        # souls
  - github.com/linuxfoundation/lfx-marketing-souls            # souls
  - github.com/linuxfoundation/lfx-knowledge                  # knowledge store
  - github.com/linuxfoundation/lfx-self-serve                 # project + its souls
  - github.com/linuxfoundation/lfx-v2-member-service          # project + its souls
  - github.com/linuxfoundation/lfx-v2-meeting-service
  # … one line per admitted repository, whatever it holds

defaults:
  knowledge: { capability: oats.okf,  source: git:github.com/awebai/oats-okf@v2#oats-package }
  messaging: { capability: oats.aweb, source: git:github.com/awebai/oats-aweb@v1#oats-package }
  tasks:     { capability: oats.jira, source: git:github.com/awebai/oats-jira@v1#oats-package }

knowledge:                # discoverability: where LFX keeps knowledge
  stores:
    - git:github.com/linuxfoundation/lfx-knowledge      # one store for now; more can be listed later

teams:
  lfx:        aweb:lfx.aweb.ai/lfx
  self-serve: aweb:lfx.aweb.ai/self-serve
  platform:   aweb:lfx.aweb.ai/platform
  marketing:  aweb:lfx.aweb.ai/marketing
  private:    per-human          # default: one private team per person

catalogs:
  - git:github.com/linuxfoundation/lfx-engineering-capabilities
```

**lfx-engineering-experts/oats.yaml (member repository backlink + export index)**

```yaml
workspace: git:github.com/linuxfoundation/lfx-workspace

exports:
  souls:
    - path: agents/mcp-data-expert
      description: Exposing LFX data through MCP: schema, playbooks, limits
    - path: agents/org-dashboard-expert
      description: What an organisation sees of itself in LFX and why
    - path: agents/individual-dashboard-expert
      description: The individual contributor's view: identity, activity, privacy
```

Small, declarative, data-only. Discovery reads this file; it never scans the tree or runs anything in the repository.

**Illustrative deployment (new resolution/source-store paths and wire schema require review)**

```
<deployment>/
  oats-lock.json                 # current choices for NEW preparation only
  .agents/capabilities/artifacts/
    lfx.local-review/
      sha256-4b7e02…/            # older skill-only artifact
      sha256-c91a4f…/            # new skill-only artifact; visible change notice
    oats.jira/
      sha256-a13d77…/            # approved executable artifact (has a spawn hook)
  <captured-resolutions>/        # outside homes; authority for each instance/job
  <retained-soul-sources>/        # qualified identity + digest; not capability helpers
  .oats-state/                   # provider state; private choices, not privacy proof
  lfx-self-serve/                # work target, mapped in the deployment
  lfx-v2-member-service/
```

Digest prefixes above are abbreviated **display labels**, not valid on-disk
references; retained artifacts use full `sha256-<64 hex digits>` digests. Soul-source
and resolution paths are placeholders pending schema review, not landed directories.

_Communication_

## Teams: private first, wider by choice

The accepted target is a private team for each human's messaging-enabled instances
in one workspace, reused across that human's machines. The human may opt each
instance into wider aliases such as `lfx`, `self-serve` or `marketing`.

**No provider privacy guarantee is claimed until a named messaging owner qualifies
actual behavior.** This is the intended model, not certified aweb behavior:

- **Private is the floor.** Use a provider-resolvable human identity plus qualified
  workspace identity, never OS username, checkout path or agent alias. Children
  and scheduled instances inherit their responsible human. Messaging-disabled
  workers create no team. Standalone deployments need an explicit context key;
  `messaging: any` supplies no software, credentials or enrollment.
- **Wider is opt-in per instance.** Soul aliases and import mappings advertise
  destinations, not membership. Explicit wider sets replace wider defaults while
  retaining the private floor; `[self-serve]` does not accumulate every alias.
- **Identity survives membership changes.** One global instance identity holds
  multiple provider membership credentials and survives widening/narrowing. Local
  process/session/deployment-record IDs and team-qualified aliases are not that
  identity. Two incarnations of a soul do not automatically share it.
- **Four grants, separately qualified.** Catalog visibility, live-instance visibility,
  contact permission and conversation-history access differ. Joining a wider team
  must not reveal prior private conversations or other private instances. Ordinary
  members and administrators controlling host/service are distinct access contexts;
  private-team design is not protection from the latter.
- **Capture choices honestly.** Private context and wider-team references are not
  evidence of enrollment, credential availability or privacy.

For illustration, human A keeps `self-serve-ux-expert-2` private while opting
`self-serve-expert-1` into `self-serve`. Human B's representative joins that wider
team. They should be contactable there without exposing either human's other
instances or earlier history. That is a qualification test, not a guarantee
established by writing a team map.

_Knowledge_

## Knowledge follows the same rule

The knowledge source is declared at the workspace level too, and a soul must be able to reach its knowledge by knowing *where to look* and *which nodes belong to it*, without needing access to the workspace repository. The workspace is the discoverability point that says which knowledge repositories and tools LFX has; it is not a gate the soul passes through on every read.

**The soul carries**

- Source-complete store locators or explicitly inherited bindings; fixed sources and rebindable defaults stay distinct
- The nodes it **owns** with optional destinations; absent destinations inherit an explicitly selected write binding or report missing configuration
- The nodes it **reads**, each store-qualified; context selection, not an access-control list

**The workspace carries**

- The list of stores: `lfx-knowledge` is one illustrative entry, not a limit
- The default knowledge provider (the capability that reads and harvests: `oats.okf`)
- Defaults resolved before use; subsequent reads do not refetch the workspace

**The deployment carries**

- Credentials for the store
- Resolved locators, local clone/connection and provenance captured outside the home
- Explicit promotion destinations, credential references and approvals; later schedules retain execution resolutions

The kernel's knowledge contract stays provider-neutral: the owns/reads node model and harvester-only promotion describe the default implementation (OKF); a replacement knowledge provider exposes its own configuration and readiness through the capability contract and is not forced into OKF's storage or authoring model.

Precedence is constraints plus fallbacks: a generic soul can inherit a selected store/provider binding; a specialized soul can fix its source. Operator/import choices rebind only defaults and extension points. The provider-neutral kernel envelope records non-secret payload/provenance with separate credential references. Access belongs to GitHub or the selected provider; a workspace-only nickname is not a complete address.

### Open-source souls may consume open-source knowledge bases

A public soul can name a public store the same way it names a public package: `mcp-data-expert`, once open-sourced, may read from a public `mcp-knowledge` repository maintained with it, and any organisation that prepares the soul reads that store with no LFX involvement. Consuming a public store is a source relation, not membership; it does not admit the store's repository to the adopter's workspace. A separately declared membership still follows the reciprocal rule.

Within declared defaults and extension points, the adopting organisation chooses where the soul's *own* nodes grow: in the public store, if its maintainers accept harvest PRs, or in its own store (`lfx-knowledge`). Fixed source requirements cannot be overridden. Each choice resolves a store-qualified destination under the declared node name. Public PRs do not break single-owner stewardship, because three roles are involved: the node's responsible steward, the harvester proposing a change, and the repository maintainers accepting it. Consuming a public store never implies publishing the adopter's notes to it; the destination and the intent to publish are explicit. Reads may come from more than one store. The invariant is **one explicit owner per node and an explicit destination for each promoted concept**, not one storage location per soul; one default write store is a common case, not an approved limit. Git promotions use PRs, public or private; proposal and acceptance differ.

Why the workspace list matters even though souls do not need it: someone writing `newsletter-strategy-expert` and choosing which nodes it should read, and the onboarding expert presenting "these are LFX's knowledge repositories", both start from that list. Node ownership stays with souls, one owner per node, per the knowledge direction of 13 September.

The reconciled proposal carries the same contract. Knowledge remains outside the
soul; only declarations travel. Later reads and independent harvests need not
consult the publisher's workspace or retain the source home. Mutable knowledge
contents are not part of the software pin.

_Walkthrough_

## Onboarding from one repository

A new engineer joins the platform team. They have a laptop, GitHub access to the LFX repositories, and a clone of `lfx-v2-member-service` because that is the service they were handed. They ask the onboarding expert: "Set me up to work on the member service the LFX way."

1. **Read the backlink.**
  `lfx-v2-member-service/oats.yaml` names `github.com/linuxfoundation/lfx-workspace`. That is the only thing the local checkout contributes.
2. **Fetch the workspace definition.**
  Using the engineer's own GitHub token. Nothing is cloned; one small file is read at a recorded revision.
3. **Validate admission.**
  `lfx-v2-member-service` is in `members` and points back: eligible. Every other member is checked the same way. A name exposed by the readable allowlist can be marked inaccessible/unavailable without fetching protected descriptions; never distinguish hidden from nonexistent beyond what GitHub exposes.
4. **Read export indexes.**
  `lfx-v2-member-service` exports `member-service-expert` and `member-service-salesforce-expert`; `lfx-engineering-experts` exports `mcp-data-expert`, `org-dashboard-expert` and `individual-dashboard-expert`; `lfx-engineering-capabilities` advertises its packages. The engineer is shown qualified names and where each comes from.
5. **Resolve, then fetch only what is needed.**
  The engineer picks `member-service-expert` and `member-service-salesforce-expert`. Their requirements plus the workspace defaults resolve in one transaction into exact compositions: `lfx.local-review@main` at `4b7e02`, `lfx.service-dev@main`, `oats-okf@v2`, `oats-aweb@v1`, `oats-jira@v1`. Those packages are materialised; `lfx-knowledge` is cloned for the declared nodes. `lfx-self-serve` and the marketing repositories are never downloaded.
6. **Record the private context and wider choices.**
  With a bound, qualified messaging provider, preparation would reuse/create the engineer's private team. The engineer chooses `platform` for one instance; the other stays private-only. Until a named owner qualifies the provider, report choices and unqualified enrollment/privacy separately, not an existing private team.
7. **Report each readiness boundary separately.**
  Installed: yes. Executable trust: `oats-jira` has a spawn hook, so its artifact needs the engineer's approval. Bindings: Jira credentials missing, `needs configuration`. Teams: private context and `platform` choice recorded; enrollment/provider qualification pending. No unapproved resources execute and nothing claims unestablished readiness.

After complete preparation, ordinary files retain artifacts, soul source, captured resolution and non-secret binding/team choices outside the home. CLI diagnostics are infrastructure work; Desktop follows these APIs later. The onboarding conversation need not survive. Failed preparation never publishes a selectable partial resolution.

_Configuration_

## Precedence: two levels, no repository defaults

The accepted contract replaces the original three-tier proposal. Capability policy has two authorities, one resolver. A standalone repository can be the explicit deployment scope, not a middle tier between workspace and soul.

- **1. Workspace defaults** — Provider per fundamental layer, knowledge stores, team map, catalogs. Fill whatever the soul left open.
- **2. The soul's own declarations** — Intrinsic capabilities with sources, knowledge store and nodes, team aliases, any hard requirement on a specific provider. Portable: travels with the soul.
- **Explicit operator choice, bounded (not a third tier)** — On the workspace side (an import entry's adoption defaults, or a spawn-time choice). May rebind defaults and bindings; can never erase a hard requirement, and an attempt reports an incompatibility. Not a third tier: two authorities, one resolver.

Two rules hold at every level: a hard requirement is never erased by a default, and an incompatible combination (two providers for one slot, a required provider the workspace forbids) fails loudly or reports `needs configuration`. Nothing is silently substituted.

- **No agent-types/family entity.** Soul declarations and qualified per-soul adoption choices replace family policy in the target design; the baseline resolver is not claimed migrated.
- **One explicit workspace context.** An imported soul's original organization never supplies another policy tier. Standalone preparation uses explicit bindings and reports missing ones.
- **Repository briefing (`agents-md-injection`) and worktree setup stay**, selected from the repository actually worked on, not the imported source. Executable trust applies. Directory work targets need no fake Git or membership.

_Versions_

## Updates without surprises

People should not pick numbered versions as a routine. Machines still need exact revisions to reproduce behaviour and to retire or recover an instance safely. The reconciliation: humans choose a **channel** or a **pin**; preparation resolves it once into an **immutable composition**; the deployment keeps **several artifacts per capability** side by side.

- **lfx.local-review / 4b7e02** — resolved from @main on 9 Sep · approved
  Selected by:
  - self-serve-expert-1 (started 10 Sep)
  - nightly review sweep (queued 13 Sep)
  - member-service-expert-1 (platform pinned for release)
- **lfx.local-review / c91a4f** — resolved from @main on 14 Sep · approved today
  Selected by:
  - meeting-service-expert-2 (started today)
  - new compatible instances following that channel after explicit refresh and any required approval; pinned preparations keep their selected revision

- **Explicit prepare/update** refreshes once per transaction. Show available-unapproved beside last-approved usable, never calling the latter "latest"; no daemon or unattended approval. **Existing instances and queued jobs** keep captured resolutions, not today's lock. Declarative skill changes get a bounded visible notice.
- Inside **one** instance there is exactly one artifact per capability id. If a dependency closure needs two, both requirement paths are reported and preparation fails; no newest-wins rule, no general semver solver in the first version.
- Artifacts referenced by a live instance, a rollback or a pending job are retained, including the code needed to retire an instance after its source has been deleted.
- Offline use is shown as last-known, not as current. A failed refresh is visible.
- The pin covers the OATS-managed composition: soul snapshot, capability closure, helpers, commands and hooks, non-secret configuration and binding provenance. It does not freeze knowledge contents, credentials, live team memberships, the work repository, external services or host tools.

### Automatic download is not automatic trust

OATS already requires fresh approval when an executable artifact's integrity changes. "Executable" means the package declares **commands, hooks, or environment**. One hook is enough.

| Package | Executable? | Following @main means |
|---|---|---|
| lfx.local-review (skills and instructions only) | No | New instances may use them after explicit prepare/update; visible change notice, no execution-approval prompt. |
| oats.jira (no commands, but a spawn hook) | Yes | Every changed executable artifact needs fresh approval; unchanged artifact integrity keeps its approval despite unrelated source changes. |
| oats.aweb (commands and hooks) | Yes | Same: approval per revision. |

Any provider declaring commands, hooks or environment is gated at the changed artifact, including env-only providers. V1 has no unattended approval. Any future policy needs a separate decision; publisher continuity or "latest" never grants approval. Rolling software back also does not undo external writes or schema migrations, so two revisions sharing `lfx-knowledge` still need provider compatibility.

_Access_

## Four permissions, not one

GitHub supplies authentication and content authorization; the workspace supplies
admission; the messaging provider owns membership and actual permissions. There
is no second OATS user database or ACL engine.

- **Catalog visibility:** accessible exported souls/packages, not live presence.
- **Live-instance visibility:** which running incarnations may be discovered.
- **Contact:** permission to address/message an instance.
- **Conversation-history access:** permission to read earlier conversations, never
  inferred from contact or later wider-team membership.

The intended private-first outcome is that repository access alone reveals neither
private live instances nor their conversations. Widening one instance must not
expose other private instances or earlier history. **No privacy guarantee until a
named messaging owner qualifies provider behavior** in these separate dimensions,
including ordinary members versus administrators controlling host/service.
A recorded membership choice does not constitute qualification.

A readable allowlist may reveal private repository names; protected descriptions
must not be copied into broader indexes. Caches must not cross authorization
contexts. Revocation cannot erase existing clones; offline metadata is last-known,
not proof of current membership.

_Modularity_

## Same pieces, eight arrangements

The point of separating soul, workspace and deployment is that the same pieces compose into very different setups without any of them changing shape. Each card is an acceptance illustration for the target, not something a real deployment can run today. In all of them a soul may live in the project repository it works on, in a shared souls repository, or in a third party's repository; the arrangement never dictates where.

**Solo engineer, one repo, no workspace**

Clone `lfx-self-serve` alone and spawn `self-serve-expert` from its own `agents/` directory. The repository is the deployment.

- Workspace: none reachable; standalone scope
- Capabilities: from the soul's sources: lfx-engineering-capabilities and `repo:packages/self-serve-dev`
- Knowledge: the store the soul names, if readable; else needs configuration
- Teams: `messaging: any` supplies no software, credentials or team. Missing provider/human identity/standalone context key => needs configuration. Private-team claims additionally require named-owner provider qualification; no unnamed product default is assumed

**The whole organisation**

`lfx-workspace` admits thirty repositories; anyone starts from whichever one they hold.

- Workspace: defaults, stores, teams, catalogs
- Capabilities: souls' sources plus defaults
- Knowledge: lfx-knowledge
- Teams: private plus opt-in lfx, platform, self-serve, marketing

**A team with its own capability repo**

Marketing keeps `lfx-marketing-capabilities` without touching `lfx-engineering-capabilities`; its souls point there.

- Workspace: admits the new repo; adds it as a catalog
- Capabilities: `lfx.campaign-research` from the marketing repo
- Knowledge: own nodes in lfx-knowledge, or a marketing store
- Teams: private plus marketing

**Project-local capability**

`lfx-self-serve` could carry `packages/self-serve-dev` and reference `repo:packages/self-serve-dev` from its retained repository root.

- Workspace: unchanged
- Capabilities: one from lfx-engineering-capabilities, one from the same snapshot
- Knowledge: unchanged
- Teams: unchanged

**Open-sourcing a soul**

`mcp-data-expert` is published for the world. Another organisation prepares it with its own defaults and bindings.

- Workspace: theirs, not LFX's; no backlink to either
- Capabilities: from the soul's public sources
- Knowledge: the public store the soul names for what it reads; their own store for the nodes it owns locally (syntax open)
- Teams: their private teams and aliases

**Two speeds in one workspace**

Platform pins `lfx.local-review@v4.1.0` through a release; everyone else follows `@main`.

- Workspace: unchanged
- Capabilities: two lfx.local-review artifacts coexist; each instance holds one
- Knowledge: shared, provider-compatible
- Teams: unchanged

**Swapping a layer**

LFX moves tasks from Jira to GitHub Issues by changing one workspace default.

- Workspace: `tasks: oats.github-issues`
- Capabilities: souls saying `tasks: any` follow; a soul hard-requiring Jira keeps Jira or reports needs configuration
- Knowledge: unchanged
- Teams: unchanged

**Two organisations on one laptop**

Two explicit deployments side by side, with separate defaults and selected workspace contexts; provider isolation still requires qualification.

- Workspace: two, each reciprocal with its own members
- Capabilities: separate artifact stores and locks
- Knowledge: separate stores
- Teams: separate private teams per workspace

_Payoff_

## What it unlocks

**Commit the local souls**

Local-only project definitions can become portable, committed exports once their sources and declarations no longer depend on one machine's layout.

_Example:_ `member-service-expert` moves from `lfx-v2-member-service/local-agents/` to `lfx-v2-member-service/agents/`, in the same repository, names `lfx.local-review`'s source, and is listed in that repository's export index. Engineers with source access can discover and request preparation; launch still requires trust, credentials, configuration, store access and applicable enrollment readiness. No souls repository is needed for this.

**Onboard from any one repository**

LFX is reachable from whichever repository a person already has, with the access they already hold.

_Example:_ A contractor with read access to `lfx-v2-meeting-service` and `lfx-engineering-capabilities` prepares `meeting-service-expert` from a fresh laptop. They never learn the marketing repositories exist as more than an inaccessible name.

**Private by default — qualification target**
Intended outcome after provider setup and qualification, not a current promise.
_Example test:_ human A's `self-serve-expert-1` and `self-serve-ux-expert-2`
coordinate privately; ordinary wider-team members must not discover them or read
their private history without the corresponding grants.

**Souls that actually travel**

A soul published in one organisation runs in another, with the other's defaults and bindings.

_Example:_ `mcp-data-expert` is open-sourced with a public `mcp-knowledge` store. A second company runs it reading that store, harvesting into its own store, on its own aweb teams, with GitHub Issues instead of Jira. Same soul, no copied config.

**Forks stay out**

A copied backlink is not admission. Membership needs both directions at recorded revisions.

_Example:_ A personal fork of `lfx-engineering-experts` still says `workspace: linuxfoundation/lfx-workspace`. The workspace does not list the fork, so its souls are not LFX members and its packages are not catalogued.

**Teams move at their own pace**

Different instances hold different revisions of the same capability in the same deployment.

_Example:_ Platform pins `lfx.local-review@v4.1.0` for a release while self-serve follows `@main`. Both artifacts coexist; nobody is forced to upgrade mid-release.

**Nothing new to operate**

Git hosting is the control plane; CI validates indexes if wanted. No registry server, no discovery daemon.

_Example:_ Admitting `lfx-marketing-souls` is a PR to `lfx-workspace` adding one line to `members`, plus a backlink in the new repository. Branch protection is the review process.

**Knowledge without a detour**

A soul reads and grows its knowledge from its own declaration; the workspace is where you find out what stores exist.

_Example:_ with explicit provider, store access and write destination bindings, a standalone `lfx-self-serve` checkout reads store-qualified `lfx-review-conventions` and harvests into a resolved `self-serve-service` destination without workspace access. Missing inputs remain needs configuration.

**Honest readiness**

Each boundary is reported on its own: installed, trusted, configured, enrolled.

_Example:_ A prepared instance shows "needs configuration: Jira token", "approve: oats.jira a13d77" and "platform: enrolment pending" instead of launching and failing on first task.

_Where it stands_

## Baseline, accepted target, open gates

| Evidence boundary | What it establishes |
|---|---|
| Preexisting OATS package machinery | Git/local sources, package roots, closure/materialization, exact locks, integrity-bound trust and lifecycle composition; not the new two-authority resolver. |
| Baseline `428cd9af` Portable Souls foundation | `lib/capability-artifacts.mjs` retains/verifies A and B side by side with typed refusals; storage-only. Installer still overwrites `installed/<id>`, launch hooks reload by ID, scheduled operations resolve at execution. |
| Accepted infrastructure target, not completion | Source-complete declarations, reciprocal discovery, by-reference imports and retained sources, captured resolutions outside homes, preparation and consumer/store/lock/digest migration, honest CLI readiness. |
| Provider and later UI gates | Private/wider choices are recordable, not privacy guarantees. Named messaging owner qualification is pending; Desktop features follow infrastructure later. |

The [retention contract](2026-09-14-artifact-retention-contract.md) is binding. Before
core imports retention, shared tree-copy/digest/publication mechanics move into a
narrow leaf with no policy/lifecycle logic or back-import to core. Migration verifies
existing artifacts and grades records `reconstructed`, `partial` or `unknown` with
evidence. Overwritten historical revisions are not recovered by refetching moving
sources. Preserve running sessions; partial/unknown never passes readiness.

At consumer migration, the versioned digest covers file bytes, symlink targets and
regular-file executable flags normalized from owner execute, `(mode & 0o100) !== 0`,
for both Git and `path:`. Old digests remain verifiable without reinterpretation;
group/other execute and other mode bits stay outside identity. Do not rewrite modes.
Storage retention does not implement the digest bump or A/B lifecycle dispatch.

Retain source artifacts, capability artifacts and resolutions conservatively while
instances, jobs or supported recovery reference them. Dispatch/restart/retire/recovery
uses the captured record after source/home deletion, never an ambient lock. Recurring
schedules must state capture versus explicit future reprepare policy (capture remains
proposed); already queued work never advances silently. No scheduler is activated
by this documentation work.

### Remaining review gates

- Parser/schema syntax for `repo:`, imports/adoption, requires/defaults, store-qualified
  reads/owns and exports; lock/resolution/digest wire versions and migration mechanics.
  Accepted semantics do not mean every YAML illustration parses.
- Qualified repository identities and canonical remotes across renames/transfers;
  source moves need explicit provenance, never filename matching.
- Named messaging owner and qualification of private human/context identity, live
  discovery, inbound contact, history and administrator limitations. Standalone
  context keys and messaging-disabled workers remain explicit cases.
- Zero or one default provider per slot is a **v1 product simplification**, not a
  capability limit. Simultaneous Jira + GitHub is an unsolved design test; do not
  assume named bindings or build a generalized multi-provider solver.

Lead amendments are fully incorporated and preserved in a public design appendix.
Infrastructure implementation is now human-authorized; Desktop is later and held
capture patch `54b07ee` stays excluded.

_Falsification_

## How we would know it works

Accepted design and amendment scenarios, kept as tests rather than promises. Any failure prevents the corresponding acceptance claim; provider/live gates are not proven by docs or storage fixtures.

- A fresh operator prepares `self-serve-expert` without the author's private workspace config.
- Two operators with different local layouts discover the same accessible LFX definitions.
- Uncloned repositories are discoverable without installing their code.
- Forked or unadmitted repositories do not become LFX members.
- Inaccessible or stale indexes neither leak protected descriptions nor imply readiness.
- Same-repository packages work portably; external local paths are clearly marked nonportable.
- Multiple revisions of `lfx.local-review` coexist while each instance has one unambiguous composition.
- An update cannot replace a running instance's or a pending job's artifacts.
- Conflicting dependencies and missing bindings/approval fail before unsafe execution; source conflicts report both origins, including env-only executable surfaces.
- A soul reads and harvests store-qualified nodes with an explicit destination without workspace access; a replacement provider is not forced into OKF's node schema.
- A named messaging owner qualifies two humans' private/wider visibility, contact and history independently, without claiming isolation from administrators controlling host/service.
- Real multi-team membership, useful outputs and recovery work end to end, not just scaffolds.

### Lead's three scenarios, adopted

1. Import the same public soul unchanged into LFX and into a standalone deployment with no Git work target. It reads its public knowledge, binds an explicit adopter write destination, and prepares without consulting its publisher's workspace configuration. Source identity and exact retained revision are verified.
2. Two humans on two hosts each in one workspace. Each person's private team is reused across their hosts; a spawned child or scheduled instance stays inside it; one representative is widened and narrowed without changing its global identity; discovery, inbound contact and historical conversation access are verified separately.
3. An existing instance and an independent queued job stay on revision A; a new instance is prepared on approved revision B; the original source is removed; A still executes its managed lifecycle and recovery resources. No ambient shared "latest" lookup may substitute B.

---

_Sources: [accepted proposal](2026-09-14-portable-souls-and-git-workspaces.md),
[public amendment](2026-09-14-portable-souls-contract-amendments.md),
[binding handoff](2026-09-15-portable-souls-handoff.md),
[retention contract](2026-09-14-artifact-retention-contract.md) and
[implementation ledger](2026-09-15-portable-souls-implementation.md).
All LFX examples are hypothetical; all new YAML nesting needs parser review.
No ignored instance file is needed to interpret this design._
