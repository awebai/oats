# OATS architecture proposal: components, contracts, and what may be replaced

Status: proposal, for review. Not shipped behavior.

Date: 2026-09-03

Decision owner: Pepe

The component model in this document is Pepe's and Juan's, as
stated on 2026-09-03. The contract analysis, simplifications, and
consequences are the oats workspace's first-principles reading of
that model. Where this document and a shipped doc disagree about
*current* behavior, the shipped doc is right; where they disagree
about *direction*, this document is the proposal.

The turn record is one capture implementation in this model,
not its center. The clothes model survives only as an optional
realization artifact. `docs/layers.md` remains a correct
description of the shipped five layers; this document
generalizes it.

## Goal

An architecture that expands and adapts: new runtimes, new places
to run them, new knowledge formats, new task trackers, new
communication systems, new ways to store souls, new soul types,
each added without changing OATS.

The single design rule that produces that property:

> Every main component is replaceable by another that offers the
> same contract, with the exception of OATS itself. OATS knows
> only contracts.

Nothing in the model mentions a repository. A repository is one
place a soul can be stored and one thing an instance can work
on. Both are behind contracts. A soul could equally be
instantiated in a provider of autonomous agents that has no
filesystem at all.

## The model

### Soul

A soul has:

- `AGENTS.md`: the operating definition, runtime-neutral by
  construction;
- optional **finetuning**;
- optional **clothes**;
- its **capabilities**.

Finetuning and clothes are optimizations that may or may not pay off. They
are bracketed on purpose (see "Realization artifacts" below).

### Capability

A capability is a set of scripts, skills, and docs. Skills come
from capabilities. An OATS installation needs capabilities for
these contracts, possibly scoped by soul type:

- **Knowledge access**;
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

A component list says what exists. The architecture is the set of
contracts between them. The table below names each seam, what
must be able to vary across it, and the two implementations that
would prove the contract is real.  Where only one implementation
can be named, the contract is still a description of that one;
those rows are the work.

| Seam                   | What varies behind it                                  | Implementation today                    | Second implementation             |
|------------------------|--------------------------------------------------------|-----------------------------------------|-----------------------------------|
| Soul format            | how a specialist is defined                            | `soul.yaml` + `AGENTS.md` + skills      | same format, different store      |
| Soul type              | which capabilities and knowledge scope a soul may have | config agent types                      | (formalize; see below)            |
| Capability manifest    | what a capability contributes and requires             | `oats.json`                             | exists, stable                    |
| Knowledge contract     | format read by instances and written by harvest        | `oats.okf`                              | plain-markdown or wiki capability |
| Task contract          | where shared work state lives                          | `oats.jira`, `oats.linear`              | beads, GitHub Issues              |
| Communication contract | how instances are reached and reach others             | `oats.aweb`                             | Slack, A2A gateway                |
| Capture contract       | format of ephemeral state                              | OKF `notes/` + turn record              | either alone                      |
| Runtime provider       | how a realization bundle becomes a running agent       | Pi or Claude Code in local tmux         | a hosted agent provider           |
| Soul store             | where souls are kept and versioned                     | git repository under `agents/`          | package; provider registry        |
| Work target            | what an instance operates on                           | worktree, checkout, attached, workspace | none (a mail-only agent)          |
| Package                | acquisition, version, integrity, trust                 | git-acquired, hash-locked               | local path (exists)               |
| Lifecycle events       | when capabilities may act                              | scaffold, spawn, retire                 | + harvest                         |

Two seams on this table have one real implementation: runtime provider and
soul store. They are where expandability is currently a promise rather than a
property.

## The contracts

### Soul format

A soul declares *which contracts it needs*, never which
implementation fills them. `AGENTS.md` speaks of "your task
layer" and "your knowledge"; the capability's injected block says
what that is in this installation. This is what lets one packaged
soul run in an installation bound to Jira and another bound to
Linear, and it is already how injection works.

A soul is runtime-neutral as an artifact. Anything
runtime-specific derived from it is a realization artifact, not
soul content.

### Soul type

A soul type is the policy unit. It decides which capabilities a
soul of that type receives, what knowledge it may read, and
whether it may write knowledge.  Authority lives here, not in a
permission system.

Consequences:

