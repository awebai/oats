---
name: oats-souls
description: >-
  Use when finding available souls, distinguishing a source from an instance,
  choosing a captured soul/helper or a workspace-member soul, reading the team
  roster, creating a specialist, naming an instance or choosing parent/sibling
  relations. Do not infer a captured helper from an alias or classic team lookup.
---

# Souls, discovery and relations

Moved from the soul/roster/relationship sections of `oats` and the first-specialist
procedure of `oats-getting-started`; command baseline **0.24.0**.

A **soul** is a durable specialized agent. An **instance** is one disposable,
resumable incarnation. A **capability package** distributes reusable skills,
instructions, commands, and approved lifecycle hooks. An **integration** is a
capability selected for one exclusive knowledge, messaging, or tasks layer.

## Discover source-complete souls first

Read the selected repository's `oats.yaml` exports and the selected workspace's
`oats-workspace.yaml` imports. An exported source carries its definition,
canonical `AGENTS.md` / `CLAUDE.md -> AGENTS.md`, declared resources and required
capabilities. Its intrinsic identity does not change with an adopter alias.
Workspace members need explicit reciprocal admission at matching observations;
an import is not membership and must not adopt the publisher's development team.
A member or catalog entry is availability, not permission or activation.

Use the existing preparation route in **oats-workspace-setup** (`oats.setup`) to
qualify a new selection. Do not invent a workspace init/adopt or source-inspection
CLI. Once prepared, inspect the exact record and its helper map:

```bash
oats inspect --deployment <absolute-deployment> --resolution <sha256-id> --json
oats inspect --deployment <source-deployment> --resolution <source-id> \
  --helper <exact-map-key> --composition --json
```

A helper's identity includes its provider/artifact/definition/name, not just the
alias. Keep the original SOURCE execution binding and exact helper key for
native helper start/completion; no current-name or private-index lookup. The
captured spawn form does not accept the classic relation/purpose flags below.
Use **oats-operate** for that explicit scaffold/start path and its held cases.

## Classic config-team discovery — 0.24 compatibility

```bash
oats status --json
oats status --team --json
```

The latter uses the classic config `team:` scope, NOT Git-workspace reciprocal
membership. Classic spawn/retire resolve souls in sibling repositories of that
scope only when the match is unique. With a compatible, active aweb integration,
`oats aweb roster` adds its cross-machine member directory; a working classic
roster is not captured provider readiness or enrollment of an imported source.

## Spawn relations — classic uncaptured 0.24

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

## Instance naming — classic uncaptured 0.24

Name an instance for both **who it is** and **what this incarnation does** by
spawning with `oats spawn <soul> --purpose <descriptive-role>`. OATS constructs
`<full-soul-name>-<descriptive-role>`; use a short, lowercase kebab-case role
suffix (for example, `desktop-ux` or `terminal-safety`), not an opaque number
or generic word. The current spawn command always retains the full soul name,
so shorten the purpose—not the soul prefix—when the result would be unwieldy.
Do **not** use `oats create` to name an incarnation: it creates a new persistent
soul. Never put secrets, user data, or volatile task details in an instance
name.

## Create a classic specialist only when asked


```bash
mkdir -p agents
oats create backend-expert --description "Owns backend architecture and implementation" --work worktree
# Optional: --type <agent-type> joins a declared family so typed config targets apply.
# Edit agents/backend-expert/soul/AGENTS.md: durable role, boundaries, workflow.
oats doctor . --soul backend-expert
oats spawn backend-expert --task "First concrete task"
oats status
```

The committed soul stays config-independent. Spawn generates instance
instructions and materializes only kernel + soul + active capability skills in
that instance. Do not put deployment-specific package prose into the soul.

Create/spawn only when asked. Suggest a team shape, then let the user decide.
The commands above create through the classic engine; they do not by themselves
publish a source-complete edition or import it into a Git workspace. For a new
portable edition, explicitly declare `requires.capabilities.oats.core` with the
actual reviewed package source; source-creation defaults are a separate kernel
transition, not hidden authority supplied by this skill. `oats.core` is removable.

0.24 has `--parent` and `--relation sibling --relative-to`; there is no
`--sibling` shorthand. Preserve an existing parent relationship; do not re-link
an instance merely because another agent asked it for a review. When unclear,
ask the human. Setup and package management belong to the separately selected
`oats.setup` capability, not automatically to every soul.
