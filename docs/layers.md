# The OATS contracts

Status: contracts on paper (migration step 2 of
[the 2026-09-03 architecture proposal](2026-09-03-architecture-proposal.md)).
Every section says what is **shipped** today and what is **proposed**. A
proposed clause describes the contract the kernel will be refactored toward;
it is not a claim about current behavior, and the shipped documents
([souls and instances](souls-and-instances.md),
[capabilities](capabilities.md), [implementation](implementation.md)) remain
authoritative for what the code does now.

The rule the contracts serve:

> Every main component is replaceable by another that offers the same
> contract, with the exception of OATS itself. OATS knows only contracts.

A contract is finished when two implementations satisfy it and a soul runs
unchanged behind each. Each section ends with that test.

## How the pieces fit

```text
soul ─────────── declares which contracts it needs, never which implementation
  │
  ├── soul type ── the policy unit: capabilities, knowledge scope, reach
  │
  └── capabilities ── implementations bound by configuration
        ├── knowledge   (exclusive slot)
        ├── tasks       (exclusive slot)
        ├── communication (exclusive slot; called "messaging" in config today)
        ├── capture     (proposed slot)
        └── additive capabilities (any number)

instance = (soul, runtime provider, work target?, task)
```

The kernel owns the soul format, the soul type, the capability manifest and
lifecycle events, and instantiation. Everything else is an implementation
behind one of the contracts below.

## Soul format

**Shipped.** A soul is a directory: `soul.yaml` (name, kind, description,
repo, work, runtime, model, type), `AGENTS.md` (the operating definition),
`skills/`, and whatever a knowledge implementation adds. It is committed and
reviewed like code, and it never runs by itself.

**Contract.** A soul declares *which contracts it needs*, not which
implementation fills them. Its `AGENTS.md` speaks of "your knowledge", "your
task layer", "your messaging"; the bound capability's injected block says
what those are in this installation. A soul that names a tracker, a mail
system, or a knowledge format in its own text is not portable and is
malformed under this contract.

A soul is runtime-neutral as an artifact. Anything derived from it for one
runtime (a compiled native session, a finetune reference) is a realization
artifact attached to the (soul, runtime) pair, never soul content.

**Test.** One packaged soul runs in an installation bound to Jira and in one
bound to Linear with no change to its files.

## Soul type

**Shipped.** Config declares agent types by name under `agent-types:`; a soul
opts in with `type: <name>` in `soul.yaml`; capability entries target
`global`, `agent-types`, or `souls`, and settings resolve soul over type over
global, then by config closeness.

**Contract.** The soul type is the policy unit. It decides:

- which capabilities a soul of that type receives, and with which settings;
- what knowledge it may read (custody scope) and whether it may write
  knowledge (a harvester is a type permitted to write);
- its communication **reach**, in both directions.

`reach` is one field with a monotone ladder, each level including the ones
below:

```text
reach: owner     # only agents owned by the same human
reach: team      # any agent in the deployment's team
reach: org       # any team in the same organization
reach: external  # agents outside the organization
```

"No communication" is not a level; it is the communication slot set to
`none`. `reach` governs whom an instance may address and who may address it;
the communication implementation enforces both sides.

**Proposed.** The type is exported to hooks and dispatched commands as
`OATS_SOUL_TYPE`; packages may ship types; a type may declare `reach`.

**Test.** Two souls of different types, spawned in one installation, receive
different capability sets and different knowledge scopes with no per-soul
configuration.

## Capability manifest and lifecycle events

**Shipped.** A capability is a set of scripts, skills, and docs with an
`oats.json` manifest declaring: `capability` (id), optional `layer`,
`skills`, `inject`, `commands`, `requires` (host commands and runtime
packages), `environment` (launch variables it may contribute, vendor-prefixed),
and `hooks`. Accepted events are `soul-scaffold`, `spawn`, and `retire`. Hooks
receive `OATS_EVENT`, `OATS_CAPABILITY`, `OATS_LAYER`, `OATS_INSTANCE`,
`OATS_HOME` (with `OATS_INSTANCE_HOME` as its alias), `OATS_AGENT`,
`OATS_SOUL`, `OATS_CONTEXT`, `OATS_WORKSPACE`, `OATS_ROOT`, `OATS_LEVEL`,
`OATS_SETTINGS`, `OATS_META`, and the team variables, and may return `meta`, `brief`, `warning`, runtime-specific
`launch` arguments, and (spawn only) `env`. Only a spawn hook may be
`required`. The full contract, including trust and rollback, is in
[capabilities](capabilities.md) and is not restated here.