- a reviewer is a soul type, not a component;
- a harvester is a soul type permitted to write knowledge;
- the GUI's natural organizing axis is type.

Today this is the config's agent-type targeting. Formalizing it
means naming the type in the soul, letting packages ship types,
and letting the knowledge contract read the type for scoping.

### Capability manifest and lifecycle events

A capability declares: its slot, if it fills one; what it
contributes (skills, instruction blocks, commands, environment);
which lifecycle events it hooks; and what it requires from the
host. The event list is the API that makes capabilities
composable and should change rarely. Proposed list: `scaffold`,
`spawn`, `retire`, `harvest`.

### The slot contracts

These carry the architecture and should be written as contracts,
not as descriptions of the default packages.

**Knowledge access** has two sides. *Read*: an instance can find
and consult organizational knowledge within its type's
scope. *Write*: a permitted soul can promote into it. The format
is the capability's; the two sides are the contract. Custody
scoping (soul-shared, workspace overlay, repository overlay)
belongs to this contract so that repository-specific knowledge
cannot leak to a cross-repository soul.

**Task management**: where shared work state lives, and how an
instance claims, updates, blocks, and completes work. Verdicts
and review outcomes are task records, which is how verification
enters the model without a component.

**Communication**: how an instance becomes reachable and reaches
others. The contract must state whether the address can outlive
the instance. For a durable specialist the answer should be yes,
realized however the implementation chooses (aweb: a soul-level
identity served through per-instance grants). Without this, a
hosted provider cannot host "the specialist you can always write
to."

**Capture**: the format of ephemeral state. Notes are the agent's
own report of what mattered; a captured session is ground
truth. Both satisfy the contract; the harvester may consume
either or both. Clothes are one optional consumer of the same
contract.

### Runtime provider

OATS hands a **realization bundle** to a provider and gets back
an instance handle:

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

Whether the bundle becomes Pi in tmux, Claude Code in a
container, or a hosted agent with no filesystem is the provider's
business. Define this contract from what Pi and Claude Code
actually need today, and keep it that small. The 2026-08-15
implementation plan failed by abstracting execution targets
beyond that before a second provider existed.

### Soul store and work target

These are separate parameters of instantiation. Today one
filesystem location under `agents/` decides three things at once:
who the soul is, where its knowledge is kept, and what its
instances work on. The 2026-07-30 product boundary review named
this as the foundational gap. Separating the two seams is what
removes the repository from the architecture.

An instance is therefore:

```text
instance = (soul, runtime provider, work target?, task)
```

Any of the four may be substituted; the work target may be
absent.

### Package

Acquisition, exact version, integrity, dependency closure,
executable trust.  Exists; a package may now also ship soul
types.

## Three simplifications

**The harvester is a soul.** Its input is the capture contract
and its output is the knowledge contract's write side. Only the
knowledge capability knows the knowledge format, so the harvester
belongs to the knowledge package. OATS does not run a special
harvester; it spawns a soul of a type permitted to write
knowledge, on the `harvest` lifecycle event. This is already how
the OKF `memory-harvest` agent runs. A new knowledge format
brings its own judge.

**Soul type is the policy unit.** Stated above; repeated here
because it removes two would-be components (a reviewer, a
permission model).

**Contracts and bootstrap skills in OATS; implementations in packages.**
OATS ships the slot contracts and the skill that
teaches an agent the shape of each. Implementations are
packages. OATS may bundle a minimal default per slot so a fresh
installation is a complete product with nothing acquired.  This
answers "meta-capabilities or OATS basic skills": both, split by
that line, and it keeps OATS the only irreplaceable component
while ensuring it never knows a tracker, a mail system, or a
knowledge format.

## Realization artifacts: finetuning and clothes

Both are runtime-specific by nature: a finetune is per provider,
a compiled session is per harness. Inside the soul they would
break "any runtime."  Attached to a (soul, runtime) realization
and cached there, they cost nothing and can be dropped if they
never pay off. That is the property wanted for a bet whose
outcome is unknown.

Two different things have been called clothes and should be named
apart:

- **curated exemplars** shipped and reviewed with a soul, a
  committed artifact needing no selection machinery;
- **spawn-time selection** from captured history, the
  experimental `oats experimental dress` path.

