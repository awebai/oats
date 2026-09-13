# OATS reference knowledge theory

> **Direction update (2026-09-13):** in the default model, all durable knowledge
> will live outside souls. The incarnation-invariant versus task-local
> distinction below still applies, but physical placement in a soul is the
> earlier convention. The [current design proposal](design/2026-09-13-knowledge-location-contract.md)
> separates reference theory, capability authoring and runtime implementation.
> Neither a physical soul bundle nor Git is a theoretical requirement.

This is OATS's opinionated reference theory, followed by the default OKF
capability. Other knowledge capabilities may adopt it, adapt it or choose a
different model. Both knowledge tools and theoretical approaches are pluggable;
the kernel does not force the theory below into a capability's runtime.

The ideas come from asking what memory means for an agent that outlives its
sessions. Authors can apply them using OKF, a non-Git store or a CLI-backed
system. OATS will provide canonical injection/skill authoring guidance and a
`knowledge-theory-expert` agent to help that work. Each capability supplies its
complete runtime instructions, skills, memory conventions and harvesting
machinery; it is not merely a tool adapter under a mandatory shared judge.

## The derivation

A **soul** is identity across incarnations. So soul knowledge must be
**incarnation-invariant** — true and binding for any future instance, on any
model, in any session. "Durable AND would change what a future instance
does" is the promotion bar, and it is really an invariance test.

An **instance** is one incarnation's work. So instance memory is
**indexical** — saturated with *I, here, now*. This branch. This blocker.
This half-done plan. Indexical content cannot live in the soul, because its
referents die when the instance does.

That one distinction decides most placement questions on its own.

## Harvest is de-indexicalization

Moving knowledge from instance to soul is not copying files. It is
rephrasing an insight so it survives its author. "The build broke until I
cleared the cache" is indexical. "The build caches stale schemas — clear
`.cache/schemas` after model changes" is invariant. Consolidation succeeds
when the *I, here, now* is gone and the claim still holds.

A useful corollary for any implementation: an instance file's format rigor
should be proportional to its odds of surviving the instance. Working state
can be loose. Promotion candidates should be written in soul genre from
birth.

## Capture and judgment are different jobs

Instances should **capture without judging**. Writing an insight down is
cheap and best done in the moment, by the one who had it. Judging whether it
clears the promotion bar is expensive and best done deliberately, by
something that is not in the middle of a task.

Splitting the two has a second benefit. Agents that self-censor against a
half-remembered bar write less. Agents told "capture everything non-obvious,
judgment is someone else's job" write more, and the judge applies one
consistent standard across all of them.

## Knowledge consolidates through stages

A fresh observation is not yet a lesson. It matures:

| Stage | Example | Lives |
|---|---|---|
| Working state | "next: fix the failing test" | instance, rewritten freely |
| Observation | "PATCH with nulls seems to be a no-op" | instance, captured as-is |
| Lesson | "the API drops nulls — send empty strings" | soul, once verified |
| Procedure | "steps to clear stuck queues" | soul, as a playbook or skill |

The judge's routing question at the last step is one of shape. Facts that
future instances should **know** become knowledge. Steps they should **run
the same way** become skills. A correction to existing steps maintains the
skill it corrects.

## Decisions carry jurisdiction by location

"We will retry twice, then escalate" can bind one task, or bind every future
incarnation. The words are the same. The difference is where it is recorded
— task decisions live and die with the instance's working state, soul
decisions bind everyone after. Placement, not phrasing, carries the
authority.

## Souls hold slow state, not just timeless truth

Not everything in a soul is eternal. A roadmap, a deployment's current
shape, an open question — these are present-tense facts that tick at project
speed rather than task speed. Durability is a spectrum. Task-fast state
belongs to the instance. Project-slow state belongs to the soul and should
carry dates, because it rots. Timeless lessons belong to the soul and mostly
do not.

## The knowledge structure is itself specialization

Ship a minimal core ontology and let each soul grow the rest. An architect
soul grows a roadmap section. A developer soul grows a codebase-gotchas
section. A roadmap section in a developer soul is a smell — project
direction belongs to whoever stewards the project.

The test for growing a section is the promotion bar, one level up. Would
future instances of *this* soul need to navigate this kind of knowledge? If
yes, grow it and record why. If no, it is one concept, not a section.

## Where OATS encodes these ideas

In the reference implementation the ideas surface as: the okf integration's
capture protocol (instances write, no judging), the memory-harvest agent
(the judge, holding the bar and the routing table), and per-soul knowledge
bundles that grow role-specific sections. Swap the format and the mechanics
change. The ideas above should not.
