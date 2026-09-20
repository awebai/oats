---
type: Decision
title: Proposed portable role editions and explicit bootstrap helpers
description: Propose stable parallel role exports with explicit adopter-bound knowledge destinations and a separately proven operator-root helper entry for cold bootstrap.
status: partially-accepted
tags: [architecture, portable-souls, source-identity, knowledge, bootstrap]
timestamp: 2026-09-20
---

# Status

**Partially accepted for implementation on 2026-09-20.** Under the approved
workspace-first plan, publish a transitional edition of the existing overall expert
at `souls/oats-expert/` in the framework repository, preserving its reviewed logical
owner and read/write routing rather than creating a new bootstrap owner. Publication
must precede importing an actual reviewed immutable revision. This is a bounded
phase1 source-layout slice, not the phase2 five-role/corpus cutover.

The remaining final-role policy choices and operator-root helper API below stay
proposed. Declaration/import examples alone do not qualify role execution, provider
readiness, releases or cold bootstrap. Existing independently reviewed code keeps
its scope; no helper authority is gained from this layout decision.

# Context

The [expert rebuild](/decisions/expert-souls-and-knowledge-rebuild.md) preserves five
roles and curated external knowledge while moving to portable source declarations.
Replacing live canonical sources before cutover would disturb stewardship and
unfinished work. Export paths also become part of qualified Git identities, so
choosing them is not merely a later alias rename.

The learning-oriented persistent assistant requires its knowledge provider. It is
not automatically an ownerless first-install helper. Creating a fictitious
persistent host solely to reach a helper would hide that distinction. The
[fresh rollout](/decisions/fresh-install-first-portable-rollout.md) needs an honest
bootstrap path without weakening captured source/helper authority.

# Proposed choices

## Stable parallel library exports

Publish explicitly indexed source editions at `souls/<role>/`, with definitions
at `souls/<role>/soul.yaml`, for the existing overall, kernel, Desktop, market and
assistant roles. Keep their established names, logical owner identities and
curated read edges. Each edition contains procedural AGENTS.md, relative
CLAUDE.md alias and its actual skill closure; durable knowledge remains external.

This is an explicit library-export layout, **not a new universal replacement for
project-local `agents/` conventions**. Leave canonical/live `agents/` sources and
preserved candidates unchanged until deliberate cutover. Freeze the new export
paths before registration. Imports remain by reference, not adopter-maintained
copies; parallel publication must not silently enable conflicting old/new writers.

Root `oats.yaml` may advertise the actual reviewed exports. A planned package root
must not be advertised as available before its contained source closure exists.
Helper-package adaptation remains a separate task from the persistent editions.

## Explicit knowledge destinations and optional authoring

These five editions explicitly require OKF because their chosen ownership/node
contract is OKF. That source policy does not make OKF mandatory for other souls
or change the [kernel/provider boundary](/decisions/kernel-and-providers.md).

Each binds the logical `stores.oats` reference supplied by the adopter, names its
owned-node destination explicitly, and preserves its specified cross-read edges.
A read edge grants no write. Do not borrow an ambient `write.default` or infer
write authority from a sole readable store. Private locators, runtime state paths,
settings and credential references belong to deployment configuration, not public
role sources. Distinct future read/write stores require an explicit source policy,
not an unnoticed reinterpretation of the one logical store.

The kernel role may use an optional, rebindable same-source authoring capability
default. Its retained curriculum must be reviewed independently; when absent,
report the missing skill rather than claiming it loaded. Do not duplicate the
persistent assistant's generated onboarding skill by also selecting its helper
package for the same skill contribution.

Grammar examples using `main` are not deployable release pins. Final publication
and cutover must use actual compatible immutable released revisions and truthful
package/capability floors. Do not invent tags or unsupported soul-version fields.

## A distinct operator-root helper entry for cold bootstrap

Keep the existing adopted-host route: select an actual source's exact helper edge,
scaffold the dedicated helper binding, and invoke its public lifecycle with that
SOURCE relationship. This remains useful, but does not prove cold bootstrap.

For a genuinely fresh bootstrap, propose a mutually exclusive `helper` alternative
to the existing `source` preparation input, identifying an exact capability source
and manifest-exported helper name. Reuse package acquisition, retained resources,
software choices, the single resolver, composition and native lifecycle. Do not
invent a persistent soul, parent or KB owner, or add a second preparation engine.

The first scope would be standalone directory work with knowledge, messaging and
tasks explicitly disabled and an existing simple helper definition. Do not broaden
helper-authored requirements/defaults/knowledge/teams/resources or bypass unsupported
runtime prerequisites to make bootstrap appear ready.

**A dedicated helper record alone is not public-root authority.** Propose a
producer-backed entry witness using the existing Choice/Origin representation,
with a reserved `/entry/helper` choice matching the exact retained Helper subject
and explicit operator selection. Its precise contract is not yet accepted.
Publication and admission must verify export/source/request provenance; a missing,
forged or transplanted marker must not turn a source-parented child into a root.
Existing helper contribution policies remain in force.

Parent-compiled children retain their actual SOURCE-edge requirement. Operator-root
helpers have no invented SOURCE parent and receive no authority to complete a
provider's source-owned run. Task/software approval, incarnation, receipts, cleanup
debt and both backend contracts still apply. If existing provenance checks cannot
prove this distinction, return the contract gap rather than weaken PB1 or add a
caller-controlled bypass flag.

# Decision and delivery boundaries

Human direction is needed on the three choices above. After acceptance, assign the
new role directories/export index as a bounded source-editing task; authoring and
helper-package changes remain separately scoped. The lifecycle owner must freeze
the new helper input/witness/publication/admission contract for independent review
before implementing it. No source or entry API change is authorized by this concept.

Preserve existing review closures instead of rerunning them as adoption evidence.
Actual combined-source, role/helper/runtime, both-backend, learning and provider
qualification remain required. KB acceptance and writer cutover follow
[external custody](/decisions/external-knowledge-custody.md): runtime Git knowledge
publication remains PR-only. Neither source release permission nor successful
syntax normalization approves a private binding, live writer or deployment.