**Contract.** The event list is the API that makes capabilities composable
and changes rarely. An implementation of any slot below is a capability that
declares that slot as its `layer`; two active capabilities cannot fill one
slot for one soul. Packages talk to the kernel only through the structured
CLI boundary (`oats ... --json`, `OATS_CLI_BIN`), never by importing kernel
files; see [package-runtime-api](design/package-runtime-api.md).

**Proposed.** A fourth event, `harvest`, run by `oats harvest` for every
active capability that declares it, with the same environment as `spawn`
plus the instance whose ephemeral state is to be promoted. The knowledge
implementation's harvest hook is how promotion is triggered without the
kernel knowing the knowledge format.

**Test.** Two capabilities filling the same slot in two installations; the
kernel's code has no branch that names either.

## The knowledge contract

**Shipped.** The `knowledge` slot. The bundled implementation is `oats.okf`:
an OKF bundle under `soul/knowledge/`, per-instance `STATE.md`, `log.md`, and
`notes/`, the `okf` and `memory-harvest` skills, and `oats okf harvest`, which
spawns the capability-defined `memory-harvest` soul attached to the source
instance's work tree. `knowledge: none` is valid and yields no memory files
and no harvest.

**Contract.** Two sides.

*Read.* An instance can find and consult organizational knowledge,
index-first and selectively, and is told how by the implementation's injected
block and skill. Prior decisions, lessons, and playbooks in scope are binding
context; re-deriving what the soul already knows is a bug. **Proposed:** the
scope of what an instance may read is decided by its soul type, which needs
`OATS_SOUL_TYPE` (step 7) before an implementation can act on it.

*Write.* A permitted soul (a harvester type) can promote into the store. The
format is the implementation's. Delivery matches the soul's custody: a commit
on the instance's branch for repository-resident souls, a pull request to
the soul's home repository for workspace-mode souls, direct edits for local
souls.

*Custody, shipped.* Delivery custody is keyed by where the soul resides: a
commit on the instance's branch for repository-resident souls, a pull request
to the soul's home repository for workspace-mode souls, direct edits for local
souls. That is the only custody the kernel and `oats.okf` implement today.

*Custody scoping, proposed.* The requirement is that repository-specific
facts never move into a broader scope by default and that a cross-repository
soul never reads another repository's specifics. The design that meets it
belongs to the knowledge package, not the kernel. Custody layers (soul-shared,
workspace overlay, repository overlay) are one candidate; scoping by soul
type plus residency is another. Nothing here is settled or shipped.

*Promotion doctrine.* What the write side accepts is a decision, not a
format question. The line is decision versus description. Descriptions of
how the code fits together go stale and compete with the code; the write
side rejects them. Decisions, what was chosen, what was rejected, and why,
cannot be derived from code and are accepted, as are inspiration genealogy
("took this from X, rejected Y because Z"), process lessons, and maintained,
timestamped, superseded-on-change slow state about an area. Slow state is
accepted only with its maintenance discipline: a named owner and an
update-on-change rule; a slow-state concept nobody maintains is
indistinguishable from residue and is rejected as such. Task residue
(pull-request numbers, half-done plans, point-in-time environment facts) dies
with the instance. One home per decision; split-brain comes from copies. The
homing rule: architecture facts that several roles need go in repository-
visible docs and souls point to them; craft decisions scoped to one role go
in that role's soul; product direction goes in the steward's bundle,
consulted and never copied. For non-coding specialists none of their
knowledge is re-derivable from a repository, so those souls are almost pure
knowledge. See [knowledge theory](knowledge-theory.md) for the derivation.

**Proposed.** The harvester's input widens from the agent's own notes to the
capture contract (below), so lessons reach the soul even when an agent wrote
no notes; the promotion doctrine is unchanged, only the input channel widens.

