# Expert-assisted deployment and an extensible OATS

Date: 2026-09-08

Status: proposed implementation plan; direction endorsed by Juan on September 8.
This document records the proposal and a takeover plan while Juan is away for
a couple of days. It does not claim that the proposed deployment workflow has
shipped. Current-state observations below are against main `daf2941`, following
the publication of OATS 0.22.19. The September 8 follow-up incorporates Pepe's
team-assignment and shared-knowledge requirements and Juan's explicit
correction: one instance may belong to several teams, and OATS must support
both local and global identities. The initial handoff understated these
requirements; the sections below are part of the implementation scope.

## Outcome

A user should be able to ask an OATS expert to add an agent to an existing team
on another machine. The expert prepares or adopts the necessary workspace,
configures the selected capabilities, starts the agent, and verifies that the
result works. The resulting configuration and procedures belong to the user
and remain usable by another agent, the CLI, and the GUI.

A workspace can refer to several communication teams. An instance can have
several memberships through one global identity. Its knowledge access and
promotion destinations are selected explicitly, including shared organizational
knowledge. A remote launch is not complete merely because a process starts in
the correct directory.

This makes the expert the normal conversational way to configure and extend
OATS. Reliable commands perform repeatable operations; skills teach the expert
how to choose and combine them. A working installation must remain operable
without the expert running or the original setup conversation being available.

The architecture principle is already in the
[September 3 proposal](../2026-09-03-architecture-proposal.md):

> Contracts and bootstrap skills in OATS; implementations in packages.

This plan applies that principle to deployment. It continues the
[September 7 reassessment](2026-09-07-architecture-reassessment.md), whose
provider-operation gaps were subsequently addressed by the
[operations contract](operations-contract.md). It does not reopen those fixes
or require the entire September 3 proposal to be implemented first.

## Current state and the missing boundary

| Area | Implemented today | Remaining gap |
|---|---|---|
| Knowledge, messaging, tasks | Selectable packages, scoped bindings, inspection and declared provider operations | Maintain these boundaries as deployment and onboarding are added |
| Harness launch | Pi, Claude and Codex; named launch configurations; instance start/restart | A new harness is still a kernel implementation change, not an arbitrary installable runtime provider |
| Terminal execution | tmux and Herdr behind session operations | These backends do not prepare the team's repositories or capabilities |
| Remote execution | Route operations over SSH to OATS in a registered remote workspace | The remote workspace must already exist and be usable |
| Soul and work location | Filesystem souls and built-in worktree, checkout, attached and workspace modes | The proposed independent soul-store and work-target contracts are incomplete |
| Expert onboarding | An `oats-expert` soul and a workspace setup playbook | A complete, maintained installation workflow with repeatable remote preparation |
| Communication membership | OATS resolves one effective `team:`; its normal aweb spawn joins that team | Workspace team catalog and explicit per-type/per-soul membership sets, including several memberships for one instance |
| Identity lifecycle | Normal aweb join defaults to local; OATS also has an explicit retained-identity path used for standing global identities | A complete local/global selection, creation/adoption, multi-team binding and lifecycle experience |
| Shared knowledge | OKF instance state and promotion into the source soul's knowledge/skills | Configurable shared collections, scoped reads and promotion to the appropriate shared destination |

In the current spawn path, a referenced repository must already exist and be
a Git repository. Worktree mode creates a worktree from that repository;
checkout mode uses the existing checkout. Neither is an initial clone or an
implicit repository update. The worktree setup command runs after creation;
its failure currently warns and continues. Capability spawn hooks also run
after the repository has been resolved. None of these is a suitable substitute
for preparing a missing remote workspace.

The existing [expert soul](../../agents/oats-expert/soul/AGENTS.md) mixes
portable installation advice with maintaining this repository and reviewing
our development team's PRs. It also contains provider-specific knowledge
instructions. Split those responsibilities: users need an installation expert
that understands their selected capabilities, while this project's maintainer
keeps its own development role and operating instructions.

## Responsibilities

