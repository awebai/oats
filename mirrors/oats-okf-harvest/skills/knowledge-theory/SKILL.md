---
name: knowledge-theory
description: >-
  OKF promotion doctrine for knowledge-operations souls: what belongs in a
  soul's OKF knowledge base and what does not (decision versus description),
  the accept and reject lists, the two-part test, one canonical home,
  supersession, human-accepted decisions, slow state and exclusions. Use when
  judging whether captured instance evidence should be promoted, when
  reviewing a harvest PR, or when deciding whether a concept should be merged,
  superseded or dropped. Not the oats.knowledge-theory capability for
  capability authors; not the working-soul capture skill
  (okf-instance-knowledge).
---

# Knowledge judgment — doctrine before mechanics

### 3.1 The single most important thing

> Knowledge is what makes an expert agent an expert in a topic or a project.
> It is **not** a description of what lives in the code.

Source: founder direction of 2026-09-09, restating the position first taken
on 2026-08-27 and recorded in the OATS architecture proposal on 2026-09-04
("The line is decision versus description").

An agent that knows how the code is laid out, what the modules are called,
and how they fit together has learned nothing an agent with a fresh clone and
ten minutes could not learn. Worse, a stored description competes with the
code and loses on freshness: once it drifts it lies, silently, to every
future instance. That is the content automatic memory systems accumulate,
and it is what public audits of those systems found to be worthless (section
9, source 4). Code is the truth about code.

What no amount of code reading recovers is **why** the code is the way it
is, **what was rejected** on the way, **what was decided** about where it is
going, **what was discovered** to be a limitation and how it was worked
around, **what the state of an area is** right now, and **what someone
concluded** after thinking a problem through. That is expertise. It is what a
senior engineer knows and a new hire does not, even when both can read the
same repository. It is what we are building souls to accumulate.

### 3.2 The accept list

A knowledge base holds these kinds of knowledge; the harvester promotes them and the maintainer accepts them. Each is illustrated so the
category is unmistakable.

1. **Decisions and their rationale.** What was chosen and why. *"Registration-time
   authorization: every tool's gate is decided in `newServer()` and nowhere
   else, because a second line of defence invites the first one to be
   skipped."*
2. **Rejected alternatives and why.** Code shows the outcome, never the
   alternatives. Without this record a capable agent will "helpfully" refactor
   toward the rejected option. *"A standalone `semantic_models:` spec was
   rejected: it silently disables the production semantic layer with a green
   parse."*
3. **Architecture rationale.** Why the shape is what it is, and whether it is
   deliberate or a stopgap. Not the shape itself. *"The client talks GraphQL for
   both metadata and query execution because no Go SDK exists; this diverges
   from both Python reference implementations on purpose."* The description of
   which package implements the client is not knowledge; the repository says
   it.
4. **Roadmap and direction.** Where the project is going and what it is
   sponsored to become. *"The epic exists to stop generated SQL being how data
   gets read; the end state retires the text-to-SQL tool entirely."*
5. **How the work is going: typed slow state with an owner.** A maintained,
   dated, superseded-on-change picture of an area: what is on main, what is in
   flight, what is blocked, what is open. This is the compounding-expertise
   claim itself, and it is safe only when it has an owner and an
   update-on-change rule. Without those it is indistinguishable from slop.
6. **Blockers**, named with what they block and what unblocks them.
7. **Discoveries.** Facts about the world that were not written anywhere and
   cost effort to establish. *"MCP tool descriptions are truncated at 2,048
   bytes and clients that defer schemas replace optional parameter descriptions
   with generated summaries; only the description and required parameters
   survive."*
8. **Limitations found and the solutions that worked.** *"GraphQL pages at
   about 1,024 rows where Arrow Flight streams; follow `totalPages`, never send
   'no limit'."*
9. **Conclusions of thinking things through or researching.** The output of
   an investigation, not its transcript.
10. **Inspiration genealogy** (the strongest case for design souls). What was
    borrowed from where, which patterns were rejected, and which observed
    failures drove the rejection. Code shows pixel values, never intent.
11. **Process and environment lessons** that the repository cannot express:
    CI and release traps, toolchain gotchas, review protocol, the way this team
    ships. *"CI does not build or test this repository; the local verification
    loop is the only gate."*