**Test.** A plain-Markdown or wiki-backed implementation beside `oats.okf`,
each with its own harvester; a soul's `AGENTS.md` unchanged between them.

## The tasks contract

**Shipped.** The `tasks` slot. Bundled implementations are `oats.jira`
(the `jira-tasks` protocol via `acli`) and `oats.linear` (JSON-first
`oats linear` commands and the `linear-tasks` skill). There is no default;
`tasks: none` is valid.

**Contract.** Where shared work state lives and how an instance claims,
updates, blocks, hands off, and completes work, taught by the implementation's
injected block and skill. An instance is identified to the tracker in a way
that survives the instance (today a label, `agent-<instance-name>`). Task
state, status, and outcomes live in the tracker; conversation lives in the
communication slot; the two are not merged even when one tool offers both.

Verdicts and review outcomes are task records. That is how verification
enters the model without a component: a reviewer is a soul type, and what it
concludes is written where work state lives.

**Test.** Jira and Linear already satisfy it; a third (beads, GitHub Issues)
is the proof that the contract is not a description of either.

## The communication contract

**Shipped.** The `messaging` slot. The bundled implementation is `oats.aweb`:
a team-scoped aweb identity minted per instance at spawn (alias = instance
name) by a required spawn hook and deleted at retire, the `aweb-messaging`,
`aweb-team-membership`, and `aweb-identity` skills, `oats aweb roster` and
`oats aweb setup`, and channel-plugin launch arguments so a session is woken
by incoming mail. `messaging: none` is valid.

**Contract.** How an instance becomes reachable and reaches others. The
implementation supplies:

- an address for the instance, discoverable by teammates, and the roster
  that lists them across machines;
- durable asynchronous mail and synchronous chat, with reply and
  acknowledgement state;
- a wake-up signal when work arrives, with the decision to resume or launch
  left to the runtime owner;
- enforcement of the soul type's `reach`, outbound by what the address can
  reach and inbound by who may deliver to it;
- a statement of whether the address can outlive the instance. For a durable
  specialist the answer should be yes, realized however the implementation
  chooses (for aweb: a soul-level identity served through per-instance
  grants).

Communication is only communication. Task coordination lives in the tasks
slot.

*Fully local.* It must remain possible to run everything filesystem-based and
fully local, meaning with no dependency on a hosted service the operator
cannot replace. Communication needs a server; a self-hosted one on localhost
satisfies the constraint. What the implementation must hold on *its*
servers, and the traffic that must pass through them, is minimized. For aweb
today every delivery passes through an aweb server, hosted or self-hosted on
localhost with the reserved `local` namespace (`aweb-abhw` records the open
decision on a lighter local server). `reach: owner` maps to a contacts-only
inbound mode that aweb does not ship yet (`aweb-abhx`).

**Proposed.** The slot is renamed from `messaging` to `communication` in
documentation first; the config key stays `messaging` until a release
decides otherwise.

**Test.** aweb and a second implementation (a Slack bridge, an A2A gateway)
behind the same injected promises; a soul's `AGENTS.md` unchanged between
them.

## The capture contract (proposed)

**Shipped, outside the slot model.** On machines where `oats setup` has run,
`packages/record` captures Claude Code, Pi, and Codex transcripts plus aw
client logs. It skips sources matched by the local record's ignore list. It
stores captured turns in an append-only, content-addressed record with a search
index (`oats setup`, `oats capture`, `oats recall`). It is not a capability and
no lifecycle hook knows about it.

**Contract.** The format of ephemeral state. Two kinds satisfy it: an agent's
own notes (its report of what mattered, today created by the knowledge
implementation) and a captured session (ground truth). The harvester may
consume either or both. Clothes, the optional spawn-time selection of past
conversation, are one consumer of the same contract and depend on nothing
else in this document. Capture never mediates the harness and fails visibly;
a silent capture gap is worse than none.

**Proposed.** `capture` becomes a slot; `packages/record` is wrapped as a
bundled, framework-trusted capability whose spawn hook records the
instance-to-session mapping; `oats setup`, `oats capture`, and `oats recall`
become kernel aliases resolving to the active capture implementation.
Whether capture is exclusive or additive is open.