| Mechanism | Responsibility | Examples |
|---|---|---|
| OATS kernel | Configuration resolution, package composition, instance lifecycle, session routing and scheduling; inspectable results | Resolve an instance's captured configuration, start it on its execution host, expose its state |
| Deployment capability package | Repeatable preparation and diagnosis, using existing OATS operations and host tools | Inspect a workspace, adopt or clone a repository, check requirements, report readiness |
| Setup/repair skill | Workflow, choices, diagnosis and adaptation to the user's environment | Choose paths, understand existing repositories, select capabilities, explain and repair a failed prerequisite |
| Lifecycle hook | A bounded extension at a known lifecycle event | Configure an identity during spawn; perform worktree-local environment setup |
| Installation expert | Apply the skill, invoke operations, verify outcomes and record deployment decisions | Fulfil a request to add an agent on another host |
| GUI | Present the same configuration, choices, actions and observations | Show where an agent works and explain why a deployment is not ready |

Begin with an ordinary capability package containing namespaced commands,
skills and documentation. Existing general capabilities compose additively;
deployment does not need to become a fourth mandatory knowledge/messaging/tasks
layer. The current `operation run` contract addresses those layers: do not
pretend it already supplies an arbitrary deployment-provider interface. Extend
discovery or invocation only as required by the first real consumer.

Preparation commands should expose observed state and repeatable effects.
Running them again against a correctly prepared workspace should reuse that
workspace. A failure should identify what succeeded, what remains and how to
continue. A small inspect/prepare interface is sufficient initially; its exact
command names and schema are implementation decisions, not APIs promised here.

Extract a work-target interface when the existing Git/filesystem coupling
prevents the required flow. Keep Git preparation in its implementation package
and have the kernel consume the resulting work location and lifecycle contract.
Do not turn the first remote onboarding into a general infrastructure engine,
workflow language or registry for every hypothetical backend.

## Team, host, deployment and work target

Keep these concepts separate in configuration and the user experience:

- **Workspace:** the OATS configuration boundary containing souls, deployment
  choices and references to one or several communication teams. This is not
  identical to an aweb workspace, which binds an identity home and its
  membership-specific coordination state.
- **Communication team:** a provider's membership and coordination boundary.
  With aweb, membership is certified by that team's authority. One OATS
  workspace may use several such teams; one instance may join several.
- **Host:** a machine reachable through the selected execution transport.
- **Deployment:** a workspace's installed configuration, packages and locations
  on a particular host. One host may contain several deployments, and one
  deployment may serve instances with different or overlapping team memberships.
- **Soul:** the reusable instructions and capabilities from which an instance
  is composed; its source need not be the repository the instance works on.
- **Work target:** the repository, directory or other resource an instance
  operates on. The proposed broader contract is not fully implemented today.
- **Instance home:** the durable local state and recorded configuration for
  one instance on its execution host.

A server registration currently bundles an SSH host and one workspace path.
Retain working routes while improving how deployments are represented; a
second team on the same computer should not conceptually become a second
computer. Registering a server alone neither copies local souls nor establishes
remote team membership.

The current `team:` block combines an OATS discovery/configuration boundary
with a messaging team selection. Do not extend that shortcut into a requirement
that every instance in a workspace belongs to exactly one common aweb team.
Separate those meanings as this feature is implemented. A default team may
remain a convenience; it is not the complete membership list.

For example, `/srv/example-team` could be an explicitly selected remote
workspace. Its repository mappings and agents root determine where individual
homes and worktrees are created. That path is an example, not a new default or
a claim about an existing installation. The selected harness does not choose
the workspace location.

## Identity and membership: verified aweb contract

These are aweb's existing concepts, not a new OATS identity protocol:

| Property | Local identity | Global identity |
|---|---|---|
| Identifier | `did:key` | Stable `did:aw` plus current `did:key` |
| Team memberships | Exactly one team | May hold several team certificates |
| Public address | None | May hold zero, one or several addresses |
| Runtime duration | May survive sequential sessions | May survive sequential sessions and preserve global trust continuity |
| Joining another team | Does not reuse the same local identity | Reuses the existing global identity; does not mint another `did:aw` |