### 3.3 The reject list

A judge drops these, however well written.

1. **Anything a fresh agent could derive by reading the repository:**
   structure, style, naming, how modules fit, what a file does, which function
   calls which. Including "helpful" maps of the codebase. If a navigational
   hint is genuinely needed, it belongs in the repository's own docs where it
   moves with the code.
2. **Task residue:** PR numbers, half-done plans, "was working on X", "liked
   variant C", point-in-time environment facts, who was on shift. Indexical
   content whose referents die with the instance.
3. **Session trivia and tool noise:** what commands were run, what the tool
   output said, retries, dead ends that taught nothing.
4. **Secrets and credentials**, however they appear.
5. **Third-party message content verbatim.** A lesson may be *about* a
   received message; unverified sender content is not knowledge by
   transcription.
6. **Lessons that should have been code.** A gotcha that a lint rule, a test,
   a type, or a CI check would eliminate is knowledge debt unless it says so
   and points at the real fix. The judge asks for the elimination route
   first: architecture, then lint/CI/tests, then a skill or rule, and only
   then a lesson.

### 3.4 The two-part test

For every candidate the judge (harvester or maintainer) asks:

1. **Would a future instance of this soul act differently for knowing it?**
2. **Could it NOT have found this by reading the repository?**

Both must be yes. The first is the original promotion bar (an invariance
test). The second is the code-is-truth guard. "Architecture" passes only as
rationale or decision; an architecture *description* fails the second test
by definition. Keep that word precise in the skill.

### 3.5 Why decisions and descriptions age differently

A description goes stale and **silently lies**. A decision is **superseded**,
which is an explicit, loggable act: the new decision names the old one. This
is why decision records are safe to keep for years and descriptions are not
safe to keep for weeks. Slow state (accept item 5) sits between the two and
is only safe because it carries a timestamp, an owner, and the rule that
whoever changes the reality updates the record in the same session.

### 3.6 Non-coding souls are almost pure knowledge

The code-is-truth objection bites developer souls hardest and non-coding
souls not at all. An `oats-expert` soul's accepted project direction and
rejected alternatives, or a domain expert's model of the subject: none of
that rationale is re-derivable just by reading the code. For those
souls the knowledge node **is** the expertise, and the doctrine's reject
list mostly removes noise rather than substance. A judge must not apply
a "developers rarely need knowledge" heuristic to them. Source: founder
correction of 2026-08-27 ("developer agents should know about important
architecture decisions... UX agents can also hold valuable knowledge of
inspiration... do push back if you don't think so"), and the OATS proposal's
write-side paragraph of 2026-09-04.

## One canonical home

Route every claim to ONE canonical concept; merge or supersede rather than
copy. Consult the existing indexes first, across nodes as necessary.
Repository-wide facts already authoritative in repository docs get pointers,
not duplicates. A claim whose right home is a node the source does not own is
dropped from that run with an explicit reason for the owner to review; it is
never silently written into another node. There is no indefinite ownerless
inbox queue.

## Human-accepted decisions

A decision with explicit who/when acceptance evidence from a human passes the
promotion bar by construction: preserve the decision and its rationale, record
the acceptance and any supersession, and do not re-judge the human. Exclusions
still apply. **Superseding a human-accepted decision is never done silently**:
a change that would supersede one needs a human (the maintainer labels the PR
`okf-needs-human` and does not merge it).

## Slow state, findings and procedures

Typed slow state needs a timestamp, an owner and an update-on-change rule. A
Finding that passes both tests becomes a Lesson. Do not invent dates,
citations or certainty.

Skills remain soul artifacts, and knowledge operations never edit soul skills.
A justified procedure candidate can become an external Playbook concept that
names its elimination route and links the existing skill, for separate human
review.

## Exclusions

Never promote secrets or credentials, or verbatim third-party messages.
Captured private evidence is not publication permission. Drop tool noise, task
residue, code descriptions and duplicates. Do not quote third-party text just
because it appears in a source record. Preserve verified, generalized
conclusions only.

## Provenance

Every promoted or merged concept cites where it came from: the durable input
id, and for transcript evidence the turn ids it relied on. Provenance is what
lets a later judge (and a human) check the claim instead of trusting it. Do
not put copied home paths, account details, machine state or secrets in
reusable knowledge.
