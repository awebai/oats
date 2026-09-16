---
type: Decision
title: OATS provides a reference knowledge theory while capabilities own runtime behavior
description: OATS maintains canonical default knowledge theory and an authoring expert, while each knowledge capability supplies its complete runtime behavior and may choose a different theory.
tags: [knowledge, memory, harvest, providers, architecture]
timestamp: 2026-09-16
---
# Status

Accepted on 2026-09-13 and explicitly reaffirmed on 2026-09-16: **OATS provides
contracts; knowledge capabilities and harvesters provide functionality.** The
reference theory is opinionated and adoptable, not one mandatory semantic model.
Git-backed and directory-backed OKF plus optional reference-authoring support
have since been delivered. Portable captured-provider/lifecycle integration and
its live acceptance remain in progress; they are not implied by the earlier release.

# Context

The first location draft coupled knowledge to OKF files and Git. The next
iteration separated theory from tools but proposed mandatory common runtime
protocols and doctrine across integrations. The human clarified that users may
choose different knowledge approaches: OATS should teach and exemplify its
preferred framework without making that framework a universal provider policy.

# Decision

1. **OATS owns a well-defined reference theory, not every capability's theory.**
   Canonical repository documentation explains the default knowledge/memory
   distinctions, consultation, capture, expertise and harvesting doctrine.
   It is tool-independent and available to people and capability-authoring
   agents. The default OKF capability follows it. Other capabilities may adopt
   it, adapt it or choose a different knowledge model.
2. **OATS supplies canonical authoring guidance for injections and skills.**
   The theory is made actionable through documented instruction/skill patterns
   and examples. Authors can point their agents at this material. It is not
   automatically injected into all running instances, and no compulsory shared
   theory-runtime dependency is introduced.
3. **Provide a `knowledge-theory-expert` agent for capability authors.** Its
   remit is to explain the reference theory, help map it to a chosen tool,
   design complete capability instructions/skills/harvesting, and make gaps or
   deliberate departures explicit. It is an authoring aid, not a runtime
   dispatcher, universal harvester, required approval service, or replacement
   for canonical docs. The optional reference-authoring capability supplies this
   role; consuming a knowledge provider does not require running it.
4. **Each capability owns its complete runtime package.** It supplies its own
   skills, injections, instance-memory/capture conventions, reader tools,
   harvester and harvest protocol where applicable, lifecycle contributions,
   validation and delivery behavior. It may explicitly reuse resources through
   ordinary supported packaging, but OATS does not force shared doctrine into
   its runtime or silently update it when reference docs change.
5. **The first working version includes Git-backed OKF and a non-Git store.**
   Non-Git must work, not be merely an interface or a roadmap item. In this
   default-theory workstream Git-backed knowledge uses PRs; non-Git storage
   uses native delivery, without pretending to have branches or commits.

# Boundaries

- The [kernel/provider contract](/decisions/kernel-and-providers.md) remains
  generic: layer selection, configuration, lifecycle, runtime composition,
  declared operations and executable trust. Provider autonomy does not weaken
  those framework contracts, work-mode boundaries or repository governance.
- Memory kinds, ownership/nodes, promotion judgment and a harvester belong to
  the reference model and the capabilities implementing it, not mandatory
  fields or algorithms in the kernel.
- Behavioral examples/tests express what it means to follow the reference
  model. They are default-OKF acceptance tests and reusable authoring aids,
  not a compatibility gate excluding an alternative theoretical approach.
- A theoretical or authoring question can be answered from docs without
  instantiating the expert. Operating an installed capability must not depend
  on the expert being alive or on fetching mutable reference docs at runtime.

# Concrete example and open work

An Omnigraph capability could adopt the OATS reference theory: an author points
its coding agent or `knowledge-theory-expert` at the canonical docs, maps the
concepts to the tool, and ships that capability's own CLI instructions,
injection, skills and harvester. This does not assert that the CLI or storage
semantics have been investigated. Choosing different knowledge behavior also
remains valid, with that capability documenting its own contract.

Reference authoring and the default Git/directory OKF implementation are delivered;
they are not still open backend choices. Remaining work concerns captured provider
integration, fresh-deployment/lifecycle acceptance and deliberately chosen additional
providers. Omnigraph remains an illustrative alternative, not an investigated or
required backend. The exclusive knowledge layer is unchanged; mixed integrations
in one instance are a separate question, not implicit in replaceability.

# Contract versus capability functionality

The same boundary applies to knowledge as to [messaging](/decisions/messaging-capability-contract-boundary.md).

- **Kernel contracts:** selected provider and exact approval, captured source/instance
  context, versioned opaque binding/invocation inputs, lifecycle ordering and required
  outcomes, generic native evidence services where applicable, independent helper/job
  execution, retained authority and cleanup/custody obligations.
- **Capability functionality:** knowledge model/schema, storage/query/read views,
  episodic conventions and input selection/freezing, harvester implementation and
  prompts, promotion policy, validation, retries, delivery and acceptance semantics.

Native capture/recall can be a framework substrate; the capability decides whether
and how to use it. No universal kernel harvester, mandatory STATE/log/notes layout,
OKF node/store model, promotion algorithm or Git publisher follows from these
contracts. Default OKF keeps its existing promotion and PR-only Git delivery rules.
Provider autonomy does not weaken repository governance, work boundaries, secret
exclusions, exact approval or truthful lifecycle outcomes.

Helper memory/injection behavior and source handoff fields must be reviewed as
capability-owned behavior or explicit neutral contracts, not accidental OKF policy
hardcoded into the new captured path. Do not blindly enable recursive harvesting
or weaken existing guards while correcting that boundary.

# Related decisions

[External knowledge custody](/decisions/external-knowledge-custody.md) records
the default rework's relocation, instructional no-direct-write, independent
harvest, PR-only Git delivery and initial account-access assumptions. The
location draft must not turn that workstream's choices into extra kernel
requirements for all third-party knowledge capabilities.

# Citations

1. Direct human direction, 2026-09-13: require working Git-based OKF and non-Git
   knowledge, separating the theory from storage/access tools; Omnigraph CLI
   is a motivating example of adopting the same theory with different tools.
2. Subsequent human amendment, same discussion: OATS provides canonical
   knowledge-theory docs for injections/skills and a knowledge-theory-expert
   agent; default OKF follows the theory; each capability supplies all its
   runtime material; users may choose different knowledge approaches.
3. `docs/2026-09-03-architecture-proposal.md`, The slot contracts and Three
   simplifications: provider-owned implementation and capability-supplied agents.
4. Current proposal: `docs/design/2026-09-13-knowledge-location-contract.md`.
