---
name: oats-operate
description: >-
  Use when operating OATS instances: inspect retained composition, spawn, start,
  status, retire, doctor, home/work layout or generated instructions. Distinguish
  captured authority from classic config commands before acting. For soul discovery
  and relationships use oats-souls; setup belongs to oats.setup.
---

# Operating OATS

Moved from the existing OATS operation skills; command baseline **0.24.0**.
Choose the path from `instance.json.executionBinding`: present means captured,
absent means classic. Invalid-present is a refusal, never a legacy fallback.
This resource capability does not itself change lifecycle or grant permission
to spawn, retire, approve software or alter a deployment.

A **soul** is a durable specialized agent. An **instance** is one disposable,
resumable incarnation. A **capability package** distributes reusable skills,
instructions, commands, and approved lifecycle hooks. An **integration** is a
capability selected for one exclusive knowledge, messaging, or tasks layer.

## Instance home

| Path | Meaning |
|---|---|
| `TASK.md` | briefing and task |
| `soul/` | linked canonical soul |
| `AGENTS.md` | generated canonical soul + active capability instructions |
| `CLAUDE.md -> AGENTS.md` | compatibility view |
| `.agents/skills/` | exact runtime skill set |
| `work/` | all repository work happens here |
| `instance.json` | repo, branch, capabilities, skills, instruction sources, trust, hooks |

Memory files exist only when the selected knowledge integration creates them.
Follow their injected protocol.

## Captured operation — 0.24 baseline

A captured instance executes one immutable managed composition identified by an
explicit deployment and resolution. Its source soul, adopter alias, capability
artifacts, settings, provider bindings, curriculum, helpers, and executable
resources come from that record—not from the current checkout or config chain.
Credentials, provider readiness, memberships, knowledge contents, the work target,
and host tools remain separately checked mutable inputs.

### Authority checklist

1. Read `instance.json.executionBinding` for the exact deployment and resolution.
2. Pass both selectors together. Never infer either from cwd, a source path, a
   package lock, an OS user, or another instance.
3. If the record, retained resource, approval, binding, or host requirement is
   missing or invalid, stop. Do not retry through an unqualified legacy command.
4. Treat `responsibleHuman: null` only as explicit messaging-disabled state. It
   is not an anonymous human or a private-team identity.

### Implemented commands

```bash
oats inspect --deployment <absolute-deployment> --resolution <sha256-id> --json
oats inspect --deployment <absolute-deployment> --resolution <sha256-id> --composition --json
oats <namespace> <command> --deployment <absolute-deployment> --resolution <sha256-id> -- [provider-args]
oats operation run <knowledge|messaging|tasks>:<name> \
  --deployment <absolute-deployment> --resolution <sha256-id> \
  [--home <absolute-instance-home>] [--arg name=value ...] --json
```

For capability helpers, inspect the source's captured helper map and resolve one
exact key before selecting a helper record:

```bash
oats inspect --deployment <source-deployment> --resolution <source-id> \
  --helper <exact-map-key> --composition --json
```

Keep `sourceExecutionBinding` for provider completion commands and the returned
`executionBinding` for the helper. Do not complete through a worker's inherited
selector or use legacy helper-name discovery. Helper inspection is not worker
launch; use the staged public start below and retain its actual dispatch result.

A fresh captured directory scaffold is available only with explicit placement
and no launch:

```bash
oats spawn <captured-subject> \
  --deployment <absolute-deployment> --resolution <sha256-id> \
  --home <absolute-new-home> --no-launch --json
```

The subject must match the retained soul alias or helper name. The home must be
new and its parent physical. This command materializes retained instructions and
skills, creates owned directory work, and runs captured spawn hooks. It does not
select a work repository, launch a model, or infer a team.

### Start the owned captured home

After the explicit scaffold/hooks stage, start using the same retained authority:

```bash
oats session start --deployment <absolute-deployment> --resolution <sha256-id> \
  --home <owned-home> --request <absolute-native-request-json> --json
```

The native request is a closed object, for example:

```json
{"schemaVersion":1,"backend":{"backend":"tmux","binary":"/absolute/tmux","socket":"/absolute/socket","session":"captured"},"task":"Explicit task"}
```

For Herdr, replace only `backend` with
`{"backend":"herdr","binary":"/absolute/herdr","socket":"/absolute/herdr.sock","protocol":20}`. The 0.24 baseline also supports Herdr protocol22; use the
actual supported protocol of the selected operator endpoint.
Use an explicit existing operator-managed socket; this route never starts a
Herdr daemon or falls back to tmux. Actual workspace/pane/terminal IDs arrive in
the receipt after allocation, never from caller naming. API discovery advertises
`oats.captured-session@2` with both backends and `readiness:not-checked`.