**Test.** The record beside a notes-only implementation; the harvester reads
both.

## The runtime provider contract (proposed)

**Shipped.** Two runtimes, `pi` and `claude`, selected by `soul.yaml` or
`--runtime`, launched in a local tmux window; the branching lives inside
`spawnInstance`. The worked example in the
[proposal](2026-09-03-architecture-proposal.md#worked-example-todays-pi-launch-as-bundle-and-handle)
names today's launch in the contract's terms.

**Contract.** OATS hands a provider a realization bundle and receives an
instance handle:

```text
bundle
  instructions            the composed AGENTS.md
  skills                  the exact materialized tree
  environment, launch args   what active capabilities contributed
  task                    TASK.md
  model preference        resolved
  realization artifacts   per (soul, runtime); empty by default

handle
  observe   is it running; where the session transcript is
  steer     attach or send input, where supported
  stop
```

The provider decides how the bundle becomes a running agent. It knows
nothing of tmux; the **platform** (today tmux: session, window, working
directory) is a separate module with launch, alive, stop, and list. The
handle is recorded in `instance.json` with a kind; the existing `tmux` field
is kept beside it.

A provider declares which runtime packages the active capabilities require
of it and verifies them before launch; it never installs them. A provider
without a filesystem receives the bundle as a document rather than files;
how is open.

**Test.** Pi and Claude Code behind one interface with `spawnInstance` free of
runtime names, proven by the golden fixtures (step 1). A hosted provider is
the second real implementation and is not built until one asks.

## The soul store contract (proposed)

**Shipped.** Souls live under `agents/` (committed) or `local-agents/`
(never committed) at a scope, and capability packages may ship souls under
`agents:` in their manifest. Three lookups find them; instance homes live in
the soul-owning repository's primary checkout.

**Contract.** A store lists souls, finds one by name, and says where its
instances live. The filesystem is the single implementation; a package and a
provider registry are the candidates that would prove the contract.
Separating the store from the work target is what removes the repository
from the architecture: today one path decides who the soul is, where its
knowledge lives, and what it works on.

**Test.** A soul found through a second store, instantiated with the same
bundle.

## The work target contract

**Shipped.** Four modes decide what `<instance-home>/work` is and what
discipline the instance follows: `worktree` (an isolated branch), `checkout`
(the shared current branch), `attached` (another instance's tree), and
`workspace` (the whole team scope, read-only). A config may run a setup
script inside each fresh worktree. Retirement preserves ordinary work,
quarantines incomplete cleanup, and never removes a shared tree. The
generated instructions state the home/work boundary before the mode block.

**Contract.** The work target is a parameter of instantiation independent of
where the soul is stored. Each mode is a module that prepares the view,
states its discipline, and knows how to retire it safely, with the
retirement baseline and inspection alongside. The four modes stay exactly as
they are.

**Proposed.** A fifth target, `none`, for instances that operate on nothing
(a mail-only agent). It replaces no mode.

**Test.** An instance of one soul spawned with each target, the same soul
files throughout.

## The package contract

**Shipped, and not touched by the migration.** Acquisition, exact version and
commit, payload and artifact integrity, dependency closure, executable trust,
and transactional restore; see [packages](packages.md),
[capabilities](capabilities.md), and the
[package-engine contract](design/package-engine-contract.md).

**Proposed.** A package may also ship soul types.

## The replaceability test, summarized

| Contract | Implementations today | Second implementation |
| --- | --- | --- |
| Knowledge | `oats.okf` | plain Markdown or wiki |
| Tasks | `oats.jira`, `oats.linear` | beads, GitHub Issues |
| Communication | `oats.aweb` | Slack bridge, A2A gateway |
| Capture | `packages/record`, OKF notes | either alone |
| Runtime provider | Pi, Claude Code (entangled) | a hosted provider |
| Soul store | filesystem | package, provider registry |
| Work target | worktree, checkout, attached, workspace | `none` |

Where only one implementation exists, the contract is still a description of
that one; those rows are the work.