Use `identity_scope: local|global` when referring to aweb's current contract.
The older `lifetime: ephemeral|persistent` vocabulary is read-compatibility
input. In particular, local does not mean expires on process exit: certificates
have no expiry field, and deleting a directory does not itself revoke them.
Local also does not mean on this computer, and global does not mean hosted.

One global identity represents one principal. Its memberships and addresses
are different handles/authorities for that principal, not separate agents.
Several instances of the same soul do not automatically share an identity.
Ordinary independent workers need independent identities; an explicit move or
restart of the same standing agent preserves its identity.

Aweb already stores multiple memberships in `.aw/teams.yaml` and per-team
coordination bindings in `.aw/workspace.yaml`, with one `active_team` default.
Switching the default neither joins nor leaves any team. Supported commands can
select a team for one operation without changing that default. The selected
team determines the certificate, member name and coordination context; an
instance's memberships are not merged into one undifferentiated authority.

The current CLI's global invite acceptance reuses an existing self-custodial
global identity. It refuses to manufacture one as a side effect of `--global`.
Creating a global identity/address requires the relevant namespace authority;
team membership alone cannot provide that authority. Hosted and locally
controlled team setup differ, so the deployment skill must inspect the actual
authority and follow the supported create/join/fetch/connect path.

Global addresses enable first contact. A local identity can send to a global
address and receive a reply through the authenticated learned return route; it
does not thereby acquire a global address. Cross-team messaging alone does not
require joining the recipient's team. Membership is needed for that team's
coordination and other membership-scoped resources.

### What OATS already does, and what it does not

The current `oats.aweb` adapter's normal spawn path resolves one team, obtains
an invite and joins with the instance name. It does not offer a general
membership list or explicit new-global-identity workflow. The retained path
(`settings.identity.source`) preserves existing identity material, reconnects
one selected team and records retained custody; retirement releases the seat
without deleting that identity. This is useful existing support for standing
global agents, but it is not a complete multi-team onboarding contract.

Retaining files containing several certificates is not proof that every team's
coordination binding, command context and wake delivery works in the new home.
Qualify those behaviors explicitly. Do not generalize the retained migration
path's file-copy details into the permanent public identity-management API;
use aweb's supported identity-home and lifecycle operations where available.

Refresh the shipped instructions as part of this work. The current vendored
[membership skill](../../capabilities/oats-aweb/skills/aweb-team-membership/SKILL.md),
Hosted Path 3, still says `--address` creates a fresh global identity. The
verified current CLI instead requires explicit `--global` and an existing
self-custodial global identity. Its multi-membership explanation also needs the
global-only qualification. Update and publish the provider skill from its
owning source, then verify the materialized instructions; the stale recipe must
not become the installation expert's onboarding procedure.

## Proposed workspace membership behavior

Use the existing scoped capability configuration mechanism. The following are
semantic requirements; final YAML keys and commands still need implementation
review and must not be copied as a currently supported schema.

- The workspace declares named references to available messaging teams and the
  information needed to connect to them. This is a catalog, not automatic
  enrollment of every agent into every listed team.
- Workspace defaults, soul-type bindings and individual-soul overrides resolve
  an explicit membership set and identity choice. A more specific membership
  list replaces the inherited list; do not silently union it and retain an
  unwanted broader membership. Show provenance before creating the instance.
- Support a new local identity for a single-team worker, creation of a distinct
  global identity through an available authority, and adoption of an existing
  global identity. A request for several memberships requires global scope;
  report the incompatibility before mutation rather than silently changing
  identity scope or creating one identity per team.
- Keep concrete identity references, team IDs and namespace/address choices in
  deployment configuration. A portable developer soul can request suitable
  capabilities without carrying one organization's credentials or team IDs.
- Resolve the membership set into the instance's recorded configuration. Start
  and restart preserve it. Joining or leaving a team is an explicit lifecycle
  operation; editing defaults must not silently change existing memberships.
