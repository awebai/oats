# OATS architecture proposal: components, contracts, and what may be replaced

Status: proposal, for review. Not shipped behavior.

Date: 2026-09-03

Decision owner: Juan

The component model in this document is Juan's, as stated on 2026-09-03. The
contract analysis, simplifications, and consequences are the oats workspace's
first-principles reading of that model. Where this document and a shipped doc
disagree about *current* behavior, the shipped doc is right; where they
disagree about *direction*, this document is the proposal.

Relationship to existing direction: the turn record series in the bookshelf
(`2026-08-18-turn-record-and-tools.md` and companions) made the record the
architectural center of gravity. This proposal does not adopt that center. The
record remains as one implementation of one capability (capture), and its
tools remain useful. The clothes model survives only as an optional
realization artifact. `docs/layers.md` remains a correct description of the
shipped five layers; this document generalizes it.

## Goal

An architecture that expands and adapts: new runtimes, new places to run them,
new knowledge formats, new task trackers, new communication systems, new ways
to store souls, new soul types, each added without changing OATS.

The single design rule that produces that property:

> Every main component is replaceable by another that offers the same
> contract, with the exception of OATS itself. OATS knows only contracts.

Nothing in the model mentions a repository. A repository is one place a soul
can be stored and one thing an instance can work on. Both are behind
contracts. A soul could equally be instantiated in a provider of autonomous
agents that has no filesystem at all.

## The model

### Soul

A soul has:

- `AGENTS.md`: the operating definition, runtime-neutral by construction;
- optional **finetuning**;
- optional **clothes**;
- its **capabilities**.

Finetuning and clothes are optimizations that may or may not pay off. They
are bracketed on purpose (see "Realization artifacts" below).

### Capability

A capability is a set of scripts, skills, and docs. Skills come from
capabilities. An OATS installation needs capabilities for these contracts,
possibly scoped by soul type:

- **Knowledge access**, possibly limited per soul type;
- **Task management**;
- **Communication**;
- optionally, **capture** of ephemeral state such as notes or conversation
  history, which is also the input from which clothes may be derived.

The user selects which capability fills each contract, usually after
installing it from a package.

### Harvester

A harvester knows how to convert ephemeral state into organizational
knowledge, in the format the knowledge-access capability reads.

### Package

A package groups cohesive souls and capability sets.

### OATS

OATS knows how to:

- create instances for any given (soul, runtime);
- run the runtimes in supported platforms;
- install the task, knowledge, and communication capabilities;
- instantiate and run the harvester;
- install souls and capabilities from packages;
- manage all of the above with a clear GUI.

## The architecture is its seams

A component list says what exists. The architecture is the set of contracts
between them. The table below names each seam, what must be able to vary
across it, and the two implementations that would prove the contract is real.
Where only one implementation can be named, the contract is still a
description of that one; those rows are the work.

| Seam | What varies behind it | Implementation today | Second implementation |
| --- | --- | --- | --- |
| Soul format | how a specialist is defined | `soul.yaml` + `AGENTS.md` + skills | same format, different store |
| Soul type | which capabilities and knowledge scope a soul may have | config agent types | (formalize; see below) |
| Capability manifest | what a capability contributes and requires | `oats.json` | exists, stable |
| Knowledge contract | format read by instances and written by harvest | `oats.okf` | plain-markdown or wiki capability |
| Task contract | where shared work state lives | `oats.jira`, `oats.linear` | beads, GitHub Issues |
| Communication contract | how instances are reached and reach others | `oats.aweb` | Slack, A2A gateway |
| Capture contract | format of ephemeral state | OKF `notes/` + turn record | either alone |
| Runtime provider | how a realization bundle becomes a running agent | Pi or Claude Code in local tmux | a hosted agent provider |
| Soul store | where souls are kept and versioned | git repository under `agents/` | package; provider registry |
| Work target | what an instance operates on | worktree, checkout, attached, workspace | none (a mail-only agent) |
| Package | acquisition, version, integrity, trust | git-acquired, hash-locked | local path (exists) |
| Lifecycle events | when capabilities may act | scaffold, spawn, retire | + harvest |

