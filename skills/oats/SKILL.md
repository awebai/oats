---
name: oats
description: >-
  Use only for operating a legacy uncaptured OATS deployment through its current
  config chain: legacy status, spawn, retire, doctor, capability commands, and
  instance layout. Triggers: "legacy OATS", "uncaptured instance", or an
  instance without executionBinding. For a captured portable composition, load
  oats-portable instead; never use this skill to fill missing captured inputs.
---

# Operating legacy uncaptured OATS

> **Legacy-only procedure.** This skill documents the current config-chain
> engine for instances without a captured execution binding. A portable instance
> must use **oats-portable** and explicit deployment/resolution authority. Never
> apply the config cascade, agent types, or team-scoped lookup below to complete
> or override a captured record.

A **soul** is a durable specialized agent. An **instance** is one disposable,
resumable incarnation. A **capability package** distributes reusable skills,
instructions, commands, and approved lifecycle hooks. A **core capability** is
the one capability a soul has for knowledge, messaging or tasks.

## Instance home

| Path | Meaning |
|---|---|
| `TASK.md` | briefing and task |
| `AGENTS.md` | generated: the soul's instructions + active capability instructions (the home has no soul link) |
| `CLAUDE.md -> AGENTS.md` | compatibility view |
| `.agents/skills/` | exact runtime skill set |
| `work/` | all repository work happens here |
| `instance.json` | repo, branch, capabilities, skills, instruction sources, trust, hooks |

Memory files exist only when the knowledge capability creates them.
Follow their injected protocol.

## Lifecycle and roster

```bash
oats status [--json]
# with the aweb messaging capability active, `oats aweb roster` adds the
# cross-machine view: aweb team members, where OATS aliases are instance names
# a soul is authored in a member repository — souls/<name>/soul.yaml + AGENTS.md
# (soul.yaml sets work: worktree|checkout|attached|workspace|directory) — then `oats sync`
# directory mode = owned execution directory; repo is config context (no Git
# required); --work-dir and --branch are rejected; retirement preserves work.
# workspace mode = cross-repo coordinator: ./work is the whole team scope; read
# all member repos, edit none; if a knowledge capability is active, IT defines how
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

### Spawn relations — choosing how the new instance relates to you

When you spawn, declare what the new instance IS to you — the workspace is
viewed as clusters of related agents, and the relation is how clusters form:

- **child** (`--relation child --relative-to <you>`, or `--parent <you>`) —
  the new instance works FOR you and nests under you. Example: a coordinator
  spawning the developers of its feature.
- **parent** (`--relation parent --relative-to <you>`) — the new instance
  oversees YOU: your recorded lineage is re-pointed so it becomes your parent.
  Example: spawning a maintainer of your own PR — the maintainer sits
  above you. When it later retires, lineage is spliced automatically: you
  return to your previous parent (or top-level).
- **sibling** (`--relation sibling --relative-to <you>`) — a peer at your
  level, in your cluster. Example: enlisting a peer coordinator in another
  repo, or an architecture coordinator helping you.
- **unrelated** (default, no flags) — no link. Example: work with no
  connection to yours.

Exception: **attached** work mode implies child-of-owner — an attached agent
shares its owner's work tree and is always that owner's child; relation flags
are rejected there.

This is judgment, not mandate: every workspace differs, and a soul's own
explicit relation instructions (in its AGENTS.md or task briefing) take
precedence over these defaults. When unsure which relation fits, check with
the human.

Do not spawn on your own judgment. Spawn when the human asks or a documented
workflow requires it.

### Instance naming

By default the name is `<soul>-<purpose>`: `oats spawn <soul> --purpose
<descriptive-role>` names the incarnation for both **who it is** and **what it
does**. Use a short, lowercase kebab-case role (for example, `desktop-ux` or
`terminal-safety`), not an opaque number or generic word. `--name <slug>` gives
an exact, unprefixed name instead (not together with `--purpose`); it must be a
slug and must not be a soul name. Instance names are unique across the whole
deployment: a derived name in use gets `-2`, `-3`…; an explicit `--name` in
use is refused, never silently suffixed.
Do **not** author a new soul to name an incarnation: a soul is a durable
definition in a member repository. Never put secrets, user data, or volatile task details in an instance
name.

To self-retire, first finish memory/commit/reporting requirements, report final
status, then run `oats retire <own-instance> --self`. That returns at once and
a detached completion retires you a few seconds later exactly as an external
`oats retire` would (quiesce, preserve work, hooks, remove the home). If the
completion fails, your window stays, the failure shows in `oats status` with
the retry command, and an operator retries. Never retire merely to clean up;
retirement deletes the instance home.

## Canonical versus generated

Durable role instructions live in the soul, edited in its member repository
(`souls/<name>/`) and reviewed like code; the home has no soul link. Instance
`AGENTS.md` is a generated view; marked blocks name their source. Config changes do not mutate
the committed soul. Preview a fresh composition with:

```bash
oats doctor /path/to/context --soul <name>
```

The instance's `.agents/skills/` holds the exact OATS-composed set: the
soul's own skills, and each module's under `.agents/skills/<module>/`;
`.claude/skills` mirrors it. Harness-ambient skills (user-level, packages,
work tree) coexist with this set. A duplicate name within the OATS set fails
spawn (`E_SKILL_DUPLICATE`); there is no override.

## Configuration

A deployment is configured by files, not by config-editing commands:
`oats-workspace.yaml` (shared: members, packages, teams, defaults) in the
workspace's host repository, `oats-membership.yaml` in each member, each
soul's `soul.yaml`, and the per-machine `oats-local.yaml` (host settings).
After a change, run `oats sync`. Setting up a deployment is the oats.setup
capability's work (**oats-onboarding**, **oats-package-pins**). This skill
covers operating, not configuring.

## Commands and doctor

Operational namespaces run only when their package is active in the current
context/instance:

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