- Use an explicit team selector for team-scoped operations. Generated briefings
  describe all memberships and the default, and teach the agent how to select
  the appropriate team. Do not concatenate conflicting teams' instructions and
  assume the currently active team resolves the conflict.

For example, one coordinator instance can use a global identity that belongs
to Engineering and Release, selecting either context for the relevant work.
A short-lived test worker can use a local identity in Engineering only. Another
instance of the same developer soul can use a different identity and different
memberships. None of these choices depends on which host runs the harness.

The GUI should show one instance with several membership badges, its identity
scope, and its default team. Filtering/grouping by a team must not turn that
one instance into several independent agents. Preview creation/adoption and
membership choices together, and expose per-membership readiness and problems.

Incoming work must reach a multi-team instance without requiring the user to
switch its active team first. Reuse aweb's identity/event mechanisms; determine
the actual service/subscription coverage and share streams where supported.
Do not create a GUI stream or model worker per team as the default design.
Delivery across all configured memberships, with the GUI closed, is a required
qualification; this document does not claim the current broker has passed it.
The inspected `wakeStreamOpener` constructs its client through the selected
membership's certificate-backed context. That code alone does not establish
aggregation across every membership or service; verify the server event scope
and the broker's behavior together before choosing subscription coverage.

### Membership, reach and visibility are separate

Pepe's shared-engineering versus owner-only requirement has both a membership
choice and a communication/visibility policy. A team badge or instructions in
`AGENTS.md` cannot enforce that policy. Aweb currently documents inbound modes
`open` and `team_and_contacts`; the latter admits verified same-team senders as
well as contacts. It does not mean owner-only inside a shared team.

The September 3 `reach: owner|team|org|external` ladder and `contacts_only`
mapping are proposals, not current aweb API promises. Select distinct teams
where their actual semantics meet the need, or implement the required policy
in aweb and qualify it. Do not reinstate removed address-visibility fields or
introduce OATS-specific routing enforcement. Public address discoverability,
message admission and access to team work/knowledge each need their own
accurate explanation.

There is a concrete compatibility trap: the current CLI accepts the old
`contacts-only`/`contacts_only` spelling but normalizes it to
`team_and_contacts`. An accepted command is therefore not evidence of strict
contacts-only enforcement. Do not use that spelling to implement `reach: owner`.

### Lifecycle outcomes

Stopping a harness, restarting it, retiring an OATS home, leaving a team, and
archiving a global identity are different operations. Preserve identity and
memberships across stop/start or a harness change. For disposable local workers,
use aweb's supported self-retirement and report whether the certificate was
revoked and the member name released; do not infer it from local deletion.

For global agents, retiring the execution home must preserve recoverable
identity authority and must not implicitly archive the identity or revoke all
memberships. Define custody before home removal, especially for a global
identity created there rather than adopted from a retained source. Leaving one
team must preserve the identity and remaining memberships. Moving hosts must
re-establish and verify each required binding without leaving two independent
workers using the same identity.

If preparing several memberships fails partway through, report the memberships
actually established and offer a repeatable resume/cleanup path. Do not delete
an adopted identity or its pre-existing memberships to undo this attempt.

## Shared knowledge and promotion destinations

The current OKF implementation promotes instance notes or captured record
windows into the source soul's knowledge/skills. Workspace-mode harvesting
changes how a soul update is delivered; it does not turn the workspace into a
shared organizational knowledge destination. Existing shared KBs connected by
instructions are useful deployments, not proof of this missing capability API.

Keep three concerns explicit:

| Knowledge | Custody and purpose |
|---|---|
| Instance state | Current task, progress and pending observations in the instance's context |
| Reusable soul knowledge | General expertise and procedures that should travel with that soul |
| Deployment knowledge | Organization, team or project decisions and procedures shared with appropriate instances |