Two seams on this table have one real implementation: runtime provider and
soul store. They are where expandability is currently a promise rather than a
property.

## The contracts

### Soul format

A soul declares *which contracts it needs*, never which implementation fills
them. `AGENTS.md` speaks of "your task layer" and "your knowledge"; the
capability's injected block says what that is in this installation. This is
what lets one packaged soul run in an installation bound to Jira and another
bound to Linear, and it is already how injection works.

A soul is runtime-neutral as an artifact. Anything runtime-specific derived
from it is a realization artifact, not soul content.

### Soul type

A soul type is the policy unit. It decides which capabilities a soul of that
type receives, what knowledge it may read, and whether it may write knowledge.
Authority lives here, not in a permission system.

Consequences:

- a reviewer is a soul type, not a component;
- a harvester is a soul type permitted to write knowledge;
- the GUI's natural organizing axis is type.

Today this is the config's agent-type targeting. Formalizing it means naming
the type in the soul, letting packages ship types, and letting the knowledge
contract read the type for scoping.

### Capability manifest and lifecycle events

A capability declares: its slot, if it fills one; what it contributes (skills,
instruction blocks, commands, environment); which lifecycle events it hooks;
and what it requires from the host. The event list is the API that makes
capabilities composable and should change rarely. Proposed list: `scaffold`,
`spawn`, `retire`, `harvest`.

### The slot contracts

These carry the architecture and should be written as contracts, not as
descriptions of the default packages.

**Knowledge access** has two sides. *Read*: an instance can find and consult
organizational knowledge within its type's scope. *Write*: a permitted soul
can promote into it. The format is the capability's; the two sides are the
contract. Custody scoping (soul-shared, workspace overlay, repository overlay)
belongs to this contract so that repository-specific knowledge cannot leak to
a cross-repository soul.

**Task management**: where shared work state lives, and how an instance
claims, updates, blocks, and completes work. Verdicts and review outcomes are
task records, which is how verification enters the model without a component.

**Communication**: how an instance becomes reachable and reaches others. The
contract must state whether the address can outlive the instance. For a
durable specialist the answer should be yes, realized however the
implementation chooses (aweb: a soul-level identity served through
per-instance grants). Without this, a hosted provider cannot host "the
specialist you can always write to."

**Capture**: the format of ephemeral state. Notes are the agent's own report
of what mattered; a captured session is ground truth. Both satisfy the
contract; the harvester may consume either or both. Clothes are one optional
consumer of the same contract.

### Runtime provider

OATS hands a **realization bundle** to a provider and gets back an instance
handle:

```text
bundle
  instructions (composed AGENTS.md)
  skills (the exact materialized set)
  capability scripts and environment
  task
  realization artifacts for this runtime, if any (finetune ref, compiled clothes)

handle
  observe (status, the session where capture can find it)
  message / steer, where the provider supports it
  stop
```

Whether the bundle becomes Pi in tmux, Claude Code in a container, or a
hosted agent with no filesystem is the provider's business. Define this
contract from what Pi and Claude Code actually need today, and keep it that
small. The 2026-08-15 implementation plan failed by abstracting execution
targets beyond that before a second provider existed.

### Soul store and work target

These are separate parameters of instantiation. Today one filesystem location
under `agents/` decides three things at once: who the soul is, where its
knowledge is kept, and what its instances work on. The 2026-07-30 product
boundary review named this as the foundational gap. Separating the two seams
is what removes the repository from the architecture.

An instance is therefore:

```text
instance = (soul, runtime provider, work target?, task)
```

Any of the four may be substituted; the work target may be absent.

### Package

Acquisition, exact version, integrity, dependency closure, executable trust.
Exists; a package may now also ship soul types.

## Three simplifications

**The harvester is a soul.** Its input is the capture contract and its output
is the knowledge contract's write side. Only the knowledge capability knows
the knowledge format, so the harvester belongs to the knowledge package. OATS
does not run a special harvester; it spawns a soul of a type permitted to
write knowledge, on the `harvest` lifecycle event. This is already how the OKF
`memory-harvest` agent runs. A new knowledge format brings its own judge.

