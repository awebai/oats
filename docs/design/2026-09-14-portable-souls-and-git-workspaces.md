---
type: Decision
status: accepted-for-implementation
title: Portable souls and Git-backed organizational workspaces
description: Accepted Portable Souls architecture, reconciled with all lead amendments and the landed storage contract; syntax and provider qualification remain review gates.
timestamp: 2026-09-15
---

# Portable souls and Git-backed organizational workspaces

## 1. Status and purpose

**Accepted for infrastructure implementation, 2026-09-15.** Direct human
implementation/deployment authorization supersedes the earlier discussion-only
status, not the constraints. This document coherently incorporates the full
[lead amendment](2026-09-14-portable-souls-contract-amendments.md). Its substantive
text is retained verbatim there so acceptance depends on no private conversation
or ignored instance file. The [handoff's 15 decisions](2026-09-15-portable-souls-handoff.md#2-the-decisions-binding)
and the landed [retention contract](2026-09-14-artifact-retention-contract.md)
are binding. The [delivery plan and acceptance ledger](2026-09-15-portable-souls-implementation.md)
map each clause to verification.

Architecture acceptance is not final parser/schema approval, provider privacy
qualification, or a claim of shipped behavior. All YAML shapes are illustrative
and require parser review; accepted spelling and semantics are explicit below.
At baseline `428cd9af615652c4a93d754c1106674abd18545b`, only the storage
retention prerequisite is landed for Portable Souls. Desktop feature work is
**later**. The held capture patch `54b07ee` is excluded. This documentation pass
performs no live installation, activation, credential operation, scheduling,
model/GUI launch or session control.

The objective is an organization with many repositories, teams and expert souls,
where people can discover and prepare the appropriate experts without cloning the
whole organization or operating an additional OATS registry service.

> The soul declares what it needs and where it comes from.
> The workspace declares admission, defaults, knowledge stores, team references
> and catalogs.
> The local deployment resolves, installs, binds credentials and keeps state.

## 2. The problem this solves

Today, a committed soul can depend on capabilities selected through an uncommitted
parent workspace configuration. Cloning the soul's repository may not reveal where
those essential capabilities come from. A capability ID alone is insufficient
provenance. Absolute machine paths in soul definitions create another portability
failure.

Local directory-based discovery also assumes that people have similar checkouts
under the same parent folder. It cannot discover a repository that is not present
on the machine, and directory adjacency is not organizational admission.

We want portable requirements, remote organizational discovery and explicit local
setup instead of undocumented dependencies on the original operator's filesystem.

## 3. The model: related concepts, separate responsibilities

| Concept | Responsibility |
|---|---|
| Soul | Durable expert definition: role, procedural curriculum and capability requirements. Not a running process. |
| Instance | One incarnation of a soul, with its own home, task, effective composition and runtime identity. |
| Capability | Reusable runtime surface: skills, instructions, commands/hooks, helper agents and requirements. It may implement a fundamental layer. |
| Package | Acquisition/update unit exporting one or more capabilities, with contained payload and dependency declarations. |
| Source repository | Versioned home of soul definitions, packages or other project material. |
| Work target | Repository or directory an instance operates on; not necessarily the soul's source repository. |
| Workspace definition | Git-hosted organizational authority for admitted repositories, defaults, discovery sources and team references. |
| Local deployment | One operator's installed realization: local root, repository mappings, artifacts, locks, bindings, trust and state. |
| Team | A selected provider's communication/coordination membership boundary. |

One organizational workspace may have many teams and many local deployments.
One instance may belong to several teams. Source location, installation location,
work target and team membership must not be inferred from one another.

### Knowledge declarations and the provider-neutral envelope

All durable knowledge remains external to souls. A soul records knowledge
requirements using source-complete store locators or explicitly inherited bindings.
The workspace advertises stores and a default provider; the deployment resolves
locations and credentials. A resolved instance reads and harvests without fetching
the workspace definition again. Installing a soul does not transplant an upstream
owner registry.

The kernel captures effective non-secret provider configuration and binding
provenance with separate credential references. This envelope is provider-neutral:
a replacement knowledge capability exposes its own required configuration and
readiness through the capability contract, without being forced into OKF storage,
node ownership or internal authoring policy.

For the default provider (OKF), the conceptual declaration is:
- `reads`: entries with a store and node, not globally ambiguous short names.
- `owns`: entries with a node and optional destination. A missing destination
  inherits an **explicitly selected write binding**; if none is configured, report
  `needs configuration`. Every resolved node address includes its store.
- Fixed source requirements and rebindable store defaults must be distinguishable.

There is no one-store-per-soul invariant or newly imposed single-write-store limit.
Each resolved node has one explicit steward, each promoted concept an explicit
destination. Steward, proposing harvester and accepting maintainer are three
roles: multiple instances/deployments can propose without acquiring conflicting
ownership. Git knowledge delivery is a PR, public or private; a PR is not accepted
until merged. Reading public knowledge never authorizes publication of adopter
captures or notes. No new disclosure engine or per-agent ACL is implied.

## 4. Source-complete soul requirements

A soul declares its essential capabilities with enough information to acquire
them independently of a private upstream configuration.

Illustrative soul declaration as **pseudoconfiguration**, not current runnable
configuration (nesting requires parser/schema review):

```text
name: market-research-expert
requires:
  capabilities:
    example.market-research:
      source: git:github.com/example/marketing-capabilities@main#packages/research
  messaging: any
defaults:
  tasks:
    capability: example.tasks
    source: git:github.com/example/task-capabilities@main#packages/tasks
```

This identifies a capability, its source repository, a revision policy and the
selected package root. The package must actually export that capability ID.
The branch is a moving selector, not the installed artifact's identity.

Organization catalogs can offer convenient names during authoring. The resulting
portable requirement must retain resolvable provenance rather than depending only
on a catalog nickname available on one machine.

Supported sources can include:
- A package in an organization-wide capability repository.
- A package in a team-specific repository.
- A third-party package outside the organization.
- A package contained in the soul's own repository.
- An explicitly local development package.

Use `repo:packages/self-serve-dev` for a package at the **root of the soul's
source repository at its retained snapshot**. Nested `agents/<name>/` directories,
installation paths, caller cwd and work targets never change this base. `repo:`
paths must remain contained in that snapshot, including after symlink resolution.
Never use an ambiguous `./` source spelling in a portable soul declaration.
Explicit `path:` references are honestly nonportable development inputs. The
accepted `repo:` spelling is not yet a finalized parser/schema; containment and
source normalization must be reviewed together.

"Anywhere" means any supported transport delivering a valid package contract,
not arbitrary executable download instructions. A downloaded repository does not
become trusted merely because its files now have a local path.

Keep three states distinct:
1. Available in a catalog.
2. Selected or required by a soul.
3. Configured and authorized for use by an instance.

Catalog availability does not activate every capability. Install only the effective
requirements and their dependency closure, not the entire organization's catalog.

### Portability is not possession of credentials

A soul can carry the software needed to use a task service or knowledge store. It
cannot carry another operator's credentials, team enrollment or machine paths.
Those are deployment inputs. Missing required inputs produce an explicit
`needs configuration` result, not a falsely successful launch.

`requires` are constraints **every** successful composition satisfies; `defaults`
are fallback values among permitted choices, rebindable by an operator or import
entry. A generic `messaging: any` requirement can be satisfied by an adopter's
provider, but supplies no software, credentials or private team by itself. An
intrinsic implementation/source requirement cannot be erased by a default or
operator override. Conflicting requirements fail with both origins reported.
This is constraints plus fallback values, not competing configuration hierarchies.

### Importing an external soul by reference

An external import has four conceptual fields (syntax remains for parser review):

```yaml
imports:
  - source: git:github.com/example/public-experts
    soul: agents/research-expert
    revision: main
    alias: research
    adoption:
      teams: { experts: research-team }
      knowledge-destination: adopter-store
      tasks: example.tasks
```

The fields are canonical source repository, exported soul path, revision selector
and adopter-local alias. Adoption values above must resolve to explicit,
source-complete bindings; short labels alone do not satisfy a requirement.
Preparation retains the exact resolved source revision and **all source resources
the soul needs**. Upstream soul identity (repository plus exported path), exact
revision and local alias are distinct: changing an alias creates no new upstream
soul; advancing a selector does not itself create a new running instance identity.
Source moves need explicit provenance handling, never filename matching.

Imports are **by reference, never by copy** into an adopter-maintained definition.
The workspace may advertise an import without admitting its source repository or
requiring the publisher's backlink. Standalone prepare accepts the same reference;
private sources still require existing Git access. Persistent souls remain
persistent souls, not ephemeral capability helpers.

Import-entry adoption defaults are workspace-side, keyed to the **qualified
upstream identity/reference**, not its short alias. They can bind extension points,
map team aliases, choose default knowledge destinations and rebind providers, but
cannot replace hard requirements. A team map advertises a destination, not
enrollment. Explicit spawn choices may override adoption defaults within the same
bounds. No copy, fork or second policy hierarchy is needed.

## 5. Workspace membership through reciprocal Git declarations

A member repository's OATS config references the workspace repository by Git
remote. The workspace definition explicitly admits that member repository.

```text
member repository --declares membership in--> workspace repository
member repository <--admitted by------------- workspace repository
```

Neither declaration alone is enough. For an authenticated operator U:

```text
eligible(U, repository, workspace) =
  U can read workspace
  AND U can read repository
  AND workspace admits repository
  AND repository identifies workspace
```

This separates organizational admission from filesystem placement. It prevents a
fork with an inherited backlink from automatically joining the original workspace.
It also prevents an arbitrary sibling directory from becoming an organizational
member merely because it is nearby.

Use qualified repository/soul identities, not folder names or globally unique
short soul names. Canonicalize equivalent Git remote spellings and retain provider
repository identity where available. Renames, transfers and redirects must not
silently select a different authority. Observe declarations at recorded revisions.

Start with one workspace association per member repository. Multiple teams do not
require multiple workspace associations. More elaborate federation or multi-workspace
membership is a separate requirement, not implicit recursive config inheritance.

### Membership is different from consuming external sources

Using a public capability does not make its repository an organization member.
Similarly, a reusable public soul repository cannot backlink to every customer's
workspace.

An organization consumes a reviewed external soul through the by-reference import
in section 4, never by copying it into a member repository. That does not admit
the publisher. Local-only souls remain locally discoverable unless explicitly
published through an appropriate mechanism.

Reciprocal admission applies equally to project, experts, capabilities and
knowledge repositories; source consumption of a package, soul or public knowledge
store is never membership.

## 6. How discovery works without cloning everything

The workspace definition contains:
- Admitted member repositories.
- Default fundamental-layer selections and non-secret organizational settings.
- Knowledge stores and a default knowledge provider for discoverability.
- Named team references, including the private-per-human choice.
- Optional capability catalogs, package-index sources and external soul imports.

Member repositories publish small declarative export indexes naming their exported
souls and packages, descriptions and contained source paths. Exact field names and
manifest placement remain to be agreed. Package manifests remain authoritative for
the actual payload; catalogs only advertise sources.

From any associated repository, a client can:
1. Read its workspace reference.
2. Fetch the workspace definition using the operator's existing GitHub access.
3. Validate admission and relevant reciprocal backlinks.
4. Read accessible repositories' small export indexes.
5. Present qualified souls and capabilities without downloading all source trees.
6. Fetch the selected soul/package and prepare work targets only when needed.

Do not base this on recursive scans of every repository file, global code search,
or executing repository scripts during discovery. Descriptors are data, not agent
instructions. Validate schema, containment and resource limits before using them.

At scale, cache per observed revision and authorization context, refresh changed
indexes incrementally, and respect pagination, bounded concurrency and rate limits.
Show inaccessible, unavailable or stale sources honestly. GitHub may intentionally
not distinguish a hidden private repository from a nonexistent one.

Start with client-side aggregation. A generated aggregate index is optional later;
it must not broaden access to private descriptions merely to save requests.
No metadata refresh silently updates already installed or running instances.

## 7. Access control: use GitHub, without overstating its guarantees

GitHub supplies authentication and repository-content authorization. Workspace
membership supplies organizational admission. Neither needs a second OATS user or
repository-permission database.

Read access permits discovery of accessible definitions. It does not grant write
access to source repositories, approval to execute arbitrary hooks, membership in
a messaging team, or access to cloud services. Those remain their respective
systems' authority.

Important limits:
- A readable workspace allowlist can reveal private repository names/URLs even if
  the reader cannot open those repositories.
- A broadly readable aggregate index must not copy protected soul descriptions.
- Cached metadata must not be shared indiscriminately between authorization contexts.
- Revoking access cannot erase files someone already cloned or information learned.
- Offline cached information is last-known state, not proof of current membership.

Use native GitHub repository permissions, reviews and branch protection rather
than inventing an organization-wide OATS ACL engine. Choose metadata visibility
intentionally and revalidate remote operations. Do not promise stronger secrecy
or revocation than the underlying platform can provide.

## 8. Decentralized operation without another hosted control plane

Authority and authorship are distributed across ordinary Git repositories:
- Soul maintainers own their definitions.
- Capability maintainers own their packages.
- Workspace maintainers own organizational admission and defaults.
- Operators own local deployments and their credentials.

The organization needs no OATS-operated registry server, custom package registry,
central discovery database, or always-running discovery daemon. Existing Git hosting
and optional hosted CI can store, review and validate these declarations. A workspace
repository is a logical coordination point, not a new service to operate.

GitHub is the first discovery/access adapter. The model uses Git source references
and should not require every package or future deployment to be GitHub-hosted.

This is not a claim that the whole agent system is literally server-free. Instances
still execute on machines; model APIs and selected messaging/task providers may be
hosted services. Unattended work needs an available execution host. The benefit is
that organizational discovery and package distribution add no new hosted OATS
infrastructure requirement.

Git discovery finds definitions. Live presence, contact routes and remote execution
authority remain with messaging/execution providers. Do not put heartbeats or
continuously changing instance state into Git.

## 9. Flexible placement, strong conventions

An organization may choose:

```text
workspace-definition repository
  admits engineering, marketing and project repositories
  advertises capability catalog sources
  defines default layers and team references

engineering-capabilities repository
  several independently maintained package roots

marketing-capabilities repository
  research, publishing and campaign packages

marketing-souls repository
  market-research-expert and content-strategy-expert

individual project repository
  its own experts and project-local capability packages
```

Souls live in project repositories **first**, conventionally `agents/<name>/`, as
many as the project needs. A separate experts repository is for expertise spanning
repositories, not a compulsory central soul store. Name souls for expertise, not
job titles. This is an example topology, not a required hierarchy. One repository
may contain many packages; unrelated sources remain valid under the same contract.
Do not distribute every organizational capability as one inseparable package unless
that really is the intended update unit.

OATS should provide conventional locations, templates, manifests, validators and
onboarding skills. The current Git package-root default is `oats-package/`; explicit
package paths remain supported. Keep canonical AGENTS.md with its CLAUDE.md alias,
complete skill/reference closure, and contained package resources.

Conventions make common cases easy. Explicit validated references make other
arrangements possible. An onboarding expert should understand the details so users
can ask for outcomes rather than learn the directory conventions themselves.

## 10. What installation does, and where it happens

Reuse the existing OATS package engine. A capability installation materializes its
manifest, skills/reference/script closure, injections, declared commands/hooks,
helper agents and supported locked runtime dependencies. External host requirements
are checked separately. Acquisition is not activation or executable approval.

Select an explicit local deployment scope:
1. An already selected local workspace deployment, when present.
2. Otherwise the standalone repository/soul scope.
3. With no repository, an isolated deployment under user application data.

A remote workspace locator is not a local path. Following it must not clone every
member repo, create arbitrary parent directories or install machine-wide tools.
Do not mix capability storage with an application's ordinary Node node_modules.
A machine-wide download cache is optional optimization, not activation or authority.

The baseline installer still replaces one flat `installed/<id>` artifact per
capability per scope. The landed retention primitive additionally supports:

```text
<deployment>/.agents/capabilities/artifacts/<capability-id>/sha256-<full digest>/
```

It verifies bytes and provenance, publishes immutable A/B trees side by side,
and neither selects nor approves them. The [retention contract](2026-09-14-artifact-retention-contract.md)
owns its typed refusals and containment rules. Missing artifacts differ from
invalid shape/store or integrity drift; damaged retained entries are never
silently repaired. Publication uses same-filesystem staging/rename; it is not a
hostile-host or power-loss guarantee.

The accepted integration stores soul source artifacts **separately** under the
explicit deployment, keyed by qualified source identity plus digest, with the same
typed refusal/no-repair semantics. Retain the full required source closure, not
just `soul.yaml` or a link to an author's checkout. Exact new wire versions and
paths need schema review.

A versioned **captured resolution**, stored outside instance homes, is the authority
for each instance and independent execution. The deployment lock records **current
choices for new preparation**, not an ambient authority for earlier work. Capture
source identity/revision/alias; one artifact per capability ID and verification
provenance; helpers, commands/hooks and managed runtime resources; non-secret
configuration and per-choice provenance retaining hard constraints; provider-owned
bindings with separate credential references; responsible human/private context
key and wider-team choices. These last fields record choices, not fixed live
membership or permission to read past conversations.

Preparation resolves once per transaction, validates/fetches/materializes the
closure, publishes every required artifact, then commits a complete resolution
**before launch**. A failed preparation may leave valid unreferenced artifacts,
but never a selectable partial resolution. Report installed / trusted / configured /
enrolled separately and `needs configuration` for missing inputs. Neither
acquisition nor artifact presence grants trust, activation or membership.

Before core consumers import retention, extract tree-copy/digest/publication
mechanics into a narrow **leaf** module; no dependency back into `core.mjs`, no
policy or lifecycle logic. Then follow the retention contract's five consumer
migration steps: explicit schema/store migration; acquisition/preparation wiring;
new instance and queued-work capture; evidence-based old-record migration;
removal of mutable-store lookups and reference-aware diagnostics/removal. This is
one coordinated migration, not a permanent parallel resolver/store model.

Existing records report `reconstructed`, `partial` or `unknown`, with evidence and
unresolved inputs. Partial/unknown cannot pass as complete in CLI or later Desktop
readiness. Verify old artifacts before retaining; never refetch a moving source
and claim to recover an overwritten revision. Preserve running sessions and let
owners choose restart boundaries.

At that consumer-migration boundary, introduce a **versioned digest** covering file
bytes, symlink targets and each regular file's executable flag normalized from
owner execute, `(mode & 0o100) !== 0`, identically for Git and `path:` sources. Old
digests remain explicitly verifiable and are never reinterpreted as mode-aware.
Group/other execute and other mode bits stay outside identity. Do not rewrite
modes during retention or infer entrypoints from free-form command strings. The
landed primitive still uses the old bytes/symlink digest; the format bump is not
claimed implemented.

Provider state and accepted knowledge remain outside replaceable software artifacts.
Remote persistent-soul acquisition preserves persistent-soul semantics; package
transport does not make it an ephemeral helper. A standalone repository or a
non-Git user-data deployment uses the same APIs, with no fake workspace required.

## 11. Versions and explicit freshness

People should not have to select numbered versions routinely. Machines still need
exact revisions to reproduce behavior and retire or recover instances safely.
Current package manifests require numeric versions; this proposal does not silently
remove that schema field or compatibility checks.

A soul can track a defined branch/release channel or explicitly pin a revision.
Resolve the policy once during preparation into an immutable full composition:
source soul revision, workspace/default inputs, capability dependency closure,
artifact identities and relevant non-secret binding provenance. Keep secrets out
of shared locks and Git metadata.

Observe a source/ref consistently within one resolution transaction. Do not advance
it halfway through assembling an instance.

Accepted v1 freshness:
- Refresh the chosen channel on **explicit prepare or update**, once per transaction.
- Show an available-unapproved revision beside the last-approved usable revision;
  never call the latter "latest". No discovery daemon or unattended trust service.
- New instances may use a newly approved compatible resolution after that refresh.
- Declarative skill changes are behavior-bearing and get a bounded visible change
  notice, but do not gain an executable-approval gate.
- Existing instances and durable jobs keep their captured artifacts.
- Explicit upgrades create a new validated composition, with state-migration checks.
- Offline use is visibly last-known/approved, not claimed to be latest.
- A failed required update is visible, not a falsely successful refresh.

Different instances can select different revisions in the same workspace:

```text
artifact A <- existing marketing instance
artifact B <- new marketing instance and another compatible instance
```

Identical artifacts are shared; distinct artifacts coexist. Exactly one artifact
per capability ID is selected inside an individual instance. If one dependency
closure requires conflicting artifacts for the same capability/command identity,
report both requirement paths and fail until reconciled. Do not load both under
one namespace or arbitrarily choose the newest. No general semver solver initially.

Retain artifacts referenced by live instances, rollback or pending independent jobs,
including retirement/recovery code needed after source deletion. Garbage collection
must be reference-aware; conservative retention is preferable initially.

Downloading during explicit preparation is not automatic trust. **Executable means
commands, hooks or environment (`env`)**; any changed executable artifact requires
fresh approval at its exact integrity/revision. Publisher continuity or `latest`
grants nothing. V1 has **no unattended approval**; any future bounded policy needs
a separate product decision, not an implementation shortcut. Unchanged artifacts
need not be replaced merely because unrelated repository content changed.

All lifecycle dispatch, restart, retirement, recovery and independent queued work
use the captured resolution, never a newly read ambient lock/config. Retain source
trees and resolutions as well as capability artifacts while referenced, including
workers whose source has been deleted. Recurring schedules must state whether they
capture composition or explicitly prepare on a later tick; capture is the proposed
default pending policy review. Already queued executions never silently advance.
No scheduler is activated by this design work.

Immutability covers **OATS-managed software composition only**: not knowledge
contents, credentials, live team memberships, the work repository, external services
or host tools. Authorized credential rotation and membership changes do not upgrade
software.

Software rollback does not reverse external writes or database/knowledge schema
migrations. Concurrent revisions sharing external state need provider compatibility.
A security incident may require explicitly stopping or migrating an instance, not
quietly overwriting the artifact underneath it.

> Sources may move. Installed artifacts do not. Instances retain exact compositions.

## 12. Defaults, teams and identities

### Two authorities, one resolver

Policy consists of workspace defaults and soul declarations. The workspace fills
choices the soul leaves open; soul `requires` constrain all choices and `defaults`
are fallbacks. Explicit operator choice (import-entry adoption defaults or spawn
choice) may rebind defaults and bindings, never erase requirements. Import adoption
is workspace-side configuration, not a third tier. Conflicts report both origins.
There is **no repository capability-default tier and no agent-types/family entity**.

Repository briefing (`agents-md-injection`) and worktree setup remain **work-target
behavior**, selected from the repository actually worked on, not an imported soul's
source repository. Applicable executable trust still applies. Directory work targets
remain valid with no invented Git repository or organizational membership.

An instance selects exactly one workspace context. Its imported soul's original
organization contributes no second policy authority. Without a workspace, use
explicit standalone bindings for unresolved requirements; `messaging: any` supplies
neither a provider nor credentials nor a private team. Report missing bindings,
not an unnamed implicit product default.

### Private-first choices, not a qualified privacy guarantee

For messaging-enabled instances, the private team is keyed by a **provider-resolvable
human identity plus qualified workspace identity**, reused across that person's
machines. OS usernames, checkout paths and agent aliases are insufficient. Child
and scheduled instances inherit their responsible human. Messaging-disabled workers
need no team. Standalone deployments require an explicit context key instead of a
nonexistent workspace identity.

Wider teams the soul lists are opt-in **per instance**. An explicit wider set
replaces wider defaults but retains the private floor. Team-alias mappings only
advertise destinations; provider prerequisites and actual enrollment remain separate.
A global instance identity holds multiple provider membership credentials and
survives joining/leaving teams. Process, session and local deployment-record IDs
are not global instance identities; team-qualified aliases are addresses, not
replacement identity keys. Distinct incarnations of one soul are not automatically
the same standing identity.

**Catalog visibility, live-instance visibility, contact permission and conversation-
history access are four separate grants.** Joining a wider team must not expose
earlier private conversations or other private instances. These are intended
boundaries, **not product privacy guarantees until a named messaging owner qualifies
the provider behavior**. Ordinary members and administrators controlling a host or
service are distinct access contexts; do not claim protection from administrators
merely because team membership is private. Until qualification, capture private
keys/contexts and wider-team references as choices only; do not certify enrollment
or privacy on their presence.

### One default provider per slot is a v1 simplification

Fundamental slots are knowledge, messaging and tasks. **Zero or one default
provider per slot** is the v1 product simplification, not a universal capability
limitation. Simultaneous Jira + GitHub is an explicit unsolved design test: can one
default task interface coexist with another service integration, or does the task
contract need named bindings? Do not call it solved or build a generalized
multi-provider solver before that review.

## 13. User experience and implementation boundary

A user should be able to say: "Prepare the marketing experts for this organization."
The onboarding expert discovers accessible definitions, proposes the appropriate
souls, fetches only needed sources, installs capabilities, resolves missing bindings,
joins authorized teams and verifies a useful first task and its consumed output.

The user should not need to understand package paths or artifact hashes. The result
must nevertheless be inspectable through ordinary files, CLI and GUI diagnostics,
without the setup expert or its original conversation remaining alive.

Available before Portable Souls (OATS 0.23.1 machinery, preserved at the baseline):
- Git/local package sources, selected package roots and dependency closure handling.
- Capability materialization, exact locks, integrity checks and executable trust.
- Scoped configuration, instance composition and lifecycle/provider boundaries.

Landed at `428cd9af`: capability artifact retention only, with the binding contract.
The installer, lock and runtime consumers are not migrated by that foundation.

Accepted infrastructure additions/changes, NOT claimed implemented here:
- Source-complete intrinsic capability requirements in portable soul declarations.
- Git-hosted logical workspace association and reciprocal remote membership.
- Remote exported-soul/package discovery and persistent-source preparation.
- Multiple immutable revisions per deployment and per-instance resolution references.
- The associated lock migration, default-resolution and update-policy integration.
- Private-team choices and honest CLI readiness; actual messaging privacy requires
  provider qualification. Desktop feature/UX implementation comes later.

Preserve working machinery. Do not replace the scheduler, create another IAM system,
or introduce general federation/version-solving just to implement this proposal.

## 14. Delivery and acceptance

Follow the dependency-ordered [implementation plan](2026-09-15-portable-souls-implementation.md),
not the historical order of discussions. First reconcile these docs and extract
the acyclic storage helpers; then versioned resolution/source retention and schema;
then declarations, reciprocal discovery/import and preparation; then coordinated
consumer/digest migration and CLI diagnostics. Messaging behavior is gated by a
named owner and qualification. Desktop feature work is later.

Acceptance must demonstrate (not just scaffold):
- A fresh operator prepares without the author's private workspace config.
- Two layouts discover the same accessible definitions, including uncloned repos,
  without installing discovery sources or running their scripts.
- Forked/unadmitted repos stay out for every member kind; source consumption is
  not admission. Inaccessible/stale indexes neither leak protected descriptions
  nor imply readiness.
- `repo:` resolves at the retained repository root, including nested souls;
  escaping/broken symlinks fail and `path:` is visibly nonportable.
- Constraints beat defaults, source conflicts report both paths, and missing
  bindings/approval fail before unsafe execution. `env` alone needs approval.
- Store-qualified nodes are unambiguous across stores; promotion has one explicit
  destination and steward. Other providers use their own configuration/readiness
  model. Public reads never silently become publication.
- Multiple artifacts coexist, each instance selects one per ID, and the complete
  captured managed composition survives source/home deletion without ambient
  substitution. Historical migration evidence is honestly graded.
- Explicit refresh shows last-approved and available-unapproved separately;
  failures/offline views never claim latest, and declarative changes remain visible.

Three mandatory falsification scenarios from the accepted amendment:
1. **Portable adoption:** import the same public soul unchanged into an organization
   and a standalone no-Git work target. Read public knowledge, bind an explicit
   adopter write destination, and prepare without publisher workspace access.
   Verify canonical source identity and exact retained revision; no copy or false
   membership. Missing bindings report incomplete readiness.
2. **Private-first qualification:** two humans, two hosts each, one workspace.
   Reuse each private team across hosts; a child or scheduled instance inherits
   its human. Widen/narrow one representative without changing global identity or
   silently changing knowledge bindings. Verify catalog/live discovery, inbound
   contact and historical access separately, including other private instances
   and administrator limitations. Requires a named messaging owner; not yet passed.
3. **A/B dispatch:** old instance and independent queued job retain A while a new
   instance prepares approved B. Remove original source and prove A still executes
   its managed lifecycle/recovery resources; the current lock must not substitute
   B. Storage-only A/B execution is not this end-to-end proof.

Useful outputs, accepted knowledge and fresh-reader visibility are separate from
process launch or a delivered PR. Operational/live gates need their own evidence;
this documentation update supplies none.

## 15. Remaining review gates, not reopened decisions

- Parser/schema syntax for `repo:`, requires/defaults, store-qualified reads/owns,
  imports/adoption and exports; wire versions for lock/resolution/digest and the
  migration detail. Semantics are accepted; illustrative YAML is not a parser API.
- Canonical remote handling across renames/transfers and qualified identity format;
  source moves require explicit provenance, not silent identity substitution.
- Named messaging owner and qualification of private-team identity, discovery,
  contact/history boundaries and enrollment UX. No privacy claim before this gate.
- Simultaneous Jira + GitHub test; no speculative multi-provider solver.
- Recurring-schedule capture versus explicit reprepare policy wording; already
  queued work always retains its resolution. Unattended approval is not in v1.

Resolve ambiguity with the human/contract reviewers before inventing semantics.
Human authorization now permits infrastructure implementation under these bounds;
it does not authorize integrating the held capture patch or bringing Desktop
feature work forward.

## Current implementation references

These provide baseline context, not proof that this proposal is implemented:
- Package engine (`package-engine-contract.md`, removed in 0.26)
- Package runtime API (`package-runtime-api.md`, removed in 0.26)
- [Configuration](../configuration.md)
- [Souls and instances](../souls-and-instances.md)
- [Multi-team/deployment proposal](2026-09-08-expert-assisted-deployment-proposal.md)
- [Execution targets](../execution-targets.md)
