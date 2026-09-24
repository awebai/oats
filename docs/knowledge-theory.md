# Knowledge, instances and evolving expertise

This is the canonical explanation of OATS’s knowledge and specialisation model, consolidated from the founder’s knowledge doctrine, the September 16 topology/speciation exploration and the subsequent design decisions of September 19, 2026.

The [README](../README.md) introduces the framework. This document explains the reasoning behind its default knowledge model and the freedom other capabilities must retain. It records design direction, not a claim that every mechanism is implemented; see [implementation boundaries](#implementation-boundaries).

## The central distinction

> **A soul defines a reusable specialisation. An instance develops expertise in a particular situation. Knowledge preserves learning that should survive that situation.**

OATS separates these things so that a team can retain useful learning without making its expertise inseparable from one conversation, machine, model or knowledge system.

- A **soul** is an enduring identity and reviewed curriculum: responsibilities, boundaries, capabilities, skills and knowledge interests.
- An **instance** is a particular working continuity, with its own assignment, context, state and lifecycle.
- A **knowledge capability** determines how relevant knowledge is provided, how experience is captured and how learning is retained or shared.

The soul is not the complete mind of a running agent. Nor is its definition a place to paste everything an instance has learned.

## Instances can be short-lived or long-running

An instance is not necessarily a single task or chat session. An assignment may span many tasks and supported session continuations.

Short-lived developer and reviewer instances are useful for bounded implementation work. Longer-running instances of expertise souls are useful for planning, investigation and sustained work on a domain. These are examples, not rules preventing experts from implementing changes or temporary instances from producing valuable learning.

Over time, an instance may develop:

- Familiarity with the systems and people relevant to its assignment.
- Verified observations, provisional hypotheses and unresolved questions.
- An understanding of what has already been tried and why it failed.
- Effective procedures and a sense of which details matter together.

This is **situated expertise**. It is valuable even when some of it belongs only to that assignment.

“Disposable instance” describes a lifecycle possibility, not a recommendation to discard context frequently. Retirement should preserve required learning, work and handoff evidence. Duration alone does not turn an instance into a soul.

### Four different kinds of value

| What an experienced instance offers | Home in the reference model |
|---|---|
| Reusable workflows and practical know-how | Reviewed skills and capabilities |
| Durable judgment and awareness of the larger picture | Accepted knowledge |
| A working understanding of the particular problem | Instance context |
| Unfinished work, current experiments and next steps | Instance state |

The same investigation can produce all four. A new verification procedure may become a skill; the reason it is necessary may become a lesson; the current experiment and next action remain local state.

Persistence is not the only distinction. Information may remain useful for months and still be specific to an investigation. Conversely, a narrowly applicable lesson may deserve preservation because an appropriate future instance will need it.

## Shared souls do not imply identical instances

Several developers can use instances of the same semantic-layer expert. One studies revenue definitions, another investigates performance, and another supports a warehouse transition.

They share a specialisation but develop different working understanding. A person may have several instances; one instance may handle many tasks. Neither relationship needs to be one-to-one.

A shared knowledge base is not a shared active mind. Making a finding available does not mean every instance has read or understood it. In the reference model, instances obtain relevant orientation at session start, after context compaction and when a decision may already have been made. They fetch detail selectively rather than loading the whole base.

The knowledge capability can choose different conventions for that reading and refresh process. It also determines which experience remains with an instance and which becomes available to future instances. It does not redefine the kernel’s source or instance identity.

## What deserves to become knowledge

> **Knowledge is what makes an expert an expert in a subject or project. It is not a description of what lives in the code.**

Code is the truth about code. A stored description of modules, functions or configuration competes with the repository and becomes misleading when it drifts. Information already implicit and quickly learnable from the repository should not be duplicated in a knowledge base.

The reference promotion test asks:

1. **Would an appropriate future instance act differently for knowing this?**
2. **Could it not have obtained this simply by reading the repository?**

Both should be yes. Appropriate does not mean every instance: specialised learning can be valuable without becoming everyone’s initial context.

### Preserve judgment

The reference model accepts:

- **Decisions and rationale:** what was chosen, why, and whether it is deliberate or a stopgap.
- **Rejected alternatives:** what was considered and why it did not fit.
- **Architectural judgment:** why a boundary exists, not a second map of its implementation.
- **Direction and priorities:** what the project is trying to become and the reasoning governing it.
- **Discoveries and limitations:** findings that required investigation, with scope, evidence and solutions that worked.
- **Research conclusions:** conclusions rather than transcripts, with uncertainty and recheck conditions where needed.
- **Design inspiration:** what informed a design and which failures shaped it.
- **Review and process patterns:** verified judgment that code alone does not communicate.
- **Maintained slow state:** a dated interpretation of an area that orients future work.

Human-accepted decisions pass the promotion bar by construction. Preserve their meaning, scope and acceptance evidence rather than having a harvester re-judge the person. This does not remove confidentiality, provenance or duplication checks.

### Keep the larger picture, not a second issue tracker

A useful slow-state record might explain:

> We are replacing approach A with B because of this limitation. These parts are established; this unresolved question prevents the next stage.

It must have a clear scope, a responsible maintenance process, an as-of date and an update or supersession rule. An owning soul’s role is to consume the relevant context and capture evidence; ownership does not make each working instance responsible for directly maintaining the base.

The task tracker remains authoritative for issue status. Knowledge can link a decision to the work that established it, or explain why a blocker matters, without copying lists of open issues into permanent prose.

### Put other material elsewhere

| Material | Appropriate home |
|---|---|
| Shared project facts, API contracts and code navigation | Repository code and documentation |
| Repeatable operational steps | Skills |
| Why an approach works and when its trade-offs matter | Knowledge, if it passes the promotion test |
| Current investigation, provisional reasoning and next action | Instance context and state |
| Raw records and notes awaiting judgment | Evidence, not accepted knowledge |

A reasoned approach can be a Playbook; a bare sequence of commands belongs in a skill. If an insight already has an authoritative home, point to it rather than copying it.

Exclude secrets, improperly disclosed private material, indiscriminate third-party message copying, tool noise and ordinary task residue. A review pattern may cite the verified, disclosure-appropriate evidence that established it; that is not permission to ingest messages wholesale.

If code, a test or a clearer contract can eliminate a recurring problem, pursue that fix. A knowledge entry is not a substitute for removing a preventable defect.

“Invariant across incarnations” means useful beyond its author, not true for every task forever. Date and scope contingent claims. Supersede changed decisions explicitly rather than leaving contradictory truths or erasing their history.

## Default organisation: centralised and per soul

The chosen default is a shared knowledge base with a stable knowledge home for each adopted soul. It provides a simple starting point without requiring a team to design a topic taxonomy first.

```text
A team's chosen knowledge base
  kernel-expert
  ux-expert
  customer-support-expert
```

This is an illustrative organisation, not a kernel schema or a requirement to use those folder names.

- Instances of a soul consult its accepted expertise and relevant shared material.
- Their harvests have explicit destinations; task context is not published wholesale.
- A claim has one canonical home. Other readers use references rather than copies.
- A public soul’s publisher does not become the default recipient of an adopter’s private learning.
- Knowledge identity and lifetime must not depend on one instance or merely on a changeable display name.

In the reference model, **owns is harvest routing**, not personal authorship, an access right or a duty for ordinary souls to keep the base honest. **Reads is context selection**, not an access list. Actual repository/service access still governs what can be read.

Centralisation simplifies the initial destination of a harvest. It does not remove the need for judgment, deduplication, freshness or acceptance.

## Per-soul knowledge can evolve

Fluidity depends on being able to revise expertise boundaries, not on naming the top-level collections after topics rather than souls.

### Grow without creating another soul

A kernel expert starts with decisions about capability boundaries and execution authority. Its knowledge later develops sections for runtime behaviour, capabilities and packaging.

It can remain one soul if its instances routinely need those subjects together. A large collection or a new section is not sufficient evidence for a split.

### Split a recurring specialisation

An overall expert initially handles project direction and some UX work. Over time, UX assignments consistently require different skills and reading context.

A reviewed change can establish a UX-expert soul:

```text
Before                              After
project-expert                      project-expert
  direction                           direction
  UX decisions                        reads UX expertise
                                    ux-expert
                                      UX decisions
```

The specialist material has one canonical home, not a copy in both collections. Role instructions, skills and knowledge declarations are reconciled together.

### Merge or widen

Separate CLI and runtime experts may repeatedly need the same knowledge and skills. Their boundary may create more handoffs than useful specialisation.

A reviewed change can consolidate them into a kernel expert. Reconcile overlapping claims, preserve provenance and references, and deliberately retire or revise the former definitions. Do not concatenate conflicting collections and call the result accepted knowledge.

### Reassign a concept without changing the roster

A kernel decision may initially land with the overall expert because that instance investigated it. Moving its canonical home to the kernel expert need not create a new soul. Other readers keep access through the capability’s supported reference or migration mechanism.

## Speciation: changing the reusable specialisation

**Speciation is one soul becoming two or more because a distinct, reusable specialisation has emerged from its work.**

Useful signals include:

- Sustained differences in the skills instances need.
- Sustained differences in the knowledge they consult and produce.
- A recurring class of work that would benefit from a different charter.

Repeated spawning is evidence, not a requirement. One long-running instance can handle recurring specialised work without ever being replaced. The counterfactual is more useful than a spawn count:

> Would we deliberately want future instances to start with this narrower charter, skill set and reading context?

A busy fortnight, an epic ending or a large set of notes is not enough on its own. Widening or retaining the existing soul may be the right conclusion.

Harvesters can supply evidence. Maintenance can compare it across instances and propose changes. A person accepts structural change in the reference model; any future auto-acceptance policy needs separate agreement and evidence. Souls do not split themselves.

There is no need for a separate “geneticist” agent with the same inputs and responsibilities as the knowledge maintainer. Drafting a soul can be a skill used during a maintenance proposal.

### Maintenance is a responsibility, not a compulsory background agent

Separate two kinds of judgment:

| Responsibility | Focus |
|---|---|
| Harvesting | What an instance’s evidence contributes to accepted knowledge |
| Maintenance | Consistency, freshness, structure, ownership and declarations across the base |

A maintainer must not silently accept a structural change merely because it proposed it. A human can initially perform maintenance; automated maintenance is an additional capability behaviour, not a prerequisite for basic per-soul knowledge.

Proposed incarnation profiles would summarise evidence such as purpose, relevant skills and knowledge consulted. They are operational evidence, not knowledge concepts or copies of private transcripts. Their exact collection, privacy and retention rules remain implementation work.

### Changing structure must preserve running work

A knowledge move or soul split must account for references, pending harvests and existing instances:

- Update ownership and reading declarations in the same reviewed change.
- Preserve a single canonical home and the provenance of claims.
- Use explicit migration or redirects where the capability supports them; path changes are not free.
- Do not silently rewrite an active instance’s retained role or skills.
- Do not silently retarget a pending write because ownership has changed. Reconcile it through a supported transition, or hold it for review.

A soul definition can evolve while an existing instance continues with its retained curriculum. Refreshing accepted knowledge and changing that curriculum are separate operations.

## Topic-first knowledge is an alternative, not a requirement

A topic-first model organises the base around subjects and then maps souls to them. A soul can own several topics and consult others.

For example, a base might contain runtime execution, capability contracts and interface accessibility. Ownership can change while those subject identities remain stable.

The distinction is which boundary leads:

- **Per soul:** start from the expert’s current scope and organise knowledge within it.
- **Per topic:** start from subjects and assign ownership and reading interests over them.

They can initially look similar when souls are named for expertise. Topic-first organisation becomes useful when subjects evolve independently of the roster, but it adds explicit structure and maintenance. A deployment need not use one uniform shape everywhere.

The earlier topology exploration favoured topics from the outset and proposed shallow subtopics, redirects and evidence-driven restructuring. The subsequent decision selects centralised per-soul knowledge as the default. The topic-first approach remains valid for a capability or supported profile, not a universal kernel rule.

## Knowledge procedures and learning are capability choices

OATS supplies contracts and a default implementation. Users can adapt existing capabilities or write their own knowledge procedures and ways of working and learning.

For example, a capability might arrange that:

- A new instance starts with relevant expertise accumulated by previous instances of its soul.
- Two instances share a foundation but develop different working understanding of their assignments.
- A long-running instance retains investigations and unresolved questions across many tasks.
- Selected, reviewed learning becomes available to other instances while task-specific context stays local.

Three choices should remain independent:

| Choice | Examples |
|---|---|
| Organisation | Per soul, per topic, per project |
| Placement | Shared repository, co-located directories, multiple stores, graph system |
| Learning and governance | Reading, capture, judgment, review, maintenance and acceptance workflows |

This does not require an overwhelming set of user-facing switches. A capability can offer coherent profiles. Changing a directory layout should not necessarily require writing a whole new integration.

### OAS-style co-location remains a valid model

A capability could keep mutable knowledge alongside the editable definition:

```text
agents/example/soul/
  AGENTS.md
  skills/
  knowledge/
```

The architecture must allow this choice; it is not a claim that current `oats.okf` supports that layout. The chosen capability needs explicit, supported read/write destinations and custody.

**An immutable captured source artifact is not a live writable knowledge store.** It may contain a knowledge snapshot, but that does not authorise modifying the retained artifact or make it the destination of future harvests. Co-location in an editable authoring repository and mutation of a retained execution snapshot are different things.

Thus “all knowledge leaves souls” is a default integration choice, not a universal kernel prohibition. A relocated or unavailable live store must produce an honest readiness or transition outcome, not a fabricated replacement.

## Kernel contracts and capability behaviour

The kernel supplies the common boundary; it must not contain one mandatory knowledge pipeline disguised as an interface.

| Kernel responsibilities | Knowledge capability responsibilities |
|---|---|
| Source, soul and instance identity | Knowledge organisation and destination semantics |
| Configuration resolution and declared requirements | Storage, retrieval and reading context |
| Selected resources, exactly locked | Capture conventions and evidence selection |
| Lifecycle/invocation context and provenance | Judgment, harvesting and maintenance where used |
| Safe helper/job execution when required | Proposals, delivery, acceptance and recovery policies |
| Retained-artifact integrity and truthful outcomes | Its complete runtime instructions, skills and tools |

A knowledge capability is more than a storage adapter underneath a kernel-owned judge. The kernel does not require OKF, a node taxonomy, particular memory filenames, Git publication, a harvester or a maintainer for every integration.

The reference capability retains its promotion doctrine and Git PR-only delivery. Alternative models do not weaken framework safety, repository governance, secret handling or declared authority. A binding must validate its own semantics and reject incompatible requirements, not quietly substitute another provider or destination.

This is the same principle used for messaging and tasks: common contracts with independently chosen implementations. Skills and capability resources are portable artifacts, not inherently tied to a model vendor’s distribution system.

## How the default OKF capability works

`oats.okf` represents accepted expertise as Markdown concepts with metadata, indexes and history. Its runtime owns bindings, input custody, read views, worker execution and delivery.

Conceptually:

1. A working instance consults relevant accepted knowledge and captures observations without self-censoring against the promotion bar.
2. An independent worker receives bounded evidence with provenance. It need not borrow the source instance’s live worktree or identity.
3. The worker judges additions, merges, supersessions or exclusions, using the reference doctrine.
4. The capability validates and delivers the proposal under the selected store’s policy.
5. Accepted learning becomes available for subsequent reads; it is not automatically present in every instance’s active context.

Git delivery uses pull requests, with merge-visible acceptance distinct from proposal delivery. Plain-directory delivery uses its own recoverable publication mechanism. A receipt must state what actually happened: capture, judgment, delivery and acceptance are different facts, and successful directory publication does not prove human review.

The [operational guide](knowledge.md) describes version-scoped commands and constraints. A new knowledge model or acceptance policy must not be inferred from a successful storage test or from this conceptual description.

## Reusing working understanding: context handoffs and cloning

Harvesting does not necessarily reproduce the combined understanding that makes a long-running instance effective. Preserving a few good concepts can preserve real learning without preserving the whole working picture.

Context reuse is complementary to harvesting. A handoff or clone could carry selected:

- References to relevant accepted concepts.
- Verified observations with scope and freshness.
- Problem framing and clearly labelled provisional reasoning.
- Useful procedural context, pending separate review if it should become a skill.

This selected context has been called **clothes** in design discussions. It is not another canonical knowledge store. Copying it does not promote it or make it true indefinitely.

A clone needs its own identity. It must not automatically inherit credentials, message identity, child instances, a worktree or ownership of unfinished operations. Cross-developer sharing needs explicit selection and privacy boundaries; a shared soul does not authorise copying an entire private session.

The selection, consent, freshness and lifecycle protocol remains design work. The principle is that shared learning and situated continuity deserve different preservation mechanisms.

## Implementation boundaries

The following are accepted directions:

- Both ephemeral and long-running instances are legitimate.
- The default is centralised, per-soul knowledge, with room for reviewed structural evolution.
- Knowledge capabilities own their model and complete runtime behaviour, including support for alternative placement and learning procedures.
- The default doctrine preserves expertise rather than code descriptions or task residue.
- Structural change must preserve provenance and running work.

These statements are not new CLI flags, configuration schemas or claims of universal runtime support.

The released framework and default OKF capability supply an implementation foundation, including scoped retained execution and knowledge capture/judgment/delivery. See the [release notes](release-notes/v0.24.0.md) for the bounded 0.24.0/2.1.0 scope. Do not infer automatic per-soul provisioning, a supported co-located OKF profile, automatic speciation, a complete maintenance service, redirects or safe context cloning from that release.

A convincing flexibility test needs the same kernel to support the centralised per-soul model, an explicitly writable co-located model, and a genuinely different organisation/learning model. Git and directory storage within OKF alone do not prove the last case.

Existing deployments must not be silently migrated by updating this document. Implementations, skills and operational guidance must be reconciled deliberately with these decisions.

## Related documentation

- [OATS overview](../README.md)
- [Souls and instances](souls-and-instances.md)
- [Knowledge operations](knowledge.md)
- [Layer contracts](layers.md)
- [Knowledge capability authoring](knowledge-capability-authoring.md)
- [Packages](packages.md)

The September 16 exploration and September 19 discussion inform this consolidated account. This document supersedes a mandatory topic-first interpretation and a kernel-wide prohibition on co-located knowledge; it does not silently approve pending bootstrap, identity, permission or source-layout proposals.
