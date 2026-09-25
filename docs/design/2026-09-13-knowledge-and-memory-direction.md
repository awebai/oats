# Knowledge and memory in OATS: the central knowledge base and the expertise doctrine

**Status:** founder direction (Pepe), consolidated on 2026-09-13 as the
implementation brief for the `oats.okf` knowledge capability. Written by
oas-expert (the OAS steward soul) from the recorded decisions listed in
section 10. Where this document states a requirement, it names the decision
it comes from. Where it proposes a mechanism, it says so, and the mechanism
is the implementers' call as long as the requirement holds.

**Audience:** the OATS engineers who will implement this in `oats.okf`, and
their reviewers. Read section 3 before anything else. An implementation that
gets every mechanism in sections 4 to 6 right and section 3 wrong is worse
than the current package.

---

## Scoping amendments — 2026-09-13

Subsequent direct human scoping settles eight points. These supersede any
conflicting mechanisms or completion tests below. The requirements describe
OATS's default knowledge model and its OKF implementation, not compulsory
theoretical policy for every third-party knowledge capability:

1. **All knowledge leaves the soul**, including general expertise.
2. **For now, cannot-write is explicit OKF injection guidance**, not a
   mechanical filesystem-refusal guarantee (amends sections 4.6, 7.8 and 8.1).
3. **Harvesting is independent of the source instance's context**; its worktree,
   branch and work mode do not determine execution or destination custody.
4. **Git-committed knowledge uses PR delivery**, for both public and private
   repositories; there is no attached/private direct-commit exception
   (amends sections 4.11 and 7.7).
5. **For now, repository permissions rest on users' GitHub accounts.** Assume
   all agents in a workspace/team can access its configured knowledge repos.
   Defer the public/private distinction, per-agent ACLs, and disclosure routing;
   `reads` is context selection, not an access-control boundary (settles the
   initial read-scoping choice in section 7.6).
6. **The first working version includes Git-backed OKF and a non-Git knowledge
   store.** Non-Git support is not a later stub or roadmap item. Whether its
   first implementation is directory-backed OKF or another tool is still open.
7. **The reference knowledge/memory theory is independent of storage tools.**
   A CLI-backed integration such as the proposed Omnigraph case can adopt the
   same concepts and doctrine while using native tools, but may also choose a
   different theoretical model. OKF files, indexes, validation and Git PR
   mechanics below are implementation choices, not universal requirements.
8. **OATS provides canonical theory and authoring help; capabilities own runtime.**
   Maintain canonical docs for knowledge injections/skills and provide a
   `knowledge-theory-expert` agent to help capability authors. Default OKF
   follows the reference framework. Every capability supplies its own complete
   skills, injections, memory behavior, harvester and related machinery; no
   mandatory shared runtime doctrine is injected by OATS. The expert and full
   authoring material are planned, not implemented yet.

The accepted rulings are recorded in
[external knowledge custody](../../agents/oats-expert/soul/knowledge/decisions/external-knowledge-custody.md)
and [provider-neutral knowledge and harvest](../../agents/oats-expert/soul/knowledge/decisions/provider-neutral-knowledge-and-harvest.md).
The [knowledge location contract](2026-09-13-knowledge-location-contract.md)
is a **proposal**, separating the common model from integrations and custody,
with explicit bindings, embedded/dedicated Git OKF, and non-Git storage.
Its schema and mechanisms are not accepted yet; the earlier public/private
policy proposal is deferred. The original brief is retained
below for rationale and further scoping; it is not an implementation-ready
contract where these questions remain open.

---

## 1. What this changes, in one paragraph

Today every soul carries its own `soul/knowledge/` bundle, the working
instance is told to run `oats okf harvest` after committing, and the
harvester promotes that instance's notes (or captured session turns) into
that soul's bundle. After this change there is **one knowledge base per
project**, normally living in the project's repository; each soul's former
knowledge folder becomes a **node** of that base, with exactly one owning
soul; souls declare which nodes they **own** and which they **read**; the
running agent reads its nodes and the wider base, keeps its instance memory
current, and **never writes to the base and never learns that a harvester
exists**; a harvester runs **per instance**, on a schedule the capability
declares and once more at retirement, and is the **only writer**; and the
harvester's first rule, ahead of all mechanics, is that knowledge is what
makes an agent an expert in a subject, **never a description of what the
code already says**.

---

## 2. Vocabulary

