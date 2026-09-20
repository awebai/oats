---
type: Decision
title: Rebuild OATS knowledge in a dedicated repository around domain-expert souls
description: After the knowledge implementation is complete, create a separate OATS knowledge repository and rebuild domain-expert souls through a strict audit of current and inherited knowledge rather than bulk migration.
tags: [knowledge, souls, expertise, migration, roadmap]
timestamp: 2026-09-20
---
# Status and sequencing

**Sequence clarified by the human on 2026-09-20:** first put OATS development on
its shared Git-workspace and Portable Souls architecture, including the workspace
repository, member exports and usable local adoption. Then centralise the curated
knowledge and publish/adopt the five expertise souls; full Desktop parity follows.
The [execution plan](https://github.com/awebai/oats/blob/main/docs/design/2026-09-20-workspace-and-portable-adoption-plan.md)
defines bounded work packages and exit gates. Generic readiness gaps needed by
phase1 belong there; the default knowledge profile and corpus/roster cutover are
phase2. This accepts the order, not unspecified new contracts, source identities,
knowledge visibility or live migration effects. The [knowledge alignment proposal](/decisions/knowledge-alignment-before-expert-cutover.md)
and [workspace/package distinction](/decisions/git-workspace-versus-development-package.md)
remain scoped inputs to that plan.

Accepted human direction on 2026-09-13. **Execute after the current knowledge
implementation is complete and verified**, not as a parallel mass rename or
migration while its contracts are still being delivered. Record and plan this
phase now; no knowledge repository, new successor roster or destructive cleanup
has been created by this decision. A later explicit operator request permitted
provisioning the repository shell under temporary personal ownership pending
organization transfer; corpus migration and roster cutover still follow
implementation/deployment acceptance.

The human explicitly wants a separate Git repository for OATS knowledge,
expertise-oriented souls rather than engineer/developer-job-title souls, and a
carefully curated rebuild of useful knowledge from existing souls and notes.

# Target roster and boundaries

The intended domains below are accepted; `oats-kernel-expert` is the proposed
machine-readable spelling of the requested kernel expert role.

| Soul | Owns | Boundary |
|---|---|---|
| `oats-expert` | Overall OATS picture: what it is, motivations, vision, roadmap, cross-cutting architectural rationale, and planning changes with the human | Not a catch-all for every kernel fact, Desktop detail, or deployment's operational state |
| `oats-kernel-expert` | Deep kernel expertise, especially kernel-to-capability contracts, their rationale, compatibility decisions, deliberate constraints and technical tradeoffs | Formal current API definitions stay in their canonical code/spec/docs; knowledge explains decisions and hard-won lessons, not a second API manual |
| `oats-desktop-expert` | Desktop expertise: product/interaction decisions, design rationale, limitations, rejected approaches, and relevant integration judgments | Not a renamed engineer containing a map of Desktop code; implementation descriptions remain with the repository |
| `market-research-expert` | Competitor research, sourced comparisons, how OATS stacks up, product positioning evidence and opportunities | Date and cite evidence; distinguish verified facts, hypotheses and recommendations; maintain comparisons rather than preserving stale market assertions |
| `oats-assistant` | User-facing OATS onboarding, helping people adopt/configure OATS and find the right expertise or procedure | Must be spawnable by users, not only a repo-local maintainer. Use canonical docs/skills; user-specific deployment state stays with that deployment |
| `knowledge-theory-expert` | Previously agreed optional authoring help for the reference knowledge model and knowledge capabilities | Does not become a universal harvester, runtime dependency, compulsory approval gate, or substitute for canonical theory docs |

Additional souls may be recommended only for a genuinely separate expertise
need discovered during the audit. Do not keep old names merely to preserve the
roster, add an expert per source module, or proliferate overlapping roles.

**No engineer souls or engineer-expert roles in the target roster.** Expertise
rather than a generic implementation job defines the soul. This is a substantive
redesign of responsibilities and curriculum, not a string replacement from
`engineer` to `expert`. It does not imply experts cannot implement changes when
assigned; task work and durable specialization are different concepts.

# Dedicated knowledge repository

- OATS knowledge has its own Git repository, separate from framework code and
  soul definitions. The exact remote/name is chosen when the phase executes;
  `oats-knowledge` is a working name, not an already-created repository.
- Bind it through the new knowledge capability's location contract. Souls
  contain role/curriculum and logical declarations, not durable knowledge.
- Organize owned nodes around the accepted domains with cross-node reads and
  one canonical home per concept. Cross-cutting direction belongs to
  `oats-expert`; specialists consult it rather than copying it.
- Git-backed knowledge delivery uses the accepted PR path. Verify publication
  and fresh-reader visibility before declaring cutover complete.
- Formal repository documentation and procedural skills remain their own
  canonical surfaces. The knowledge repository must not become a mirror of
  framework docs, code, or onboarding command manuals.

# Audit all existing souls and source material

Inventory the current roster before choosing successors: committed soul
instructions, skills and knowledge; pending instance notes and harvest inputs;
relevant retained findings and decisions. Identify inherited OAS material
explicitly. Do not assume it became correct for OATS through a name change.
Do not presume every existing soul deserves a successor.

For each candidate record a disposition and rationale:

- **Keep:** current, useful expertise with a clear owner and canonical home.
- **Rewrite:** a useful decision or lesson survives, but its framing, scope or
  assumptions must be corrected against current OATS.
- **Merge:** equivalent claims consolidate into one concept; other readers
  receive pointers rather than copies.
- **Route elsewhere:** a repeatable procedure belongs in a skill; a formal
  contract/navigation hint belongs in repository docs; a preventable defect
  belongs in code/tests with, at most, a temporary lesson naming its real fix.
- **Drop:** code-derived descriptions, task/session residue, obsolete facts,
  unsupported conclusions, unwanted legacy concepts and duplicate material.
- **Unresolved:** a concrete owner must resolve the evidence or scope question
  before promotion. Uncertainty is not permission to populate a permanent attic.

The promotion test is deliberately strict:

1. Would this change how a future instance of the intended expert works?
2. Does it contribute judgment, rationale or a discovery beyond what current
   code and canonical docs already say?
3. Is it still relevant to the OATS actually delivered at cutover, rather than
   a superseded OAS/OATS design or an abandoned tool/workstream?
4. Can it be expressed accurately with provenance, one home and any needed
   freshness/ownership discipline?

Preserve rationale behind rejected alternatives only when it still prevents a
plausible future mistake. Do not retain historical machinery simply because it
once mattered. A maintained roadmap or area-level slow-state concept needs a
clear owner, date and update-on-change rule; raw PR/release/task ledgers do not
become expertise by moving to a new repository.

**There is no bulk copy and no legacy/archive bucket in the active KB.** Old
Git history or a controlled pre-cutover recovery snapshot preserves rollback
options; it is not automatically part of future agents' retrieval context.
No secrets, credentials, raw transcripts or deployment-specific account/host
state are carried into the shared OATS knowledge repository.

# Execution and acceptance

1. Finish the framework/OKF implementation and its real delivery/learning gates.
2. Inventory sources and propose the final domain/owner mapping, including
   overlaps, retirements and genuinely necessary extra roles.
3. Preserve pending evidence and establish a stable cutover baseline; coordinate
   old writers and live instances rather than renaming their homes underneath
   them or allowing old harvest jobs to keep writing to retired destinations.
4. Set up the dedicated repository and new soul definitions/declarations;
   build the KB from audited keep/rewrite/merge results through reviewed changes.
5. Test each role with representative questions. Confirm correct index-first
   or provider-native consultation, cross-node reads, fresh-instance expertise,
   and practical user-facing onboarding by `oats-assistant`.
6. Cut over bindings/curricula only after accepted knowledge is available.
   Decommission old souls/paths in a separately verified cleanup after pending
   work is safe; preserve framework lifecycle and instruction/symlink rules.

Done means a coherent expert roster backed by a small, useful, current OATS
knowledge base—not a green validator over renamed legacy folders. Structural
validation is necessary; semantic review against current OATS is the main gate.

# Related direction

- [External knowledge custody](/decisions/external-knowledge-custody.md).
- [Reference theory and capability autonomy](/decisions/provider-neutral-knowledge-and-harvest.md).
- Implementation sequence: `docs/design/2026-09-13-knowledge-implementation.md`.

# Citations

1. Direct human follow-up during implementation, 2026-09-13: after completion,
   create a separate OATS knowledge Git repository; replace engineering-role
   souls with domain experts; separate overall stewardship from kernel-depth
   expertise; add market research and a spawnable onboarding assistant; inspect
   existing soul knowledge and notes, strictly retaining only useful current
   expertise and discarding code-owned descriptions and unwanted OAS legacy.