**Soul type is the policy unit.** Stated above; repeated here because it
removes two would-be components (a reviewer, a permission model).

**Contracts and bootstrap skills in OATS; implementations in packages.** OATS
ships the slot contracts and the skill that teaches an agent the shape of
each. Implementations are packages. OATS may bundle a minimal default per
slot so a fresh installation is a complete product with nothing acquired.
This answers "meta-capabilities or OATS basic skills": both, split by that
line, and it keeps OATS the only irreplaceable component while ensuring it
never knows a tracker, a mail system, or a knowledge format.

## Realization artifacts: finetuning and clothes

Both are runtime-specific by nature: a finetune is per provider, a compiled
session is per harness. Inside the soul they would break "any runtime."
Attached to a (soul, runtime) realization and cached there, they cost nothing
and can be dropped if they never pay off. That is the property wanted for a
bet whose outcome is unknown.

Two different things have been called clothes and should be named apart:

- **curated exemplars** shipped and reviewed with a soul, a committed
  artifact needing no selection machinery;
- **spawn-time selection** from captured history, the experimental
  `oats experimental dress` path.

Only the first is a soul-adjacent artifact. The second stays experimental
until its experiment reads out, and this architecture does not depend on it.

## Where the turn record fits

The turn record is one implementation of the capture contract, and a good
one: passive, verbatim, content-addressed, searchable. `recall` is a tool over
it. `dress` is an optional consumer. `attend` belongs to the communication
contract's implementation, not to OATS. The specification and vectors stay
where they are.

What changes is status: the bookshelf's turn-record documents should be
re-marked from "accepted architecture direction" to "capture substrate and
experiment." The repository README should lead with the soul, capability, and
package model and present the record as the default capture.

## Consequences for the current implementation

Already matching the proposal, no change: souls and `AGENTS.md`; capability
manifests and hooks; packages and locks; the OKF harvester as a
capability-defined agent; exclusive slots for knowledge, messaging, tasks;
the Desktop as the management surface.

Changes, none of which rewrites anything:

1. Write the four slot contracts as contracts, replacing the package-shaped
   descriptions in `docs/layers.md` and `docs/integrations.md`.
2. Formalize soul type: named in `soul.yaml`, shippable in packages, read by
   the knowledge contract for scoping.
3. Add `harvest` as a lifecycle event; route `oats okf harvest` through it.
4. Make capture a slot; `packages/record` becomes its default implementation
   alongside OKF notes. Feed the harvester from it (epic `aweb-abfz`).
5. Define the runtime-provider contract from the current Pi and Claude Code
   launch paths, and put both behind it. No third provider until a real one
   asks.
6. Separate soul store from work target in instantiation. First step: an
   instance may declare its work target independently of where its soul is
   stored, which the `workspace` mode already half-does.
7. Add a realization cache per (soul, runtime) for finetune references and
   compiled exemplars, empty by default.

## The replaceability test

For each seam, name two implementations that both satisfy the contract and
show a soul running unchanged behind each. Where that cannot be done, the
contract is unfinished. The two seams that fail the test today are runtime
provider and soul store; they should be the first contracts written, and they
should be written narrowly.

## Open questions

- Does the communication contract *require* a soul-level durable address, or
  only permit one?
- Is capture a fourth exclusive slot, or an additive capability that several
  packages may provide at once?
- What does a provider registry need from the soul-store contract that a git
  repository does not?
- What triggers `harvest`: commit, retire, schedule, or the capture
  capability reporting new state?
- How does a runtime provider without a filesystem receive instructions and
  skills? This decides whether the bundle is files or a document.
- How do config agent types and soul types unify without breaking existing
  configs?

## Related

- [Layers](layers.md), [Capabilities](capabilities.md),
  [Souls and instances](souls-and-instances.md),
  [Knowledge theory](knowledge-theory.md)
- Bookshelf: `product/2026-07-30-oas-aweb-product-boundary-review.md`,
  `oats/2026-08-18-turn-record-and-tools.md`,
  `oats/2026-08-18-oats-runtime-agents-and-clothes.md`,
  `strategy/2026-09-01-aweb-adoption-and-organizational-sovereignty.md`
