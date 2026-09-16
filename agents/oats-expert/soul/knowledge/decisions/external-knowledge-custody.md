---
type: Decision
title: Knowledge leaves souls and Git-backed harvesting delivers through PRs
description: All durable knowledge moves outside souls, working instances receive an instructional write prohibition, and independent harvesters propose Git-backed updates through pull requests.
tags: [knowledge, memory, custody, architecture]
timestamp: 2026-09-16
---
# Status

Accepted direction from 2026-09-13. The default OKF Git/directory stores,
source-independent harvesting and PR delivery have since been implemented and
released; portable-provider integration and curated soul/knowledge cutover remain
unfinished. Existing legacy soul bundles are preserved until actual cutover.
The current [fresh-install-first rollout](/decisions/fresh-install-first-portable-rollout.md)
defers general historical conversion without permitting data loss. The original
scoping questions retained below are historical; current Portable Souls contracts
and subsequent decisions govern implementation.

The subsequent [reference-theory ruling](/decisions/provider-neutral-knowledge-and-harvest.md)
clarifies scope: these are the default knowledge rework's choices, not extra
kernel policy imposed on every third-party knowledge capability. Capabilities
may choose other theoretical models and own all of their runtime material.

# Context

The central knowledge direction combines knowledge relocation, automatic
harvesting, writer authority, and delivery. Scoping exposed ambiguities about
portable expertise, mechanical write enforcement, dependence on the source
instance's worktree, and direct-commit versus PR custody.

# Decision

1. **All knowledge leaves the soul.** There is no retained knowledge bundle
   inside a soul, including for general expertise. Knowledge may still be
   specialized for a soul; its durable location is external. This rules out
   the option of keeping reusable knowledge inside the soul while moving
   only project knowledge. Skill placement was not changed by this ruling.
2. **For now, the working instance's write prohibition is explicit OKF
   injection guidance.** It is not a claim of filesystem isolation or
   mechanical refusal through arbitrary shell commands. Completion tests
   must test the promised instruction contract, not an unimplemented sandbox.
3. **Harvesting is independent of the source instance's context.** The
   harvester's execution and destination custody must not depend on the
   source worktree, branch, or work mode. The source remains evidence and
   provenance, not the execution environment. The exact durable input and
   retirement handoff mechanism remains to be designed.
4. **Git-committed knowledge is delivered through pull requests.** This
   applies whether the base is embedded in a code repository or lives in a
   dedicated knowledge repository, and whether that repository is public or
   private. No private-repository or attached-worktree direct-commit exception.
   Non-Git knowledge is a separate, required initial custody case; its concrete
   backend and delivery semantics are still to scope (see
   [provider-neutral knowledge and harvest](/decisions/provider-neutral-knowledge-and-harvest.md)).
5. **Initial repository access relies on users' GitHub accounts.** Assume
   all agents in a workspace/team have access to its configured knowledge
   repositories. Do not implement a public/private distinction, per-agent
   repository ACLs, or disclosure-routing policy in this version. `reads`
   selects initial context; `owns` defines maintenance and promotion routing;
   neither grants GitHub permissions. This later same-day simplification
   removes the proposed audience/declassification design from initial scope.

# Consequences

- The earlier direction's physical refusal test and private-repository
  direct-commit option are superseded as implementation requirements.
- The existing attached-harvest mechanism is not the target design for
  Git-backed knowledge, even when source code and knowledge share a repo.
- General and project expertise can have distinct canonical destinations
  outside the soul without requiring a new permission model. Repository
  visibility classification is deferred, not implemented by knowledge bindings.
- GitHub access failures are reported, not bypassed or treated as permission
  to deliver somewhere else. Existing secret/credential and third-party-verbatim
  exclusions remain; they are not a public/private repository classification.
- Source modes and soul locality cannot choose knowledge publication policy.
- The location contract must handle both embedded and dedicated knowledge
  repositories, including public and private repositories used together.

# Open design

A separately proposed location contract considers named bases, soul-owned
nodes, deployment bindings, provider-native reads and writes, independent input
snapshots, and explicit delivery outcomes. Git-backed delivery uses PRs and the
user's GitHub access; non-Git storage uses its native tools and access. Its
exact schema and lifecycle mechanisms have not been accepted yet. The earlier
proposed public/private disclosure policy is explicitly deferred, not a
prerequisite.

[Provider-neutral knowledge and harvest](/decisions/provider-neutral-knowledge-and-harvest.md)
records the subsequent requirement for a working non-Git store alongside
Git-backed OKF, and the separation of common theory from concrete storage tools.

Questions still requiring agreement include: base identity and alias
resolution, context selection and promotion destinations, PR targets, local
custody, cross-base links, reader refresh, and retention of inputs until
delivery obligations close.

# Supersession and related context

The [memory design](/architecture/memory-design.md) and
[knowledge typology](/architecture/knowledge-typology.md) describe the earlier
physical soul-bundle convention. Their capture/judgment and
invariance/indexicality rationale survives; their placement and harvest
mechanisms must be read as current/historical implementation, not the new
accepted target. The [soul symlink rationale](/decisions/soul-knowledge-symlink-rationale.md)
remains history, not a reason to keep knowledge inside souls.

# Citations

1. Direct human scoping direction, 2026-09-13: all knowledge leaves the soul;
   write prohibition is explicit OKF injection guidance for now; harvesting
   is independent of instance context; Git-committed knowledge uses PRs;
   embedded/dedicated and public/private bases require a clean location
   contract.
2. Repository direction: `docs/design/2026-09-13-knowledge-and-memory-direction.md`.
3. Storage contract proposal (not accepted):
   `docs/design/2026-09-13-knowledge-location-contract.md`.
4. Subsequent direct human simplification, 2026-09-13: permissions rest on users'
   GitHub accounts; assume all workspace/team agents can access the knowledge
   repos; defer the public/private distinction to keep initial scope simple.