Only the first is a soul-adjacent artifact. The second stays
experimental until its experiment reads out, and this
architecture does not depend on it.

## Where the turn record fits

The turn record is one implementation of the capture contract,
and a good one: passive, verbatim, content-addressed,
searchable. `recall` is a tool over it. `dress` is an optional
consumer. `attend` belongs to the communication contract's
implementation, not to OATS. The specification and vectors stay
where they are.

What changes is status: the bookshelf's turn-record documents
should be re-marked from "accepted architecture direction" to
"capture substrate and experiment." The repository README should
lead with the soul, capability, and package model and present the
record as the default capture.

## Consequences for the current implementation

Already matching the proposal, no change: souls and `AGENTS.md`;
capability manifests and hooks; packages and locks; the OKF
harvester as a capability-defined agent; exclusive slots for
knowledge, messaging, tasks; the Desktop as the management
surface.

Changes, none of which rewrites anything:

1. Write the four slot contracts as contracts, replacing the
   package-shaped descriptions in `docs/layers.md` and
   `docs/integrations.md`.
2. Formalize soul type: named in `soul.yaml`, shippable in
   packages, read by the knowledge contract for scoping.
3. Add `harvest` as a lifecycle event; route `oats okf harvest`
   through it.
4. Make capture a slot; `packages/record` becomes its default
   implementation. Capture means session capture: OKF `notes/`
   are the knowledge capability's own instance memory, not a
   capture implementation, and the harvester reads both. Feed
   the harvester from the capture contract (epic `aweb-abfz`).
5. Define the runtime-provider contract from the current Pi and
   Claude Code launch paths, and put both behind it. No third
   provider until a real one asks.
6. Separate soul store from work target in instantiation. First
   step: an instance may declare its work target independently of
   where its soul is stored, which the `workspace` mode already
   half-does.
7. Add a realization cache per (soul, runtime) for finetune
   references and compiled exemplars, empty by default.

## The replaceability test

For each seam, name two implementations that both satisfy the
contract and show a soul running unchanged behind each. Where
that cannot be done, the contract is unfinished. The two seams
that fail the test today are runtime provider and soul store;
they should be the first contracts written, and they should be
written narrowly.

## Migration plan

The goal of the migration is the functionality OATS has today,
under the seams above. Each step is one reviewable landing that
leaves the test suite green and the output fixtures identical,
except where a step deliberately adds a surface.

### Where the seams sit in the code today

The kernel is about 10k lines in `lib/core.mjs` and
`bin/oats.mjs`, with the package engine partly in
`lib/packages.mjs`.

| Seam | Where it lives today | State |
|---|---|---|
| Slot contracts | `LAYERS` plus `resolveOatsConfig` | data-driven; capture is one entry away |
| Soul type | `agent-types` in config, `type:` in `soul.yaml`, `soulTypeOf` | exists; not exported to hooks, not shippable by packages |
| Capability manifest, hooks | `runLifecycleHooks`, the manifest schema | stable; three events |
| Harvester | `memory-harvest` capability agent spawned via `oats spawn --json` | already a soul; triggered by an instance command, not an event |
| Runtime provider | about 150 lines inside `spawnInstance` plus the model, binary, and runtime-package helpers | entangled with tmux and the home layout |
| Platform | tmux calls in spawn, retire, status, and the Desktop | one implementation, no interface |
| Soul store | `findAgent`, `listAgents`, `teamAgentRoots`, `findCapabilityAgent` | three lookups, all filesystem |
| Work target | `resolveWorkMode` plus the mode branches in spawn, retire, baseline, quarantine | four modes; retire safety depends on them |
| Package | `lib/packages.mjs` and the engine half of core | the most tested seam; not touched |

Two things make "same functionality" checkable. The test suite
is behavioral, and the externally meaningful outputs are few:
the composed `AGENTS.md`, `instance.json`, `TASK.md`, the launch
command line, and the retirement outcome. Frozen as golden
fixtures first, every extraction below is verified against
bytes rather than against intent.

### The sequence

1. **Golden fixtures.** For Pi and Claude Code, each work mode,
   knowledge none and okf, messaging none and a stub: snapshot
   the home layout, the composed instructions, instance metadata
   minus timestamps, the launch command, and the retire
   result. This is the contract for everything after it.
