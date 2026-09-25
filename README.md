# OATS: an open framework for specialised agent teams

**Free, open source, provider-agnostic, and decentralised by design.**

[![npm version](https://img.shields.io/npm/v/@awebai/oats.svg)](https://www.npmjs.com/package/@awebai/oats)
[![Release](https://img.shields.io/github/v/release/awebai/oats?display_name=tag)](https://github.com/awebai/oats/releases)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

OATS—**Open Agent Team Specification**—is a framework for building, running and coordinating teams of specialised AI agents. You can organise your team however you need, choosing models, harnesses and capabilities without being tied to a particular provider or stack.

**Capabilities are the building blocks of an OATS setup.** When you define an agent, you choose its capabilities. Each provides the know-how and tools for knowledge systems, messaging, task coordination or any other workflows, tools or ways of working. We provide defaults to get started, but you can adapt existing capabilities or create fully custom ones to shape how your agents work and which tools they use.

The [official catalog](docs/official-catalog.md) is the reviewed list of official packages; a workspace trusts a package by declaring it, and listing does not declare it for you.

**oats.aweb 1.13.1** attaches resident session-grant homes to the resident custody service during minting, verifies the written `grant.yaml` custody locator, and fails closed if an installed `aw` cannot write or prove that attachment. If a grant-sent message ever arrives as unverified, report the missing custody attachment instead of retrying.

For example, a kernel expert, a UX expert and a customer-support expert can share capabilities for learning and coordination, while each has specific capabilities for its own area of expertise.

Through your capabilities, you remain in control of:

- Which specialists make up the team.
- Which models and harnesses their instances use.
- Where their knowledge lives and how it develops.
- Which skills, tools and workflows they receive.
- How they communicate and coordinate.

These choices determine how your team operates and where the value of its work accumulates. Keeping them under your control means your knowledge, workflows and team structure can outlast any particular model or platform.

OATS also provides **OATS Desktop: a free, fully integrated ADE—an agentic IDE**. It brings your team, its work and its agent sessions into one place, making day-to-day collaboration with your agents clearer and more pleasant.

OATS builds on tools you already use—**Git, GitHub or GitLab, and your preferred agent harnesses**. People can share agent definitions, knowledge and workflows across projects without an OATS account, a central OATS server or an OATS-hosted database. Selected integrations may use their own servers or databases; those are your choices, not a mandatory OATS service.

## Why OATS

OATS grew from a practical need: we wanted control over our agent setups—not just which model answered a prompt, but also:

- The knowledge our agents accumulated.
- The know-how and workflows they used.
- The ways they communicated and coordinated.
- The systems on which all of this depended.

As model providers expand into complete agent platforms, choosing a model can also mean adopting that provider’s memory system, tools, workflows and communication channels. We wanted those to remain separate choices.

**We believe machine intelligence should become a commodity:** available from different providers through open interfaces, including local models that individuals can run and control themselves.

Models will still differ. But changing one should not mean abandoning the expertise, knowledge and working practices you have built around it.

OATS is our attempt to make that world practical.

## Souls and instances

OATS separates an agent’s reusable specialisation from the particular work it is doing.

### A soul defines a kind of expert

A **soul** is a reusable, versioned agent definition. It establishes:

- Its expertise and responsibilities.
- Its boundaries and operating principles.
- Its capabilities and specialised skills.
- The knowledge it should consult.

A soul is not a model or a conversation. It is the definition from which working agents are created. A UX-expert soul, for example, might combine interaction-design principles, accessibility skills and access to accepted product knowledge.

### An instance does the work

An **instance** is one incarnation of a soul, with its own identity, assignment, working context and state. It runs through a **harness**—the agent application, such as Pi, Claude Code or Codex—using the selected model.

Instances can have different lifetimes:

- **Short-lived instances** handle bounded work. For example, we use ephemeral developer and reviewer instances to implement and review specific changes.
- **Long-running instances** carry continuity across an area of work. We plan, investigate and reason with instances of expertise souls that may remain useful across many tasks.

An instance is not necessarily one ticket or one chat session. It can become deeply familiar with a situation over time. Lifetime follows the work: a short-lived instance can produce valuable learning, while a long-running instance does not automatically become a new soul.

### One soul can support many developers

Several developers may each work with an instance of the same kernel-expert soul:

- One investigates execution behaviour.
- Another develops a capability integration.
- Another supports an ongoing upgrade.

They share a specialisation, but not an active mind. Each develops an understanding of its assignment and keeps track of its own unfinished work. Accepted findings can become useful to other instances without making their working contexts identical.

## Core capabilities—and any others you need

Three **core capabilities** provide the foundation for working as a team; a soul has at most one of each:

| Capability | What it provides |
|---|---|
| **Knowledge** | How agents consult knowledge, capture experience and retain useful learning. |
| **Messaging** | How agents become reachable and communicate with people and other agents. |
| **Tasks** | How work is assigned, tracked and coordinated. |

These responsibilities are distinct. A conversation is not automatically a task record, and a task record is not automatically knowledge.

Core capabilities are **not the only capabilities you can define**. Other capabilities can provide domain tools, specialised skills, research methods, review procedures or integrations with your systems.

A **skill** teaches a way of working. A capability can supply that skill together with instructions, tools and supporting automation. OATS composes the selected resources into an instance’s working environment when it is created.

### Common contracts, different implementations

The kernel supplies soul and instance identity, configuration, lifecycle, resource composition and exact, integrity-checked package locking. Models and harnesses remain user-selected execution choices; capabilities may declare requirements that a chosen setup must satisfy.

Capabilities supply the behaviour behind their contracts:

- A knowledge capability can choose its storage, reading strategy and learning workflow.
- A messaging capability can use a different communication service.
- A task capability can connect agents to the tracker or coordination model you prefer.
- Additional capabilities can extend a team without becoming mandatory parts of OATS.

A **package** distributes capabilities and their resources. Declaring one in a workspace is the decision to trust it; its capabilities reach a soul only when the soul or a workspace default selects them. Provider independence does not mean every combination is compatible; missing requirements must be reported, not silently discarded.

## Our approach to knowledge and learning

The following is **our reference approach**, implemented through the official `oats.okf` knowledge capability. Other knowledge capabilities may adopt it, adapt it or use a different model.

We distinguish four kinds of value:

| Value | Where it belongs in our model |
|---|---|
| Reusable procedures and know-how | Skills and capabilities |
| Durable judgment and awareness of the larger picture | Accepted knowledge |
| A detailed understanding of the current problem | Instance context |
| Unfinished work and next steps | Instance state |

An experienced instance can have all four. We do not want to push them all into a permanent knowledge base.

### Save expertise, not a second description of the code

> **Knowledge is what makes an expert an expert in a subject or project. It is not a description of what lives in the code.**

Our promotion test asks:

1. Would an appropriate future instance act differently for knowing this?
2. Could it not have obtained this simply by reading the repository?

We preserve decisions and rationale, rejected alternatives, discoveries, research conclusions, design inspiration and maintained situational awareness. We do not duplicate code structure, file maps, ordinary task progress or information already implicit and quickly learnable from the repository.

For example, **how to run a release** belongs in a skill. **Why installed-artifact verification is necessary** can be a lesson. **Which release check is still running** belongs in working state.

Knowledge should improve judgment, not become a second source of increasingly stale project documentation.

## Our default: oats.okf

`oats.okf` uses **Open Knowledge Format**: readable Markdown concepts with metadata, navigation and history.

Our default model is **centralised and per soul**:

- A team selects a shared knowledge base.
- Each adopted soul has a stable knowledge home.
- Its instances consult accepted knowledge relevant to their work.
- Useful learning can benefit future instances of that soul.
- Other souls read or link to relevant concepts rather than duplicating them.

For example, several UX-expert instances can contribute learning to the same knowledge home while retaining their own investigations and working state. Adopting a public soul does not implicitly send private learning back to its publisher.

### How learning flows

1. **Instances work and capture evidence.**
2. **An independent harvester judges what is worth retaining.**
3. **Proposed knowledge is validated and delivered through the configured acceptance process.**
4. **Future instances can consult the accepted result.**

Ordinary working instances do not directly rewrite the accepted knowledge base. For Git-backed knowledge, delivery uses pull requests; an open PR is not yet accepted knowledge. Plain-directory storage has its own publication mechanism. A delivery receipt is not proof of human approval or that another instance has read the result.

The current capability requires explicit bindings and provisioning. The default model is not a claim that every setup step is automatic.

## Knowledge and learning, your way

The approach above is our default, not a requirement. **You can set up your own knowledge procedures and ways of working and learning.** OATS provides the contracts and a default implementation; you can adapt existing capabilities or write your own.

For example, you might want:

- **New instances to inherit accumulated expertise.** A new kernel-expert instance begins with relevant decisions and lessons from earlier instances.
- **Instances to develop their own specialisations.** Two UX-expert instances share a foundation, but one develops a deep understanding of checkout flows while another focuses on navigation.
- **Long-running instances to retain working understanding.** A customer-support instance carries its investigations, observations and unresolved questions across many tasks.
- **Selected learning to become shared knowledge.** Useful findings are reviewed and made available to other instances, while task-specific context stays with the instance that needs it.

Your knowledge capability determines what context an instance receives, how it builds on experience, and which learning is retained or shared. It can organise knowledge per soul, per topic or per project, centrally or alongside soul definitions, provided that it actually supports the chosen arrangement. Mutable knowledge must not be written into immutable captured source artifacts.

The same principle applies to messaging and tasks: **OATS provides the contracts; you choose how your team works through them.**

## Expertise can evolve

Per-soul knowledge does not have to become a permanent silo. Souls can grow their scope, transfer knowledge to a more appropriate home, merge or split into more specialised souls.

We call a deliberate split into new reusable specialisations **speciation**. An overall expert handling recurring UX work, for example, may provide evidence for a dedicated UX expert with its own skills and knowledge home. The overall expert can then consult that expertise rather than duplicate it.

These are changes to propose and review—not changes agents make to themselves automatically. A busy period or a large collection of notes is not enough on its own.

See **[Knowledge, instances and evolving expertise](docs/knowledge-theory.md)** for the detailed explanation of:

- Long-running instance expertise and working context.
- Per-soul and topic-based knowledge.
- Speciation, widening, merging and ownership changes.
- Harvesting, maintenance and acceptance.
- Context handoffs and cloning.
- Knowledge-capability contracts and their implementation boundaries.

## Getting started

Begin with a small team and a real piece of work:

1. Choose compatible models and harnesses.
2. Select the capabilities your team needs.
3. Define specialists with clear responsibilities.
4. Create instances for their assignments.
5. Verify that work, communication, learning and handoff behave as intended.

Start with the [first-team guide](docs/first-team.md) and the [release notes](docs/release-notes/) for the supported scope of your chosen versions.

Further documentation:

- [Souls and instances](docs/souls-and-instances.md)
- [Configuration](docs/configuration.md)
- [Capabilities](docs/capabilities.md) and [layer contracts](docs/layers.md)
- [Knowledge operations](docs/knowledge.md)
- [Knowledge, instances and evolving expertise](docs/knowledge-theory.md)
- [Packages](docs/packages.md)
- [Execution targets](docs/execution-targets.md)
- [OATS Desktop](docs/desktop.md)

This README explains the framework and its direction. Advanced mechanisms such as automatic speciation and context cloning require their own implementation and verification; the architectural model is not a claim that every feature or capability combination already works. Alternative knowledge layouts require a compatible capability, not a change to an undocumented kernel switch.

## Contributing and releases

Source, issues and pull requests live at [awebai/oats](https://github.com/awebai/oats). See the [implementation guide](docs/implementation.md) for repository details and the [release lane](docs/release-lane.md) for artifact verification and publication.

Versioned releases publish the kernel, Pi bridge and Desktop installers. Check the [release notes](docs/release-notes/) before changing an existing deployment; installing software does not automatically migrate knowledge or reconfigure live agents.

## Origins and licence

OATS began as **OAS—Open Agent Specialization**, designed and written by Josep (Pepe) Garcia-Reyero Sais. The architecture, kernel, package engine, Desktop and official packages are his work; OATS continues it under its current name.

OATS grew from the a2am team architecture and the LFX engineering vision for agent-native engineering. It builds on open formats and conventions, including AGENTS.md, Agent Skills and Open Knowledge Format.

OATS is free and [MIT-licensed](LICENSE). Models and services selected by a deployment may have their own licences and costs.