The knowledge capability should resolve an instance's readable collections and
permitted promotion destinations from deployment policy and soul/type bindings.
These are sets: an instance in several teams may need several knowledge
collections. Team membership does not automatically authorize every collection
or copying material between them. The knowledge provider owns access and
storage semantics; OATS resolves the configured capability and exposes its
effective choices and operations.

Start with a shared versioned OKF repository or existing bundle where suitable.
Specify its canonical location, collection references, read/update mechanism
on each host, and how a promoted change becomes visible to readers. "Shared"
requires a coherent source and an actual refresh path; a one-time copied folder
on each server is insufficient. A database or central knowledge service is
optional and belongs to the provider, not the kernel.

The harvester selects a destination under that policy. A general debugging
lesson may belong to the reusable soul; a private project decision belongs to
the project's collection. Several team memberships must not cause private
knowledge to be promoted to their union. Preserve source scope/provenance and
keep ambiguous material pending for an owner instead of broadening it by
default. Continue the existing promotion doctrine: durable decisions, rationale
and useful procedures; do not fill the KB with duplicate descriptions of code.

Make the destination explicit in the promotion result. With Git custody, use
the destination repository's branch/review workflow, handle conflicting updates
there, and confirm publication separately from starting the harvester. The
reader must then be able to retrieve the accepted knowledge from another home
or host. Inspection should expose available collections and freshness/update
problems through provider operations, without the GUI assuming OKF paths.

This stays inside the replaceable knowledge capability. The default OKF package
needs this extension; another provider may implement a different store and
harvester. The deployment expert configures and diagnoses it, and schedules
invoke its declared operations. Neither expertise nor a cron substitutes for
implementing the shared read/write contract.

## Evidence and boundaries for the September 8 amendment

The identity findings were checked against aweb's canonical docs and CLI
implementation in checkout `0a3a9a9`; the identity/team/wake files checked were
unchanged against its fetched `origin/main` reference `bfdb208`. These references
establish source behavior, not new installed multi-team acceptance:

