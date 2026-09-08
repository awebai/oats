# Expert-assisted deployment and an extensible OATS

Date: 2026-09-08

Status: proposed implementation plan; direction endorsed by Juan on September 8.
This document records the proposal and a takeover plan while Juan is away for
a couple of days. It does not claim that the proposed deployment workflow has
shipped. Current-state observations below are against main `daf2941`, following
the publication of OATS 0.22.19.

## Outcome

A user should be able to ask an OATS expert to add an agent to an existing team
on another machine. The expert prepares or adopts the necessary workspace,
configures the selected capabilities, starts the agent, and verifies that the
result works. The resulting configuration and procedures belong to the user
and remain usable by another agent, the CLI, and the GUI.

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

- **Team:** the organizational grouping and capability policy. Messaging
  membership is established through the selected messaging implementation.
- **Host:** a machine reachable through the selected execution transport.
- **Deployment:** a team's installed configuration, packages and locations on
  a particular host. One host may contain several teams' deployments.
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

For example, `/srv/example-team` could be an explicitly selected remote
workspace. Its repository mappings and agents root determine where individual
homes and worktrees are created. That path is an example, not a new default or
a claim about an existing installation. The selected harness does not choose
the workspace location.

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

1. **Separate and refresh the expert.** Distinguish the portable installation
   expert from the repository maintainer. Update the setup/repair skill to the
   actual CLI and selected-capability contracts. Make the skill usable outside
   OATS. Done when a fresh agent can understand an installation without inheriting
   our repository maintenance instructions or relying on a prior conversation.
2. **Exercise one real remote deployment.** Coordinate with the existing team's
   owner, inspect current state and prepare one additional agent on the intended
   host. Record the exact missing operations and the chosen deployment layout.
   Preserve existing workers. Done when the acceptance journey below succeeds.
3. **Package repeated preparation.** Extract the mechanical steps from that
   journey into inspect/prepare commands with structured results and a retry
   path. Add only the core boundary needed to consume them. Done when rerunning
   preparation reuses the prepared deployment and an incomplete attempt can be
   diagnosed and resumed without losing existing work.
4. **Expose the deployment in the GUI.** Distinguish host from team deployment;
   show paths, readiness and actionable failures using the same operations as
   the expert. Done when a user can understand where an agent will run before
   starting it and manage the resulting instance afterward.
5. **Prove takeover and document the shipped path.** Have a fresh expert inspect
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
  identity/membership and work target.
- The chosen harness starts and can be attached to and managed from the GUI.
- A real message reaches the agent and a useful response returns through the
  selected messaging/wake mechanism, including after the GUI closes.
- Requested scheduling and knowledge behavior are verified separately from
  merely starting a process. For harvesting, verify useful knowledge output
  through the selected provider, not just that a harvester ran.
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
