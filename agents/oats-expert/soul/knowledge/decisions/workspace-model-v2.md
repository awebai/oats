---
type: Decision
title: Workspace model v2 — one workspace per org, members are trust, nothing is installed, every capability is copied whole into the instance
status: accepted
description: ACCEPTED (human, 2026-09-23) after a full brainstorm. Thirteen decisions that replace the per-soul `source:` provenance grammar, the installed-capability tier and the classic config surface with one rule — a soul says WHERE each capability comes from (a member repo or a package), never which version; membership (reciprocal handshake) is the trust; packages are the only versioned thing; every capability is copied whole into the instance at spawn; harnesses start normally.
tags: [workspace, membership, capabilities, packages, provenance, materialization, teams, harness, v2]
timestamp: 2026-09-23
---

Decided with the human on 2026-09-23 in one sitting, after a critique that the
current model (see `architecture/` and `docs/workspaces.md`) was "complicating
this": provenance declared per soul per capability, three files each knowing
about versions, a workspace file importing its own members' souls, a
deployment config repeating activation for every capability. The worked
example (an imaginary org with three teams and five repos) lives in the
framework repo at `docs/design/2026-09-23-simplified-workspace-model.md`; this
concept is the normative record. No migration: the only existing deployment
is rebuilt by its operator. Nothing is implemented yet.

# The rule

**Every capability an instance runs is copied whole into that instance at
spawn. A capability comes from one of two kinds of source; only one kind is
versioned.**

| Source kind | `from:` | Versioned | Trust |
|---|---|---|---|
| Member repo | `<repo>` or `here` | no — always the member's latest state | membership |
| Package | `package` | yes — the version pinned in the workspace's `packages:`; the lock records exact commit + integrity | executables approved once per version, recorded in the lock |

A soul names each capability **with where it comes from — a location, never
a version**. The workspace's `packages:` says which version; materialization
*records* the exact state (repo/package, commit, content hash) in
`instance.json`. Resolution is a handshake check plus a lookup.

# The thirteen decisions

1. **Reciprocal membership is a hard gate.** A repo is a member only when
   `oats-workspace.yaml` lists it AND the repo's `oats-membership.yaml` names
   the workspace. One file per side of the handshake.
2. **Membership is the whole trust decision for member capabilities** —
   the same model as a repo's committed `.agents/skills/`: the repo's access
   control (who can push) is the boundary, the branch's latest state is what
   runs. No per-operator trust lists, no per-capability approval for members.
   Packages keep a one-time executable approval per version because they
   come from outside that boundary.
3. **Discoverable by default.** Every `souls/*/soul.yaml` and
   `capabilities/*/oats.json` in a member is a workspace item. An item that
   wants to stay internal says `private: true` in its own definition (usable
   only from its own repo). No export lists anywhere.
4. **`oats-membership.yaml` replaces `oats.yaml`**: the backlink, plus an
   optional default `team:` label for the repo's items. Nothing else.
5. **No migration.** Clean v2; v1 declaration files are errors naming the
   schema, not fallbacks. `oats init` / `use` / `install` / `restore` go away.
6. **`from:` on every capability reference** (`<member repo>` | `here` |
   `package`). Resolution: `from: package` → some `packages:` entry provides
   it → fetch at the locked commit → integrity → approval → copy;
   `from: <repo>` → confirmed member → has `capabilities/<name>/oats.json` →
   not private unless same repo → copy, record commit + hash. Two members may
   export the same bare name; each reference says which it meant.
7. **Full per-instance materialization.** Skills, injects, scripts and hooks
   are copied into `<instance>/.oats/modules/<capability>/`. A running
   instance never changes under itself; a member moving or `packages:` being
   bumped affects only new spawns. No shared modules directory. `instance.json`
   records `from`, commit and hash per module, so "how far behind" is visible.
8. **Nothing is installed.** A package is a place to fetch from with a version
   attached; a member is a place to fetch from without one. No installed-
   capability directory, no activation step. A fetch cache may exist as
   invisible plumbing. The lock (v3) carries the per-version executable
   approval next to the commit it approved; a moved tag fails integrity and
   asks again.