Runtime/model/yolo come from the capture, never this request. Optional
`stopGraceMs` is bounded 1–300000. No env/io/credential/provider/config fields.
For an already scaffolded helper, pass the SOURCE selectors and add
`--helper <exact-map-key>`; the home must match the returned dedicated helper
binding. This revalidates the edge, not just a helper name.

Use `session restart` for a distinct restart request in the same incarnation.
Once stored, task/backend can be omitted to use owned values. Use
`--retry-intent <saved-executionId>` only for an explicit replay/retry of that
same logical request. An unknown Herdr allocation must remain held under its
saved intent; never repeat workspace creation or guess its IDs from a label.
Preserve `error.details.nativeCustody` and the indexed
pending identity on uncertainty; never allocate another home/ID to disguise it.
`dispatchAccepted` means native dispatch, not task completion/model health or
privacy. A completed receipt replay may return `replayed:true` instead.

### Current refusal boundary

Captured input/wake/retire, unqualified managed runtime packages/contributions, extra
native arguments, non-directory work targets and backends other than tmux/Herdr
still refuse. Do not strip selectors or call legacy forms as a workaround. A scaffold marked `spawn-failed-cleanup-required`
may contain external hook effects; preserve it and escalate rather than deleting
it. A scaffold marked `spawned-launch-pending` is not a running instance.


Preparation and exact approval guidance live in **oats-workspace-setup** and
**oats-packages** from `oats.setup`. If that capability is not selected, ask the
operator/setup expert; do not assume those skills are ambient.

## Classic uncaptured compatibility — 0.24

These commands use the config chain, not retained source authority. Do not use
them as a fallback for a captured failure. Run operational commands from instance
home, not its work tree; use an explicit scope only when deliberately operating elsewhere.

### Lifecycle and roster

```bash
oats status [--json]
oats status --team [--json]   # whole-team roster when config declares team: (all repos in the team scope)
# with the aweb messaging integration active, `oats aweb roster` adds the
# cross-machine view: aweb team members, where OATS aliases are instance names
oats create <name> [--description ...] [--type <agent-type>] [--repo ...] [--work worktree|checkout|attached|workspace|directory]
# directory mode = owned execution directory; repo is config context (no Git
# required); --work-dir and --branch are rejected; retirement preserves work.
# workspace mode = cross-repo coordinator: ./work is the whole team scope; read
# all member repos, edit none; if a knowledge layer is active, IT defines how
# soul updates are delivered (see that capability's own instructions)
oats spawn <agent> [--task ...] [--purpose ...] [--relation child|sibling|parent|unrelated --relative-to <instance>] [--parent <instance>] [--no-launch] [--json]
# lineage is explicit: agents spawning sub-agents declare their RELATION to the
# new instance with --relation + --relative-to (--parent X is sugar for
# --relative-to X --relation child). Without a relation the spawn is
# operator-origin and appears top-level. Attached-mode spawns are ALWAYS
# children of the work-tree owner (relation flags are rejected there).
# when config declares team:, spawn/retire also resolve souls and instances
# defined in sibling repos of the team scope (unique match wins; the instance
# homes with its owning repo, works in that repo, resolves that repo's config)
oats retire <instance> [--delete-branch]
```

For discovery, creation, naming and relationships, load **oats-souls**.

To self-retire, first finish memory/commit/reporting requirements, report final
status, then run `oats retire <own-instance> --self`. That returns at once and
a detached completion retires you a few seconds later exactly as an external
`oats retire` would (quiesce, preserve work, hooks, remove the home). If the
completion fails, your window stays, the failure shows in `oats status` with
the retry command, and an operator retries. Never retire merely to clean up;
retirement deletes the instance home.

## Canonical versus generated

Edit the canonical source `AGENTS.md` in the tracked source/work tree you own,
NOT through the instance home's `soul/` link. Instance `AGENTS.md` is a generated
view; marked blocks name their source. Retained artifacts are immutable: edit
the source and prepare a new composition, never patch the captured copy. Config
changes do not mutate the committed soul. For classic composition, preview with:

```bash
oats doctor /path/to/context --soul <name>
```

The instance's `.agents/skills/` holds the exact OATS-composed set (kernel +
soul + active capabilities); `.claude/skills` mirrors it. Harness-ambient
skills (user-level, packages, work tree) coexist with this set. Duplicate
names *within* the OATS set fail spawn unless `skill-overrides` explicitly
chooses a source.

## Commands and doctor

For CLASSIC uncaptured instances, operational namespaces run only when their
package is active in the current context/instance:

```bash
oats okf harvest
oats linear issue list ...
```

Package-management commands remain global. Use doctor first when something is
missing:

```bash
oats doctor [context] [--soul <name>] [--json]
```

It shows config chain, acquired/active packages, layer selection, target and
settings provenance, requirements, trust, skill sources, instruction blocks,
and—with `--soul`—final composed text.

Infrastructure faults should be reported to the spawner/human, not repaired by
an instance ad hoc.
