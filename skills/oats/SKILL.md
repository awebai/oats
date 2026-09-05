---
name: oats
description: >-
  How to operate inside OATS (Open Agent Team Specification): instance layout and
  lifecycle, status, spawn, retire, doctor, operational capability commands,
  canonical-vs-generated instructions, or explaining OATS. For configuring
  deployments (capabilities, layers, agent types, injections) load the
  oats-config skill. Triggers: "spawn an agent", "what agents are running",
  "retire this instance", "oats doctor", "oats status", "how does OATS work".
---

# Operating in OATS

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

## Lifecycle and roster

```bash
oats status [--json]
oats status --team [--json]   # whole-team roster when config declares team: (all repos in the team scope)
# with the aweb messaging integration active, `oats aweb roster` adds the
# cross-machine view: aweb team members, where OATS aliases are instance names
oats create <name> [--description ...] [--type <agent-type>] [--repo ...] [--work worktree|checkout|attached|workspace]
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

Name an instance for both **who it is** and **what this incarnation does** by
spawning with `oats spawn <soul> --purpose <descriptive-role>`. OATS constructs
`<full-soul-name>-<descriptive-role>`; use a short, lowercase kebab-case role
suffix (for example, `desktop-ux` or `terminal-safety`), not an opaque number
or generic word. The current spawn command always retains the full soul name,
so shorten the purpose—not the soul prefix—when the result would be unwieldy.
Do **not** use `oats create` to name an incarnation: it creates a new persistent
soul. Never put secrets, user data, or volatile task details in an instance
name.

To self-retire, first finish memory/commit/reporting requirements, report final
status, then run `oats retire <own-instance> --self`. That returns at once and
a detached completion retires you a few seconds later exactly as an external
`oats retire` would (quiesce, preserve work, hooks, remove the home). If the
completion fails, your window stays, the failure shows in `oats status` with
the retry command, and an operator retries. Never retire merely to clean up;
retirement deletes the instance home.

## Canonical versus generated

Edit `soul/AGENTS.md` for durable role instructions. Instance `AGENTS.md` is a
generated view; marked blocks name their source. Config changes do not mutate
the committed soul. Preview a fresh composition with:

```bash
oats doctor /path/to/context --soul <name>
```

The instance's `.agents/skills/` holds the exact OATS-composed set (kernel +
soul + active capabilities); `.claude/skills` mirrors it. Harness-ambient
skills (user-level, packages, work tree) coexist with this set. Duplicate
names *within* the OATS set fail spawn unless `skill-overrides` explicitly
chooses a source.

## Configuration

Deployments are configured in scoped `oats-config.yaml` files (laptop /
workspace / repository) declaring capability packages, exclusive
knowledge/messaging/tasks layers, agent types, targeting, and injection
overrides. The CLI is the config author (`oats init`, `oats use`, `oats type`,
`oats inject eject`). **Load the `oats-config` skill for all configuration
work** — this skill covers operating, not configuring.

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
