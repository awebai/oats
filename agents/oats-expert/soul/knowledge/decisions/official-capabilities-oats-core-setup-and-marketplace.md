---
type: Decision
title: Kernel skills become official capabilities — oats.core, oats.setup and the reviewed official marketplace
status: accepted
description: The kernel-shipped operational skills are repackaged as two official capabilities: oats.core (day-to-day operation, declared explicitly on every soul by default and removable) and oats.setup (deployment/workspace configuration, held by an onboarding-created oats-setup-expert soul); the official marketplace is the reviewed package list kept in the oats repository, seeded with both plus the fundamental-layer capabilities.
tags: [distribution, capabilities, marketplace, onboarding, kernel, skills, souls, workspace]
timestamp: 2026-09-20
---

Decided with the founder, 2026-09-20, during the workspace-first adoption
plan (design doc `docs/design/2026-09-20-workspace-and-portable-adoption-plan.md`,
work package D1). Names locked
by the human: capability **`oats.core`**, skills **`oats-operate`** and
**`oats-souls`**; the setup capability is **`oats.setup`** ("OATS Soul Setup").
This is an accepted direction with a proposed mechanism; the implementation
lands through reviewed PRs, not by this record.

# Context

Under Portable Souls every soul declares its capabilities and where they come
from ([capability packages](capability-packages.md), [distribution
packages](distribution-packages-config-profiles-and-requirements.md)). Yet
the skills that teach an agent to *operate on OATS* — `oats`, `oats-config`,
`oats-packages` — were still hard-wired kernel skills (`lib/core.mjs` lists
them with `id: "kernel"`), and the "you run on OATS" injection was appended by
the kernel. That contradicts the model in two ways:

- A soul's definition did not show that it gets OATS operational knowledge;
  it appeared "by magic" and could not be removed or replaced.
- Distributing setup/config knowledge to a newly onboarded workspace had no
  carrier: the skills travelled with the installed kernel, not with a soul.

At the same time the "official marketplace" already exists as a mechanism —
`package-catalog.json` in the oats repository, read by
`officialPackageCatalog()` and used by `oats install`/`oats use` to resolve
capability ids to Git packages — but it was never stated as the *reviewed
list that defines officialness*, nor surfaced as a discoverable marketplace
in Desktop.

# Decision

## 1. Two official capabilities shipped from the oats repository

| Capability | Contents | Who has it |
|---|---|---|
| **`oats.core`** | Skill `oats-operate` (status, spawn, retire, doctor, lifecycle, instance layout); skill `oats-souls` (soul discovery, spawn relations/linkage, roster, workspace-member souls); the "you run on OATS" injection (former `injects/oats.md`) | Every soul **by default at creation time** |
| **`oats.setup`** | Former `oats-config` and `oats-packages` skills, workspace adoption and OATS Soul Setup guidance, package acquisition/trust/lock knowledge | The onboarding-created `oats-setup-expert`; any soul the operator adds it to |

Both are packaged like `oats.knowledge-theory`: a capability under the oats
repository's `oats-package/capabilities/`, exported through the repository's
`oats.yaml`/package manifest, versioned and locked like any other package.

## 2. `oats.core` is explicit, default, removable

- Soul-creation tooling (CLI, Desktop, setup guidance) writes
  `requires.capabilities.oats.core` with its source into the soul definition.
  The dependency is **visible in the file**, not injected by the kernel.
- The kernel does **not** silently add `oats.core` when it is absent. A soul
  without it is a valid, deliberately "OATS-unaware" soul.
- Users may remove or replace it at any time by editing the soul definition.

## 3. Kernel keeps its own contract; capabilities carry operation

- **Stays kernel-owned**: the `instance-boundary` injection ("your two
  directories"), work-mode briefings, config-declared injections. These
  describe the layout the kernel itself creates and hold regardless of
  capabilities ([instance home boundary](canonical-instance-home-and-work-boundary.md)).
- **Moves to `oats.core`**: the `kernel:oats` injection and the operational
  skills. **Moves to `oats.setup`**: configuration and package skills.
- Transition: the kernel's ambient kernel-skill list is retired only once
  soul definitions carry `oats.core`; until then the two coexist and doctor
  reports a soul that has neither.

## 4. Onboarding creates and instantiates `oats-setup-expert`

Onboarding a new workspace (or a fresh deployment of one) produces a soul
named `oats-setup-expert` whose definition declares **both** `oats.core` and
`oats.setup`, and instantiates it. The setup expert then drives the rest:
declaring/adopting member repositories, selecting fundamental-layer
capabilities, creating further souls (each getting explicit `oats.core`),
and explaining trust/approval steps to the operator. The sketch:

1. Operator installs the kernel and points it at a workspace repository (or
   declares a new one).
2. Onboarding resolves `oats.core` and `oats.setup` from the official
   marketplace, writes the `oats-setup-expert` soul definition with both
   declared, prepares/approves the artifacts under the normal approval bar.
3. The setup expert is spawned; from then on setup is a conversation with a
   soul that has the setup skills, not a wall of CLI flags.

No new bootstrap authority is introduced: prepare/approve/scaffold/start
remain the shipped path; onboarding only chooses the first soul and its
capabilities. Whether onboarding is a CLI verb, a Desktop flow or both is an
implementation choice reviewed separately — do not document a command that
does not exist yet.

## 5. The official marketplace is a reviewed list in the oats repository

- `package-catalog.json` (or its successor file) in `awebai/oats` **is** the
  official marketplace. A package listed there is official.
- Officialness is granted by a PR to that file, reviewed by the maintainer
  like any framework change — including for external packages. This is the
  safety gate: we control what is called official, even when we do not host
  the code.
- Official packages are discoverable by everyone: `oats` CLI resolution and
  the Desktop marketplace view/search present them as assignable to a soul.
  Discovery is not installation, and installation still goes through
  acquisition, lock and per-capability executable trust
  ([scoped store](scoped-capability-store-and-templates.md)).
- First entries: `oats.core`, `oats.setup`, and the fundamental-layer
  capabilities `oats.okf`, `oats.aweb`, `oats.authoring`, `oats.jira`,
  `oats.linear`, `oats.dev` (already present), plus `oats.knowledge-theory`.

# Consequences

- Soul definitions become honest about how an agent knows OATS; a soul can be
  exported, imported and reasoned about without a hidden kernel dependency.
- Setup knowledge travels as a soul, so a new workspace gets a competent
  setup agent rather than a document.
- The kernel shrinks: it no longer ships operational skills as ambient
  content. Kernel releases and capability releases decouple.
- The marketplace stops being an "interim folder" ([marketplace over
  bundled](marketplace-workmodes-runtime.md)) and becomes the governed list
  that decision anticipated, without a hosted registry.

# Open items (tracked in the plan, not decided here)

- Exact skill-content split between `oats-operate` and `oats-souls`, and
  what remains of `oats-getting-started`/`oats-support` (candidates for
  `oats.core` or plain docs).
- Whether `oats.setup` also carries the transitional setup-skill content
  that was removed from the kernel on the human's instruction (no kernel
  skill is recreated; the content, if kept, lives in the capability).
- Onboarding entry point (CLI/Desktop) and its interaction with the existing
  `oats init`/`oats use` compatibility path.
- Desktop official-marketplace view scope for the parity phase.
