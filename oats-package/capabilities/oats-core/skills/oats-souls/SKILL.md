---
name: oats-souls
description: >-
  Use when finding which souls the workspace offers and where they come from,
  telling a soul from an instance, reading a soul's definition, choosing how a
  new instance relates to you (child, parent, sibling), naming an instance, or
  proposing a new soul. For running and inspecting instances use oats-operate.
---

# Souls, discovery and relations

A **soul** is a durable role definition kept in Git: `souls/<name>/` in a
member repository of the workspace, holding `soul.yaml`, `AGENTS.md` (its
canonical instructions), `CLAUDE.md → AGENTS.md`, optional `skills/`, and
whatever its slot providers read (for the `oats.okf` knowledge provider,
`okf.json`: which knowledge node it owns and which it reads). An **instance**
is one incarnation of a soul, spawned into its own home for a task. Many
instances of one soul can run at once; each is fixed to the soul commit it was
spawned from.

## Find souls

```bash
oats souls                   # every non-private soul of every confirmed member, with origin and team
oats souls --json
oats workspace status        # which members are confirmed (an unconfirmed member contributes no souls)
```

Each row names the soul, its origin (`member <repo> @ <commit>`, or an
external soul pinned by the workspace), its team label and its work mode.
Souls are discovered **at the member's latest state** over the Git remote; no
local clone is needed to list or spawn them (only a soul's work target needs
a clone).

What discovery does not show, on purpose:

- **Private souls** (`private: true` in `soul.yaml`) are spawnable only from
  their own repository.
- **Souls of a repository that is not a confirmed member.** Membership is
  reciprocal: the workspace lists the repository and the repository's
  `oats-membership.yaml` names the workspace back. A soul left outside
  `souls/<name>/` is invisible.
- In the **standalone view** (the operator can read a member but not the
  workspace host) only that member's souls appear, with `oats.core` as their
  only package.

## Read a soul's definition

```yaml
schemaVersion: 2
name: release-manager                 # must equal the directory name
description: Cuts, verifies and announces releases.
work: worktree                        # worktree | checkout | directory | workspace
team: engineering                     # a label; else the repository's default
capabilities:
  release-tooling: { from: here }     # this soul's own repository
  acme-deploy: { from: package }      # a package the workspace pins
  house-style: off                    # drop a workspace default
```

A soul says **where** each capability comes from, never which version: the
workspace's `packages:` pins versions once. Workspace defaults fill the rest;
`oats spawn <soul> --preview` shows the exact result — modules, commits,
skills and the merged provider settings — without creating anything.

Team labels organise and may add workspace defaults; they never grant or
restrict anything.

## Relations: what the new instance is to you

Spawn only when your human asks or a documented workflow requires it. When you
do, declare what the new instance **is to you** — the roster groups related
instances by these links:

- **child** — `--parent "$OATS_INSTANCE"` (or `--relation child --relative-to
  <you>`): it works **for** you. A coordinator spawning the developers of its
  feature; a reviewer spawning a helper for its own review.
- **parent** — `--relation parent --relative-to <you>`: it oversees **you**;
  your recorded lineage is re-pointed under it. Spawning a maintainer to
  review your own pull request.
- **sibling** — `--relation sibling --relative-to <you>`: a peer in your
  cluster, enlisted for related work.
- **unrelated** — no flags: work with no connection to yours; it appears
  top-level.

An **attached** work mode always makes the new instance a child of the work
tree's owner; relation flags are refused there. A soul's own instructions or
your task briefing take precedence over these defaults; when the relation is
unclear, ask your human.

## Name the instance

By default `oats spawn <soul> --purpose <role>` names the instance
`<soul>-<role>`. Use a short lowercase kebab-case role for what this
incarnation does (`release-0-26`, `desktop-review`), not an opaque number.
`--name <slug>` gives an exact, unprefixed name instead (not with
`--purpose`); it must be a slug and not a soul name. Names are unique across
the deployment: a derived name in use gets `-2`; an explicit `--name` in use is
refused, never suffixed. Never put secrets,
user data or volatile task detail in a name — with a messaging capability the
instance name is also its address.

## Propose a new soul

There is no command that creates a soul. A new soul is a reviewed change to a
member repository: add `souls/<name>/` with `soul.yaml` (`name`,
`description`, `work` required), a canonical `AGENTS.md` and the
`CLAUDE.md → AGENTS.md` link, commit it on a branch in your work tree and
open a pull request. Once merged it is discoverable at the member's latest
state; `oats spawn <name> --preview` verifies it resolves.

Keep a soul universal: role, boundaries and workflow — never machine paths,
accounts, team ids or task state. Those live with the deployment
(`oats-local.yaml`, spawn-time `--provider` values) or in the instance's own
files.