2. **Contracts on paper.** Rewrite `docs/layers.md` and
   `docs/integrations.md` as the four slot contracts, the
   lifecycle events including `harvest`, runtime provider, soul
   store, and work target. Runs in parallel with step 1.
3. **Split core by responsibility, no behavior change.** Config
   and scopes, package engine, souls, composition, hooks,
   instances. `lib/core.mjs` stays as the re-export facade so
   the Desktop and the tests keep their import. A pure move,
   checked by the fixtures.
4. **Extract runtime providers.** A registry with one module
   each for Pi and Claude Code: binary resolution, model
   preference, runtime-package verification, the launch command
   from a realization bundle, and the posture record. Spawn asks
   the provider and no longer branches on the runtime name.
5. **Extract the platform.** A tmux module with launch, alive,
   stop, and list. Spawn, retire, status, and the Desktop's tmux
   target reads go through it. The `tmux` field in
   `instance.json` stays; a `handle` carrying a kind is added
   beside it, never instead of it, so the Desktop keeps working.
6. **Harvest as a lifecycle event.** Accept `harvest` in
   manifests, add `oats harvest` to run the active capabilities'
   harvest hooks, have oats-okf declare its hook, and update the
   injected instruction. `oats okf harvest` keeps working. This
   spans repositories and touches the frozen package-runtime
   boundary, so it goes through the coordinator to Pepe.
7. **Soul type export.** Pass the type to hooks and dispatched
   commands (`OATS_SOUL_TYPE`), let packages declare agent
   types, show it in doctor. Knowledge scoping by type then
   becomes okf's work, reading the type it is given. Same
   boundary rule as step 6.
8. **Capture as a slot.** Add `capture` to the slot list, wrap
   the record package as a bundled framework-trusted capability
   whose spawn hook records the instance-to-session mapping, and
   keep `oats setup`, `oats capture`, and `oats recall` as
   kernel aliases resolving to the active capture
   capability. The record-fed harvester (`aweb-abfz`) becomes
   okf work over this contract.
9. **Soul store interface.** Unify the three finders behind one
   list of stores with the filesystem as the single
   implementation; the instance home root becomes the store's
   answer. This is what a provider registry or a Library later
   plugs into.
10. **Extract work targets and add `none`.** One module per
    mode, with retirement baseline and inspection moving
    alongside. Last, because retire safety and quarantine sit on
    it; the retirement fixtures from step 1 exist for this step.
11. **Docs and release.** The README leads with the model and
    presents the record as the default capture; the bookshelf
    turn-record documents are re-marked; a release whose only
    user-visible additions are `oats harvest`, the capture slot,
    and the `none` work mode.

### Deliberately not in the sequence

- a second runtime provider, until a real one asks;
- a realization cache for finetunes or exemplars, until
  something consumes one;
- minimal bundled defaults per slot;
- any change to the package engine.

The point of the sequence is that each seam ends with one
implementation behind a real interface and a fixture proving
it, so the second implementation is a new module rather than a
refactor.

### Size and parallelism

Three to four weeks single-threaded. After step 3, the pairs
(4, 5), (6, 7), and step 8 are independent and can run on
separate agents. Steps 6 and 7 need the maintainer's ruling on
the package-runtime boundary before they start.

## Open questions

- Does the communication contract *require* a soul-level durable
  address, or only permit one?
- Is capture a fourth exclusive slot, or an additive capability
  that several packages may provide at once?
- What does a provider registry need from the soul-store contract
  that a git repository does not?
- What triggers `harvest`: commit, retire, schedule, or the
  capture capability reporting new state?
- How does a runtime provider without a filesystem receive
  instructions and skills? This decides whether the bundle is
  files or a document.
- How do config agent types and soul types unify without breaking
  existing configs?

## Related

- [Layers](layers.md), [Capabilities](capabilities.md),
  [Souls and instances](souls-and-instances.md),
  [Knowledge theory](knowledge-theory.md)
- Bookshelf: `product/2026-07-30-oas-aweb-product-boundary-review.md`,
  `oats/2026-08-18-turn-record-and-tools.md`,
  `oats/2026-08-18-oats-runtime-agents-and-clothes.md`,
  `strategy/2026-09-01-aweb-adoption-and-organizational-sovereignty.md`
