---
type: Decision
title: Roster amendment (Phase D) — an operator expert and an integration expert own nodes; developers declare a promotion target; recipes pass when they encode external-system judgement; cross-project seams are named
status: accepted
description: ACCEPTED (2026-09-24 — the human delegated the decision to the lead and the OSS coordinator: "use your best judgement, reaching a decision with Antares") after the OSS coordinator's operating review of the five-soul roster. Two additions to the roster (oats-setup-expert becomes the deployment OPERATOR expert and owns a node; integrations-expert stays as the cross-package PROVIDER-INTEGRATION expert and owns a node), one non-addition (release/steward is a Playbook in oats-expert, not a soul), one routing rule (every developer role declares the expert node its lessons promote to), one theory refinement (keep a recipe when it encodes judgement about an external system's behaviour), one seam (how a node in another project's base is read).
tags: [decision, roster, knowledge, centralisation, phase-d, operator, integration, seams]
timestamp: 2026-09-24
---

## Context

The five-soul decision (2026-09-21) fixed the roster as the reviewed experts
(`oats-expert`, `oats-kernel-expert`, `oats-desktop-expert`, `oats-assistant`,
`market-research-expert`) plus `oats-setup-expert`, which owns no knowledge;
developer roles are ephemeral and hold no node. Phase D adds six package
experts. Before Phase D's roster work the human asked the lead to consult the
OSS coordinator (Antares), who has operated a two-team deployment through the
0.25.x rebuild round, run provider work through developer children, and
verified every release — with the knowledge theory laid out in full so the
recommendation would land against it (or push back on it).

The recommendation, anchored point by point in that week:

## What was recommended, and the lead's disposition

1. **Deployment operator expert — a real node.** Rebuilding a deployment
   produced ten guide/kernel disagreements; consolidating credentials across
   machines, placing the messaging root where the hook looks, keeping OKF
   state outside every work tree, owner pins by soul id, custody directories
   as host facts, cutover sequencing — none derivable from the repository,
   all universal once names are stripped, and **unowned**: `oats-expert`'s
   stewardship is a log of what happened, not operator knowledge, and
   `oats-setup-expert` owns nothing by decision. Recommendation: give the node
   to `oats-setup-expert` (rename `oats-operator-expert` if wished). Content:
   the rebuild/onboarding rationale, migration judgement, multi-machine
   layout, cutover sequencing, the outsider-verification method. Ownership
   test passes — every onboarding exercises it.
   **Lead: accept.** This is the node the OSS side most needs and the one that
   rots today for lack of an owner. Amends decision 1 of the five-soul record
   ("owns no knowledge" → owns the operator node).
2. **Provider-integration expert — a real node, already exists as
   `integrations-expert`.** Five review rounds on one provider, three from a
   live rehearsal, produced cross-package integration discipline (rehearse
   before approving; what a live acceptance must cover; how compensation must
   report; a hook never takes a locator from the ambient environment because
   the operator can be another instance). Folding into `oats-kernel-expert`
   puts integration judgement with kernel internals; folding into the aweb
   package expert loses the cross-package part. Both developer children this
   week were rightly spawned from this soul.
   **Lead: accept.** The six package experts own their package's FACTS and
   read this node. Amends the five-soul record (the roster becomes seven
   experts + `oats-assistant`/`market-research-expert`).
3. **Release/steward expert — a role, not a node.** Release authority is
   authority plus a procedure; that is a Playbook in `oats-expert`'s
   stewardship area, read by whoever holds the authority.
   **Lead: accept** (and today's two version-literal and landing-order lessons
   are its first entries).
4. **Developers hold no node — right, with a routing rule the theory lacks.**
   It worked this week only because the developers were spawned from an
   expert soul. Developer roles spawned from a package (`oats.dev`: cli-dev,
   desktop engineer, docs, ux) have an ephemeral spawning soul and their
   lessons have no target — "promoted into an expert node or not at all"
   resolves to "not at all" for exactly the roles that learn the most. Rule:
   **every developer role declares its promotion target** (the expert node
   whose domain it works in) in its soul definition; the harvester delivers
   there as a PR the owning expert reviews.
   **Lead: accept**; this is a soul-definition field (`promotesTo: <node>`)
   and a harvester delivery rule — Phase D W9b/oats.dev work.
5. **Cross-project seam.** The aweb identity/custody program is bigger than
   the `oats.aweb` package; its expert lives on the aweb side. The `oats.aweb`
   package expert must READ that node; the OSS side must read the OATS
   operator and integration nodes. Otherwise the two rosters re-derive each
   other's decisions (three rounds of identity design this week re-derived a
   model written down on 2026-08-12).
   **Lead: accept as a Phase D requirement**: a node in another project's base
   is read through a read-only store reference in the workspace (OKF `reads`
   across bases); two of the six package experts (aweb, okf) sit on such seams
   and their charters name them.

## Pushback on the theory, and the lead's answer

- *Reject list drops "command/test recipes" wholesale; the acceptance sequence
  for a grant-serving hook is a recipe AND the expertise.* **Accepted as a
  refinement of the two-part test**: keep a recipe when it encodes judgement
  about an external system's behaviour that a competent engineer reading the
  code still gets wrong; reject it when the code says the same thing.
- *"A node without a soul that will keep it honest rots" is the argument FOR
  the operator node.* Agreed — see 1.
- *Two of the six package experts sit on seams; name the seam or they own less
  than their title says.* Agreed — see 5.

## Decision (accepted 2026-09-24, lead + OSS coordinator under delegated authority)

Roster after Phase D: `oats-expert`, `oats-kernel-expert`, `oats-desktop-expert`,
**`oats-operator-expert`** (was `oats-setup-expert`; owns the operator node),
**`integrations-expert`** (cross-package provider integration; owns a node),
`oats-assistant`, `market-research-expert`, plus the six package experts (okf,
aweb, jira, linear, authoring, dev — the aweb and okf charters name their
cross-project seams). Developer roles remain ephemeral and each declares
`promotesTo`. Release stewardship is a Playbook, not a soul. Both new nodes
are seeded in Phase D slice 1 from this week's harvested material plus the
operator/integration concepts the bundle migration surfaces.

Nothing here changes slice 1's start; the bundle migration proceeds and the
two new nodes are created alongside.