These terms are used precisely throughout. Most are already OATS vocabulary
(`docs/knowledge.md`, `docs/knowledge-theory.md`, the September 3
architecture proposal); the new ones are marked.

| Term | Meaning |
|---|---|
| **Soul** | Durable specialist identity: `soul.yaml`, `AGENTS.md`, `skills/`. Committed, reviewed, versioned. Identity across incarnations. |
| **Instance** | One disposable incarnation of a soul with its own home, task, and work view. |
| **Instance memory** | `STATE.md`, `log.md`, `notes/` in the instance home. Indexical (I, here, now). Dies with the instance. |
| **Knowledge base (KB)** *(new)* | One versioned OKF bundle per project holding every node. Repo-resident by default; a team-scope location is the option for cross-repository or private knowledge. |
| **Node** *(new)* | A sub-bundle of the KB (its own `index.md`, `log.md`, sections) with exactly one owning soul. What `soul/knowledge/` used to be, relocated. The unit of ownership, of reading interest, and of promotion destination. The 2026-09-08 deployment proposal calls this a *collection*. |
| **Owns / reads** *(new)* | A soul's declarations: the nodes its harvesters write to, and the nodes its instances load at session start. |
| **Harvester** | A soul of the type permitted to write knowledge (`memory-harvest`). Converts one instance's notes and captured record into KB writes. The only writer. |
| **Harvest** | The act of de-indexicalization: rephrasing what an instance learned so the claim survives its author, then judging it against the promotion bar. |
| **Promotion bar** | "Durable AND would change what a future instance of this soul does." An invariance test. Extended in section 3 by the second test: "and could it NOT have been found by reading the repository." |
| **Capture vs judgment** | The working instance captures without judging (cheap, in-flow). The harvester judges (deliberate, one consistent standard). |
| **Soul type** | The policy unit in OATS: which capabilities a soul receives, what knowledge it may read, whether it may write knowledge, and its communication reach. |
| **Record** | The turn record (`packages/record`): every Claude Code, Pi, and Codex session captured verbatim, content-addressed; `oats recall` reads windows of it. |

---

## 3. The doctrine: what knowledge is, and what it is not

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

The harvester promotes these kinds of knowledge. Each is illustrated so the
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

The harvester drops these, however well written.

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
   and points at the real fix. The harvester asks for the elimination route
   first: architecture, then lint/CI/tests, then a skill or rule, and only
   then a lesson.

### 3.4 The two-part test