- [Identity model](https://github.com/awebai/aweb/blob/bfdb20886080e4ffe1f02b266f6116d12bd100fd/docs/identity.md)
  and [identity guide](https://github.com/awebai/aweb/blob/bfdb20886080e4ffe1f02b266f6116d12bd100fd/docs/identity-guide.md):
  scope, memberships, addresses, certificate and lifecycle distinctions.
- [Work across teams](https://github.com/awebai/aweb/blob/bfdb20886080e4ffe1f02b266f6116d12bd100fd/docs/work-across-teams.md)
  and [aweb SOT](https://github.com/awebai/aweb/blob/bfdb20886080e4ffe1f02b266f6116d12bd100fd/docs/aweb-sot.md):
  membership lists, active selection and per-team coordination state.
- [Global/local routing](https://github.com/awebai/aweb/blob/bfdb20886080e4ffe1f02b266f6116d12bd100fd/docs/global-local-identity-routing.md):
  addresses, learned return routes and current inbound-policy boundaries.
- [CLI team implementation](https://github.com/awebai/aweb/blob/bfdb20886080e4ffe1f02b266f6116d12bd100fd/cli/go/cmd/aw/id_team.go):
  `ensureTeamAcceptScopeAllowed`, `resolveGlobalIdentityForTeamAccept` and
  `acceptHostedTeamInviteWithDetails` enforce single-team local scope and
  reuse existing global identity material.
- [Inbound mode normalization](https://github.com/awebai/aweb/blob/bfdb20886080e4ffe1f02b266f6116d12bd100fd/cli/go/cmd/aw/inbound_mode.go)
  and [wake client construction](https://github.com/awebai/aweb/blob/bfdb20886080e4ffe1f02b266f6116d12bd100fd/cli/go/cmd/aw/wake.go):
  compatibility spellings and the selected client behind broker streams.
- OATS [aweb adapter](../../capabilities/oats-aweb/bin/oats-aweb.mjs),
  [OKF adapter](../../capabilities/oats-okf/bin/oats-okf.mjs),
  [configuration](../configuration.md) and [layers](../layers.md): current
  single-team spawning, retained custody, soul-directed harvesting, and the
  explicitly proposed shared knowledge scoping.

Before implementing against a deployed version, check its public CLI and
service capabilities. Do not treat a proposal, a source test, a saved
certificate, or an old migration receipt as proof that the full installed
multi-team/wake/shared-knowledge journey has passed.

## Git preparation and updates

The deployment package owns initial repository clone or adoption. Its saved
configuration identifies the repository source, local destination and selected
revision/update policy. Git credentials must work on the execution host;
successful SSH access to that host does not establish repository access.

Use an existing suitable checkout without overwriting it. For an isolated new
agent, prepare the selected revision and create a separate worktree according
to the work policy. Record the resolved revision so the result is inspectable.
Fetch and selecting a revision are distinct from moving an active checkout.

Starting an agent must not silently pull, reset or switch another agent's
working checkout. Updates to an existing agent's work remain explicit work
operations. A package that supports another work-target system can implement
the corresponding behavior without teaching the kernel that system's details.

## The expert and the extensible installation

Ship a portable setup/repair skill and make it usable by an existing agent
before OATS has been installed. The same knowledge should support a resident
installation expert once OATS works. This gives a repair path when the GUI or
OATS lifecycle itself is unavailable.

The expert should be available on demand and wake when asked. Schedules,
message delivery and running sessions must not require a continuously active
model supervising them. The expert can help create a recurring diagnostic job
when useful; an always-busy expert is not a prerequisite for a healthy system.

Keep reusable expert knowledge in its package. Hostnames, local paths, chosen
providers and unfinished local work belong to deployment configuration and
deployment-owned knowledge. Another expert instance must be able to take over
from those records. Avoid a second authoritative deployment database hidden in
the expert's memory.

This is the useful interpretation of "Emacs-ification": an inspectable,
programmable installation whose users can compose and share extensions, with
an expert that understands the available operations. The CLI, GUI and expert
should invoke the same mechanisms and report the same effective configuration.

The expert may implement an extension when an actual requirement demands it.
Package acquisition, versioning and the normal development/review process
still apply. Teaching an expert to invent a fresh setup script on every
installation would lose the repeatability that makes this approach valuable.

## Changing a deployment while agents work

Changes need clear scope and application semantics:

| Change | Intended behavior |
|---|---|
| Defaults or launch configuration for future instances | Save immediately; expose what future launches will use |
| Existing instance's harness or launch recipe | Use an explicit targeted restart; preserve its home and identity |
| Existing instance's capability bindings | Show captured bindings versus current configuration; apply through an explicit supported transition |
| Work location or knowledge provider | Treat as a migration with a concrete preservation plan, not a config-only substitution |
| Schedule | Apply through scheduling operations; distinguish a configured job from a successful run |
| OATS or package implementation | Test the candidate, install the intended version, retain a recovery path and affect only the necessary processes |

Some of these behaviors already have commands; others describe the desired
contract. In particular, selecting a new knowledge provider does not imply
automatic conversion of existing knowledge.

The expert may perform authorized maintenance while work continues. Routine
onboarding must not depend on rewriting the running kernel or restarting every
agent. It should also be possible to recover without the particular expert
session that initiated the change.

## Implementation sequence and takeover

Juan has endorsed this direction and requested this written handoff so Pepe's
agents can take over during his absence. Continue through the existing team
coordination and review process. The slices below are ordered around one usable
journey, with no prerequisite platform rewrite.

1. **Resolve the membership, identity and knowledge contracts.** Make the
   workspace team catalog, instance membership set, explicit identity scope,
   custody and shared-knowledge read/write destinations concrete. Use the
   verified aweb primitives, with owner review of any required aweb change.
   Done when one multi-team global instance and one single-team local instance
   can be described without conflating workspace, identity or knowledge scope.
2. **Separate and refresh the expert.** Distinguish the portable installation
   expert from the repository maintainer. Update the setup/repair skill to the
   actual CLI and selected-capability contracts. Make the skill usable outside
   OATS. Done when a fresh agent can understand an installation without inheriting
   our repository maintenance instructions or relying on a prior conversation.
3. **Exercise one real remote deployment.** Coordinate with the existing team's
   owner, inspect current state and prepare one additional agent on the intended
   host. Record the exact missing operations and the chosen deployment layout.
   Preserve existing workers. Done when the acceptance journey below succeeds.
4. **Package repeated preparation.** Extract the mechanical steps from that
   journey into inspect/prepare commands with structured results and a retry
   path. Add only the core boundary needed to consume them. Done when rerunning
   preparation reuses the prepared deployment and an incomplete attempt can be
   diagnosed and resumed without losing existing work.
5. **Expose the deployment in the GUI.** Distinguish host from workspace and
   communication-team membership; show identity scope and knowledge collections;
   show paths, readiness and actionable failures using the same operations as
   the expert. Done when a user can understand where an agent will run before
   starting it and manage the resulting instance afterward.
6. **Prove takeover and document the shipped path.** Have a fresh expert inspect
   the saved setup, explain it and perform a bounded addition or repair. Publish
   the working onboarding instructions and update this proposal with what
   actually shipped. No access to the original conversation should be required.

Maintainers can divide package/skill work and GUI work once the operation shape
is concrete. Agree that small contract before building two implementations.
Use focused tests for new behavior and one bounded end-to-end qualification;
documentation-only changes do not require launching harnesses or rebuilding
Desktop.

## Acceptance journey

Given an existing team and an accessible host, a user asks:

> Add a developer to this team on that server, using this launch configuration.

Success means:

- The expert discovers and adopts suitable existing setup, or prepares the
  missing pieces at explicit recorded paths.
- Selected capabilities are available; the instance has the intended team
  memberships, identity scope/custody and work target.
- One global instance joins two teams using the same `did:aw`; each has its
  own valid binding and context. A single-team local instance is also supported;
  requesting a second membership for it produces an explicit scope error.
- Per-team operations use the selected context; switching the default neither
  removes memberships nor prevents incoming work from the other team. The GUI
  represents one instance with multiple memberships accurately.
- The chosen harness starts and can be attached to and managed from the GUI.
- A real message reaches the agent and a useful response returns through the
  selected messaging/wake mechanism, including after the GUI closes.
- Requested scheduling and knowledge behavior are verified separately from
  merely starting a process. For harvesting, verify useful knowledge output
  through the selected provider, not just that a harvester ran.
- An agent promotes a project decision into the intended shared collection,
  and another authorized instance on another host retrieves it. A reusable
  soul lesson stays separately reusable; private project material is not
  copied into another team or the portable soul by default.
- Restart preserves identity and memberships; leaving one global membership
  preserves the others. Retiring a home preserves recoverable global custody;
  local self-retirement reports the actual certificate/name-release result.
- Existing agents continue working without an unrequested restart, identity
  replacement or checkout change.
- A fresh expert can inspect the recorded result, repeat preparation without
  damage, and diagnose a deliberately missing prerequisite.

## Handoff boundaries and release baseline

OATS 0.22.19 is the published baseline for this assessment. It includes named
launch configurations and session restart alongside the earlier remote,
provider-operation, scheduling and Desktop work. This document introduces no
runtime changes, package installation, release or migration.

Implementation taking over from this proposal should inspect current main and
live deployment state rather than assuming that dated observations remain
current. Keep machine-specific paths, credentials and operational receipts out
of this portable public proposal; exchange them through the existing owner
handoffs.

Preserve Juan's operating constraints: do not disturb the TSM team until its
deployment owner confirms completion; do not interrupt urgent work or restart
existing agents to demonstrate onboarding. Keep one Desktop instance and
bounded test sessions. Existing capture/harvesting holds are not lifted by this
proposal. Coordinate any real pilot with its owner instead of enabling broad
recurring jobs as a side effect.

The next evidence sought is a repeatable, usable installation with a successful
remote teammate and a working handover. Additional abstractions should earn
their place by removing an observed obstacle to that outcome.