9. **Discovery and resolution work against Git remotes, never local
   clones.** The only thing that needs a clone is a soul's work target.
   The deployment layout is the operator's; the taught convention
   (onboarding skill) is `<name>-workspace/` with `oats-local.yaml`,
   `oats-lock.json`, `agents/` and the member clones inside. Spawning a soul
   from a repo not yet cloned is a guided clone-then-spawn.
10. **The handshake is observed with the operator's own read access to both
    halves**, in one access context. An unreadable half is *unconfirmed*
    (`E_MEMBERSHIP_UNCONFIRMED: cannot read <url>`), never a half-success —
    reading the workspace repo *is* being in the workspace. Standalone case: a
    readable member whose workspace you cannot read still offers its souls
    with `from: here` capabilities; `from: <other member>` / `from: package`
    are unresolvable and workspace defaults do not apply.
11. **No `@revision` on members.** A member is always its latest state; a
    team that wants frozen capabilities publishes them as a package.
12. **One workspace per org; teams are labels.** `teams:` in the workspace
    file declares names (e.g. global / engineering / marketing) so labels
    cannot drift; a soul or capability carries `team:`, else its repo's
    default, else "unassigned". `defaults.byTeam.<team>` may add
    capabilities additively (`off` removes). A label never gates, restricts,
    changes trust or partitions the store. The messaging provider's payload
    (per-human private, channels) moves under `messaging:` so "team" means
    one thing.
13. **Harnesses start normally.** OATS is a skill contributor, not a skill
    sandbox: cwd = instance home, the harness's own skill discovery intact;
    capability skills are copied to `<instance>/.agents/skills/<capability>/`
    (the existing `CLAUDE.md → AGENTS.md` and `.claude/skills →
    ../.agents/skills` aliases stay); machine-level and repo-level skills
    resolve exactly as without OATS. OATS keeps composing instructions
    (`AGENTS.md` = soul + injects) and pinning model/provider settings.

# What is removed

Per-soul `source: git:…@v#…` lines and the `git:`/`repo:`/`path:` grammar in
souls; `imports:` of member souls; `exports:` lists; `oats.yaml`; the
installed-capability tier and `oats-config.yaml`'s `capabilities.layers` /
`additive` / `from:` / `global` / `souls:` blocks (activation is derived from
workspace defaults + soul declarations); `oats init` / `use` / `install` /
`restore`; per-soul `stores.<x>.inherit` (stores are declared once in the
workspace); ambient-skill exclusion at launch.

# What is kept

Kernel-neutral provider payloads (`knowledge:`, `messaging:`) and the
`binding` validation contract; the lock (extended with approval); executable
approval for packages; retained resolutions, decision revisions and the
confirmed-apply contract; the official catalog as discovery; every published
Desktop CLI contract (previews report "materialized from X @ commit"); the
canonical-plus-alias instance construction.

# Why

- The trust boundary of a team is its repos' access control. Every layer of
  approval on top of that for the team's own code was ceremony; the model now
  says so plainly and spends its rigor where the boundary actually is
  (packages from outside, the handshake, integrity).
- "Where does this come from" is a fact worth reading in a soul; "which
  version" is a team decision that belongs in one place.
- A running instance that never changes under itself is the invariant
  everything downstream already relies on (retire baselines, confirmed apply,
  Desktop reported facts); full copies make it free.
- Discovery over remotes makes a workspace usable from any laptop layout and
  makes "who can see what" identical to Git's own answer.

# Consequences and follow-ups

- Write the implementation plan (clean v2) and propose it to the human before
  touching `lib/` or `bin/`; the framework's own repos are the first real
  workspace.
- The onboarding skill (`oats-setup-expert`) teaches the `<name>-workspace/`
  convention and the clone-then-spawn flow.
- Schemas: `oats-workspace.schema.json` v2, `oats-membership.schema.json`,
  `soul.schema.json` v2, `oats-local.schema.json`, lock v3.
- Related: `git-workspace-versus-development-package.md` (the packaging split
  this supersedes in part), `official-capabilities-oats-core-setup-and-marketplace.md`
  (unchanged: `oats.core` becomes `from: package` on every soul by default),
  `claude-codex-native-launch.md` (decision 13 extends it to Pi and to skills).