For every candidate the harvester asks:

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
list mostly removes noise rather than substance. The harvester must not apply
a "developers rarely need knowledge" heuristic to them. Source: founder
correction of 2026-08-27 ("developer agents should know about important
architecture decisions... UX agents can also hold valuable knowledge of
inspiration... do push back if you don't think so"), and the OATS proposal's
write-side paragraph of 2026-09-04.

### 3.7 One home per decision: the homing rule

Split-brain comes from copies, not from the existence of a record. Route each
piece of knowledge to exactly one home, by audience:

| Kind | Home |
|---|---|
| Multi-role project facts every contributor needs (module boundaries, IPC contracts, platform constraints that bind several roles) | The repository's own docs (ADR-style), because a per-role node silos what everyone, including non-OATS contributors, needs. Nodes hold **pointers**, never copies. |
| Role-scoped craft decisions (why this panel renders this way, why the CLI parses arguments as it does) | That role's node. |
| Product direction and cross-cutting vision | The steward's node. Other souls consult it and never duplicate it. |
| Procedures future instances should run the same way every time | The soul's `skills/`, not knowledge. (Section 4.9.) |

A concrete pattern already in production on one deployment: an engineer
soul's operating doc says *"the repository documents itself unusually well;
your knowledge carries only what those files do not say, plus a record of
where they are stale."* That sentence is the doctrine applied. Its node then
holds the decisions behind the tool surface and a stale-docs ledger, and
nothing that the repository's own `ARCHITECTURE.md` already says.

### 3.8 The audit question

The doctrine came out of a public audit of an automatic memory system
(source 4): dozens of stored memories per clone, most never read, a roughly
three-to-one write-to-read ratio, content dominated by point-in-time state,
outdated facts, duplication of the instructions file, and per-machine
divergence in a hidden store. Every one of those failures is a guard this
design holds: indexical content is rejected at harvest; reading is explicit
and index-first; the base is versioned and reviewed; capture and judgment are
separate roles. The standing test for any concept in the base is therefore:

> **Would this survive that audit?** It is either likely to be consulted,
> explicitly freshness-marked where it must be, or absent because the
> repository can already answer it.

---

## 4. The target architecture

### 4.1 One knowledge base per project, repo-resident by default

**Requirement (founder, 2026-09-09, amended the same day):** all knowledge
of a project lives in one versioned OKF bundle, auditable as a whole: one
index of nodes, one history, one validator run. The base **may live in the
repository itself**, and that is the default for a single-repository project
and for every open-source project: a `knowledge/` bundle at the repository
root, one sub-bundle per node. Portability is then git. Clone the project and
its knowledge comes along, for contributors from any organization, with no
export step.

A **team-scope base** (a directory or repository at the deployment's team
scope) remains the option for a multi-repository deployment's cross-repo or
private knowledge. **Base location is a binding, not a design constant**:
souls reference nodes by name; deployment configuration says where a named
node lives.

Why central rather than per soul: with knowledge scattered across soul
directories, nothing can audit the whole, no single validator run covers it,
nodes of different souls cannot cross-link cleanly, a steward cannot see what
the team knows, and "the expert's memory" becomes an unauditable second
source of truth (the failure the 2026-09-08 deployment proposal names for
deployment experts: *the expert must not become the deployment's database*).

Why repo-resident rather than a separate store: it keeps the property the
current design already has (soul knowledge is versioned in the repo today),
it makes knowledge governance equal to repository governance (a harvester's
promotion to an open-source project is a pull request reviewed like code),
and it removes the export/import mechanism the first draft required. The
founder withdrew that requirement explicitly: *"Portability matters for
things like open source projects with contributors from many orgs. Nothing
stops the knowledge from being in the repo itself."*

### 4.2 Nodes

A node is what `soul/knowledge/` is today, relocated: an OKF sub-bundle with
its own `index.md`, `log.md`, core sections (`lessons/`, `decisions/`,
`playbooks/`, `references/`) and whatever role-grown sections its owner
needs (`architecture/`, `roadmap/`, `stewardship/`, `codebase-gotchas/`).
The knowledge ontology is itself part of the specialization: a steward grows
`roadmap/`; a developer soul does not, and a `Roadmap` concept in a developer
node is a smell (project direction belongs to whoever stewards the project).

Every node has **exactly one owning soul**. This is the homing rule lifted
one level. A node may be owned by a soul whose role is stewardship of a
project or an area: that is where multi-role project decisions go when the
repository's own docs are not the right home. Role craft goes to the role's
own node.

Illustrative layout (the implementers choose the exact shape):

```text
<base>/                      # repo root knowledge/, or a team-scope directory
  index.md                   # the base: lists every node, its owner, one line each
  log.md                     # base-level history: one entry per harvest delivery
  <node>/                    # one sub-bundle per node
    index.md
    log.md
    lessons/  decisions/  playbooks/  references/  <role-grown>/
```

### 4.3 Soul declarations: owns and reads

A soul declares, in `soul.yaml` (exact keys are the implementers' call):

- the nodes it **owns**: the harvesters that run for its instances write
  there by default;
- the nodes it **reads**: loaded index-first at session start and consulted
  throughout the session.

A soul with no declarations owns a node named after itself and reads only
that: the current behavior, relocated. Portable souls reference nodes by
name; the deployment's configuration binds names to a base location, so a
soul copied between deployments keeps working as long as a node of that name
exists or is created at scaffold time.

Illustrative:

```yaml
# soul.yaml
name: semantic-layer-engineer
knowledge:
  owns: [semantic-layer-engineer]
  reads: [lens-semantic-layer, platform-architecture]
```

```yaml
# oats-config.yaml, knowledge layer settings (illustrative)
capabilities:
  layers:
    knowledge:
      capability: oats.okf
      settings:
        base: knowledge            # repo-resident, relative to the scope root
        # base: /srv/team-kb       # or a team-scope base for cross-repo knowledge
```

### 4.4 The read side

Requirement, in this order, carried by the okf skill and the injection:

1. **At session start**, read the owned nodes index-first: `index.md`, then
   only the links the task needs. Never bulk-read.
2. **Throughout the session**, consult the owned and read nodes, and the
   wider base on demand, whenever a decision could already have been made.
   Prior decisions, lessons, and playbooks are binding context. Re-deriving
   what the base already knows is a bug.
3. **After every compaction**, re-read the owned nodes' indexes and the
   instance's own `STATE.md`. On Pi this is the existing `session_compact`
   hook; on Claude Code it is the session-start hook with the compaction
   matcher, contributed at launch by the capability.
4. Keep `STATE.md`, `log.md`, and `notes/` current as you work.

Nothing about harvesting. The whole base is readable on demand; scoping by
soul type or team stays a policy knob (the architecture proposal's read side:
*"an instance can find and consult organizational knowledge within its
type's scope"*). The default for a single-team deployment is: everything
readable, owned and read nodes loaded.

Why the read side leads: the July 2026 audit of the OKF injection found it
heavily write-biased (capture and harvest explicit, consultation one passing
sentence). Memory contracts must be symmetric, or knowledge accumulates and
is never used, which is exactly the three-to-one write-to-read failure of
the audited auto-memory systems.

### 4.5 Instance memory is unchanged

`STATE.md` (rewritten, `# Next` names the single next action), `log.md`
(append-only, dated, newest first), `notes/` (one OKF concept per insight,
written in soul genre from birth). The capture discipline stays exactly as
it is: write every non-obvious insight down, do not judge whether it is
"important enough", keep state current before every commit. This is the
harvester's primary input together with the captured record.

### 4.6 The harvester: one per instance, the only writer

- **One harvester per instance per run.** Never one harvester sweeping all
  instances. Its briefing names the source instance, the nodes its soul
  owns, the notes directory, and the record windows.
- **Inputs:** the instance's pending notes plus its captured session turns
  since the last harvest, record-fed and id-bounded with a watermark
  advanced on delivery. `oats.okf` 1.5.x already does this (`oats recall
  --thread ... --after ... --until`, `.okf-harvest-record.json` and its
  prepared `.next.json`, the replan detector, `--from-record`, `--force`).
- **Judgment:** the doctrine of section 3, as the **first section** of the
  harvester's skill, with the accept list, the reject list, and the two-part
  test verbatim. Then the existing mechanics: promote/merge/drop,
  knowledge-versus-skill routing, `Finding` to `Lesson`, index and log
  discipline, strict validation.
- **Destination:** the nodes the source soul owns. Procedure-shaped
  candidates still route to the soul's `skills/` (section 4.9).
- **Harvesters are the only writers to the base.** A running instance's
  attempt to write into the base is refused, not ignored. Enforcement is by
  the composed instructions plus whatever the implementers can make
  mechanical (a read-only view, a check in the harvester's delivery path, a
  validator rule on authorship).
- **Exclusions stand:** never promote a secret; never promote third-party
  message content verbatim.
- **The harvester is a soul** of the type permitted to write knowledge,
  spawned by the knowledge capability. OATS runs no special harvester
  (architecture proposal, "three simplifications"). Its runtime and model
  are the capability's `harvest-runtime` and optional `harvest-model`
  settings, independent of the source instance's runtime.

### 4.7 The running agent does not know the harvester exists

Requirement (founder, 2026-09-09). The agent knows: which nodes are its own
to read, that the whole base is readable, that it must keep notes, state,
and log current because they are harvested for it, and that it never writes
to the base. The injection **stops** telling instances to run `oats okf
harvest`, stops explaining custody paths, and stops describing the
harvester. Note-writing discipline stays; the trigger moves out of the
agent's hands.

Why: the harvest trigger was a discipline point in the agent's operating
loop that competed with the task, that agents skipped, and that failed for
reasons the agent could not fix (on one deployment `oats okf harvest`
failed on the harvester's messaging identity, and the working agent had to
escalate an infrastructure fault it should never have seen). Today's
injection spends roughly thirty lines on harvest mechanics: that is the
write bias of section 4.4 in another form. The agent's job is the task.

### 4.8 Triggers: a per-instance local schedule, and a final harvest at retirement

1. **Capability-declared schedule template.** The knowledge capability
   declares "harvest this instance every N". Spawn materializes one
   per-instance job of kind `operation` through the existing local host
   scheduler (`docs/schedules.md`: one launchd or systemd host timer, no
   daemon, `oats operation run knowledge:harvest --home <home>`). Retire
   removes the job. The job skips when nothing is new (watermark and replan
   detection already exist). Instances are never harvested by a fleet-wide
   job. No server is involved.
2. **Final harvest at retirement.** The `harvest` lifecycle event (migration
   step 6 of the architecture proposal, now delegated to the OATS team to
   rule on) runs on retire **before the home is removed**. Either the harvest
   completes synchronously, or the notes and the record window are
   snapshotted to a location that survives the home and the job runs against
   the snapshot. The watermark makes the double run (scheduled plus final)
   idempotent.

This reverses a deliberate earlier decision (2026-07-09: "retirement is a
knowledge no-op", to make long-lived sessions feed the soul while alive
instead of hoarding until death). The reason it can be reversed now is that
the continuous harvest no longer depends on the agent: the schedule feeds
the base while the instance lives, and the final harvest only closes the
gap between the last scheduled run and retirement. Nothing is lost either
way, and nothing is hoarded.

### 4.9 Skills stay with the soul; knowledge moves to the base

This is the steward's reading of the direction, not a founder sentence, and
it is flagged in section 8 for confirmation. Skills are procedural, are part
of the curated curriculum materialized at spawn, and are soul artifacts by
the OATS soul anatomy. The harvester's routing table is unchanged: facts
future instances should **know** go to the owned node; steps they should
**run the same way** go to `soul/skills/`; a correction to an existing
procedure maintains that skill. Skill deliveries keep the soul's custody
(commit on the instance's branch, PR for workspace-mode souls, direct edit
for local souls); knowledge deliveries follow the base's custody (section
4.11).

### 4.10 Parallel instances of one soul

N instances of one soul each own a different part of a problem. Each becomes
expert in its part while alive (instance memory). What it learns that is
durable for the **part**, not the instance (limitations, decisions,
solutions), consolidates into the soul's node, typically as a section per
part. The next incarnation of the soul starts with all of it. Instance
expertise dies; part expertise survives. Realization artifacts ("clothes",
derived from the record) are what make replicating such instances cheap;
they do not carry knowledge and are never a knowledge store.

### 4.11 The write side: git custody into the base

Harvesters write with git custody: a branch per harvest, rebase onto the
base's head, one commit prefixed `memory-harvest:`, publish, watermark on
delivery. Index and log entries are append-shaped so concurrent harvests
conflict rarely. For a repo-resident base the delivery follows **that
repository's** branch and review flow: for an open-source project a
harvester's promotion is a pull request reviewed like code (the promotion
bar plus human review). For a private single-team repository the deployment
may allow direct commits to the working branch, exactly as the current
attached-harvest path does. For a team-scope base the same rules apply to
that base's repository. Local souls (`local-agents/`, uncommitted by
contract) need an uncommitted node location; see section 6.

### 4.12 Human-accepted decisions pass by construction

A steward soul records a decision the human already made. It goes through
`notes/` like everything else, but a note typed `Decision` carrying an
explicit acceptance marker (who accepted it, when) passes the bar by
construction: the harvester does the mechanics (index, log, links,
supersession of an older decision) and does not re-judge. Otherwise
stewardship latency grows and the harvester becomes a second judge with less
context than the human.

---

## 5. Worked examples of the doctrine

### 5.1 A developer soul, before and after

Candidate from a session transcript of a feature engineer:

> *"The tool registration lives in `internal/tools/`, one file per tool; each
> registers via a `Register*` function, appears in `defaultTools`, and gets a
> gated branch in `newServer()`."*

Verdict: **drop** the first two clauses (repository says it) and **promote**
the third as a lesson only if it is phrased as the failure it prevents:

> *"Three edits, not two: a `Register*` function, a `defaultTools` entry, and
> a gated branch in `newServer()`. Two out of three compiles cleanly and ships
> nothing. Elimination route: a registration test that fails on a missing
> gate would make this lesson unnecessary; until it exists this is a
> stopgap."*

The promoted form passes both tests (a future instance acts differently; the
repository does not say that two-of-three ships nothing) and names its own
elimination route.

### 5.2 A steward soul

Candidate: *"Pepe decided on 2026-09-09 that the knowledge base is central
and may be repo-resident, and withdrew the export/import requirement."*
Verdict: **promote by construction** as a `Decision` with the acceptance
marker; supersede the paragraph in the earlier direction that required
export/import; link both. This is exactly the fast path of section 4.12.

### 5.3 A domain expert with no code

Candidate from a semantic-layer expert: *"The `lf_region` rollup is
provisional pending stakeholder sign-off; judgment calls in it must be
flagged when they matter to an answer, never quietly redefined."* Verdict:
**promote** as typed slow state (owner: this soul; superseded when sign-off
lands). Nothing in any repository carries this; the soul is almost pure
knowledge.

### 5.4 Residue

Candidate: *"Opened PR #123 and #124; #124 is waiting on Eric; next I should
rebase #123."* Verdict: **drop**. Task residue, all of it. If there is a
durable claim underneath ("PRs in this repository sit unmerged for weeks;
verify state against `origin/main` and open PRs before relying on it"), the
harvester promotes that sentence and nothing else.

---

## 6. What changes in `oats.okf`, concretely

Baseline: `oats.okf` 1.6.1 as shipped in `capabilities/oats-okf/` of this
repository (manifest with `harvest-runtime` and `harvest-model` settings,
`soul-scaffold` and `spawn` hooks, `harvest` and `inspect` commands and
operations, `injects/okf.md`, `skills/okf`, `skills/memory-harvest`,
`agents/memory-harvest`, `lib/harvest-branch.mjs`). The record-fed harvest,
watermarks, replan detection, exclusions, non-zero exit on failure, and the
operations contract all exist and stay.

| Area | Change |
|---|---|
| **Manifest** | Add the base binding setting (repo-resident default, team-scope option). Add the per-instance schedule template the spawn hook materializes. Declare participation in the `harvest` lifecycle event once the kernel ships it. |
| **`soul-scaffold` hook** | Create the soul's default node in the base (not `soul/knowledge/`), register it in the base index with its owner, and write the default `owns`/`reads` if the soul declares none. |
| **`spawn` hook** | Resolve the soul's owned and read nodes to paths through the binding; record them in `instance.json`; make them reachable from the instance home without the agent knowing the base layout (a `./knowledge/` view with one entry per node is one option); materialize the per-instance harvest job; on Claude Code contribute the compaction re-read hook. |
| **`retire` / `harvest` hook** | Remove the schedule job; run the final harvest before home removal, or snapshot notes and the record window and run against the snapshot. |
| **Injection (`injects/okf.md`)** | Rewrite around the read side (section 4.4). Remove every instruction to run `oats okf harvest`, the custody explanations, and the harvester description. Keep the capture discipline. State plainly: you read your nodes and the base; you never write to the base. |
| **Harvester skill (`skills/memory-harvest`)** | Section 3 verbatim as the first section. Destination becomes the owned nodes. Add per-node write serialization, the base-custody delivery paths, the Decision fast path, and the pending-for-owner rules. Keep the record-window protocol and exclusions. |
| **Harvester agent and briefing** | The briefing names the source instance, its soul's owned nodes and their paths, the notes directory, the record windows, the base custody, and the serialization handle. |
| **`harvest` command and operation** | Per instance (`--home`), invoked by the schedule and by the retire path; still runnable by a human or the Desktop through the operations contract. Never fleet-wide. |
| **`inspect` operation** | Extend the view to show the instance's owned and read nodes and the base's freshness (last harvest, pending notes, watermark position). |
| **Validator** | Validate the whole base strictly after every harvest, not only the touched node. |
| **`okf` skill** | Teach the base and node model on the read side; the authoring craft is unchanged. |
| **Migration** | An explicit command (or a step of `oats migrate --from-oas`) that moves each existing `soul/knowledge/` into a node of the base, rewrites intra-bundle links, registers the node, and leaves `soul/knowledge` resolvable to the node during the transition so existing `AGENTS.md` links keep working. Souls' `AGENTS.md` files that reference `./soul/knowledge/...` are then updated by their owners. |
| **Kernel asks** | The `harvest` lifecycle event (proposal step 6); `soul.yaml` keys for owns/reads read by the kernel or passed through to the capability; the configuration key for the base binding; a way for a capability to declare a per-instance schedule template that spawn materializes. |

---

## 7. Design requirements the implementers must settle (not optional)

1. **Concurrent harvesters on one node.** Four instances of one soul mean
   four harvesters writing the same node, and with a repo-resident base four
   harvesters on one repository branch is the same race. Serialize per node
   (a base-level lock or a queue) and require rebase-before-commit; never let
   two harvesters race on an `index.md`. This is the one new failure mode
   the design introduces. It must have a test.
2. **Doctrine first, verbatim.** Section 3's accept list, reject list, and
   two-part test are the first section of the harvester skill. Mechanics
   come after.
3. **Human-accepted decisions pass by construction** (section 4.12), with a
   defined acceptance marker.
4. **Local souls need an uncommitted node location.** `local-agents/` souls
   are uncommitted by contract; their nodes cannot be committed into a
   repo-resident base. Options: a gitignored area of the base, or a local
   base bound at the machine scope. Decide, document, and keep the doctrine
   identical.
5. **Pending-for-owner queue** (from the 2026-09-08 proposal): if kept, a
   named owner and an expiry, or it becomes the slop pile in a new location.
6. **Read scoping by soul type**: decide whether it ships in the first
   version or stays "everything readable" with the knob reserved. Either is
   acceptable; say which.
7. **Delivery for repo-resident bases**: default to the current attached
   commit for private repositories and to a pull request where the
   repository's governance requires review; make the choice a binding, not a
   guess in the harvester.
8. **Refusal, not silence, on a forbidden write.** An instance that tries to
   write into the base must get an error it can report, not a no-op.
9. **Acceptance is knowledge output, not harvester activity.** The bar for
   "done" is a fresh instance answering from the base, verified through the
   selected runtime (section 8 tests), not evidence that a harvester ran.

---

## 8. Completion tests

1. **Two souls, two nodes.** Each owns one node and reads the other's. An
   instance of each sees both at session start; neither can write to the
   base directly (an attempted write is refused, not ignored).
2. **Four parts, one soul.** Four instances of one soul, each briefed with a
   different part of a problem, harvested on schedule and at retirement. The
   soul's node contains a section per part with the decisions and
   limitations each found; no code descriptions; no task residue. The base
   log shows one commit per harvest and no conflicts or lost writes.
3. **Expertise survives the instance.** A fresh instance of that soul,
   spawned afterwards, answers a question about a limitation found by
   instance three with no access to instance three's home or transcript.
4. **Retire mid-task with pending notes.** The final harvest lands before the
   home is gone; the notes' durable content is in the node; the point-in-time
   content is not.
5. **Exclusions hold.** A harvester fed a transcript containing a secret and
   a third-party message promotes neither and promotes the positive-control
   lesson.
6. **Doctrine holds.** A harvester fed a transcript containing a correct
   architecture description, a decision with rationale, a rejected
   alternative, and a PR-number plan promotes the decision and the rejected
   alternative, and drops the description and the plan. The promoted
   concepts carry turn-id provenance.
7. **The read side is real.** A fresh instance's captured session shows it
   opened its owned node's `index.md` before its first non-trivial action,
   and re-read it after a forced compaction.
8. **Whole-base validation.** Strict OKF validation of the entire base passes
   after every harvest.
9. **Migration.** An existing deployment with per-soul `soul/knowledge/`
   bundles migrates to one base with one node per soul, links intact,
   validator clean, and every soul's next instance reads its node.
10. **The agent is unaware.** The composed `AGENTS.md` of a migrated
    instance contains no instruction to run a harvest and no description of
    the harvester.

---

## 9. What is out of scope, deliberately

- **Picking up ordinary top-level `CLAUDE.md`/`AGENTS.md` setups as
  spawnable agents** that join the team. Real, wanted, parked by the founder
  on 2026-09-09. Do not design it inside this change.
- **An export/import mechanism for nodes.** Withdrawn by the founder on
  2026-09-09; moving a node between bases is git (subtree, or a copy plus a
  log entry).
- **A central knowledge service or database.** The base is files under git.
  A different provider may implement a different store; the default OKF
  package does not.
- **Changing the OKF format** or its type vocabulary. The typology
  (`Instance State`, `Finding`, `Lesson`, `Decision`, `Playbook`,
  `Reference`, role-grown types) is unchanged.
- **A fleet-wide harvester.** Explicitly rejected: one harvester per
  instance per run.
- **Moving skills out of the soul.** Pending confirmation (section 4.9), the
  soul keeps `skills/`.

---

## 10. Where each decision comes from

The chronology, so that an implementer or reviewer can trace any requirement
to its source. Paths are in the OAS steward's knowledge bundle
(`agents/oas-expert/soul/knowledge/` of the OAS repository) unless another
repository is named.

| Date | Decision or evidence | Source |
|---|---|---|
| 2026-07-08 | Knowledge typology: soul knowledge is incarnation-invariant, instance memory is indexical, harvest is de-indexicalization, types are consolidation stages, sections are role-grown, souls hold project-slow state. | `architecture/knowledge-typology.md`; restated in OATS `docs/knowledge-theory.md`. |
| 2026-07-09 | Capture and judgment are separate roles; the promotion bar is held only by the harvester; continuous post-commit harvest; retirement is a knowledge no-op (now reversed, section 4.8). | `architecture/memory-design.md`. |
| 2026-07-10 | The OKF injection was write-biased; read-side consultation must be explicit and index-first. | `lessons/okf-injection-read-side-gap.md`. |
| 2026-07-26 | Provider-agnostic specialization: compounding expertise across sessions, models, and runtimes; memory outside any one harness. | `decisions/provider-agnostic-specialization-and-curated-context.md`. |
| 2026-08-27 | Investigation of the public auto-memory audit: governed memory must survive that audit; developer souls must not mirror code; harness-agnostic knowledge enables mixed-runtime teams. | `lessons/governed-memory-survives-auto-memory-audit.md`, `lessons/developer-souls-should-not-mirror-code.md`, `lessons/harness-agnostic-knowledge-enables-mixed-runtime-teams.md`; the video "Turn off Claude Code's Memory" (Theo, t3.gg, YouTube id Jf54k7tFeEc). |
| 2026-08-27 | Founder correction: developer and UX souls hold decisions, rejected alternatives, inspiration genealogy, and typed slow state; the bias is against descriptions, not decisions. Decision-vs-description; one home per decision; freshness discipline. | Steward note `decision-vs-description-and-knowledge-homing.md` (instance notes, pending harvest); relayed to the OATS coordinator on 2026-09-04. |
| 2026-09-03/04 | OATS architecture proposal: knowledge is a contract with a read side and a write side; a harvester is a soul type permitted to write knowledge; the write side's doctrine is decision versus description; non-coding specialists are almost pure knowledge; custody scoping belongs to the contract. | the September 3 architecture proposal (this repository until 0.26.0; in the v0.25.x tags), sections "Soul type", "The slot contracts", "Three simplifications". |
| 2026-09-05 to 09-08 | Record-fed harvest shipped: `oats.okf` 1.5.0 to 1.6.1 (record windows, watermark, replan detection, exclusions, harvest runtime and model settings, non-zero exit on failure, inspect view and harvest action). | `capabilities/oats-okf/` at 1.6.1 (this repository); `docs/design/operations-contract.md`. |
| 2026-09-07 | Founder: the OATS team holds the agreed architecture vision; OAS-side review is advisory. | Steward note `oats-vision-delegated-to-juan.md`. |
| 2026-09-08 | Expert-assisted deployment proposal: shared knowledge collections with explicit promotion destinations; pending-for-owner for ambiguous material; the expert must not become the deployment's database; acceptance is knowledge output, not harvester activity. | `docs/design/2026-09-08-expert-assisted-deployment-proposal.md` (this repository), "Shared knowledge and promotion destinations"; steward note `deployment-as-capability-not-a-layer.md`. |
| 2026-09-09 | **Founder direction:** central knowledge base of soul-owned nodes; owns/reads; harvester-only writes; one harvester per instance; per-instance local schedule plus final harvest at retirement; the running agent unaware of the harvester; doctrine first; parallel instances consolidate per part; design requirements and completion tests. | Steward note `central-knowledge-base-soul-owned-nodes.md`; sent to the OATS coordinator the same day. |
| 2026-09-09 | **Founder amendment:** the base may be repo-resident; portability is git; export/import withdrawn; base location is a binding. | Same note, amended; sent the same day. |
| 2026-09-10 | Deployment evidence: engineer souls whose operating docs say the repository documents itself and the knowledge carries only what the docs do not say plus where they are stale; repository-resident review knowledge bases mined from real reviews and gating a learnings reviewer. | The LFX deployment's souls and repositories (uncommitted local souls; not in any framework repository). |
| 2026-09-13 | This consolidation. | This document. |

---

## 11. A note to the implementers

Read section 3 twice before opening the harvester skill. The mechanics in
sections 4, 6, and 7 exist so that the doctrine reaches the base reliably,
under concurrency, without the working agent's involvement, and with git as
the audit trail. But the product is not the pipeline. The product is a soul
whose next incarnation knows what the last one learned, and knows nothing
the repository could have told it. When a mechanism and the doctrine
conflict, the doctrine wins, and the conflict is a finding to report, not a
detail to resolve quietly.
