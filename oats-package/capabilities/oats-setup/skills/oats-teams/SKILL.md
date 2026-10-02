---
name: oats-teams
description: >-
  Use when declaring a team (shared in oats-workspace.yaml, or local with
  `oats teams add` when the workspace allows local teams), choosing the
  workspace's or a soul's default team, deciding which teams a soul may join
  (`souls:` in oats-workspace.yaml, read with `oats soul teams`), deciding
  which messaging team an instance joins, joining or leaving a team at spawn
  or later, or diagnosing E_TEAM_UNKNOWN, E_TEAM_NOT_ELIGIBLE,
  E_TEAM_UNCONFIGURED, E_TEAM_IN_USE, E_TEAM_SHARED, E_TEAM_EXISTS,
  team-unmapped, team-label-collision, default-team-changed,
  team-soul-unknown, local-teams-closed or a removed `souls.teams` /
  `souls.default` in oats-local.yaml (upgrading from 0.36). Also when an old
  config still has messaging.byTeam, defaults.byTeam or a soul/membership
  `team:`, and when someone expects a team to restrict or grant access (it
  never does). Part of the setup and config of an OATS workspace (oats.setup);
  day-to-day operation inside an instance is oats.core.
---

# Teams (team model 3, OATS 0.38.0)

The contract is `docs/workspaces.md` ("Teams") and `docs/capabilities.md`
("Teams in the provider environment") in the installed kernel. A **team** is a
messaging-provider team (for oats.aweb, an aweb team id) under a **label**
(`engineering`, `okf`). **A team organises and routes messages; it never
gates, restricts, grants trust or partitions knowledge.**

An instance in two teams is a bridge between them, so which teams an
organisation's instances may join, and their default team, are the
organisation's decision: committed in its workspace file, closed by default.
This prevents accidental joins and makes the intended team set visible and
reviewable in Git. It does not enforce anything against a deliberate bridge:
an operator holding two identities can relay between them, and the messaging
provider's admission controls who holds credentials for a team, not what a
process does with what it reads.

## Where teams are declared

```yaml
# oats-workspace.yaml (committed, shared: edited by a PR)
teams:
  engineering: { description: Platform and release automation, team: "engineering:acme.aweb.ai" }
  security:    { team: "security:acme.aweb.ai" }
  docs:        { team: "docs:acme.aweb.ai" }
  reviewers:   { description: Review rota }        # no id yet: team-unmapped
defaultTeam: engineering            # optional: the workspace's fallback default (a shared label)
localTeams: false                   # optional, default false: may deployments declare their own teams?
souls:                              # optional: per pattern, the default and the other teams a soul may join
  "*": { teams: [] }                                  # unlisted souls: default only
  security-souls/*: { default: security, teams: [engineering] }
  security-souls/incident-responder: { default: security, teams: [engineering, docs] }
  oats.engineering/*: { teams: any }                  # any = every shared team of this file
```

```yaml
# oats-local.yaml (this deployment only; only with localTeams: true)
teams:
  mine: { team: <team id>, description: My personal team }
defaultTeam: mine
```

- A **shared** team is the same provider team for everyone. Without `team` it
  is unmapped: `team-unmapped` (a warning; blocking when it is the default).
  Its owner creates the team (`oats aweb setup`) and commits the id.
- **`souls:` keys are patterns:** `<member>/<soul>` or `<package>/<soul>`,
  `<member>/*` or `<package>/*`, and `"*"`. Member and package names are the
  ones `souls.disabled` uses (a member's name is its repository's name). A
  bare soul name is refused.
- Every label in `defaultTeam` and `souls:` must be a shared team of this
  file: an unknown label, or a `default` / `defaultTeam` that is not one, is
  `E_WORKSPACE_SCHEMA` when the file is read. A `souls:` key that is neither a
  pattern nor a discovered soul's qualified name is `team-soul-unknown` (a
  warning, in readiness and `oats teams --json` problems).
- **Local teams** are allowed only when the workspace says `localTeams: true`.
  A local team always has `team`. A label in both files is
  `team-label-collision` (a warning): the shared one wins; rename the local
  one.
- soul.yaml and oats-membership.yaml say nothing about teams. A soul or
  membership `team:`, `external[].team`, `messaging.byTeam` and
  `defaults.byTeam` are schema errors naming the replacement.

## Resolution

- **The most specific `souls:` key wins outright for `teams`** (lists never
  merge): the soul's own key, then `<member|package>/*`, then `"*"`. The
  default comes from the most specific key that sets one. So
  `a/*: {default: security}` and `a/x: {teams: [docs]}` give soul a/x default
  security and teams [docs] only.
- **A soul's default**, in order: its `souls:` default; else the
  deployment's `defaultTeam`, only when `localTeams: true`; else the
  workspace's `defaultTeam`; else none (`E_TEAM_UNCONFIGURED` when messaging
  is active). `OATS_DEFAULT_TEAM_FROM` (`defaultTeam.from`) says which:
  `soul`, `deployment` or `workspace`.
- **A soul's teams** (what it may join): its default, plus the `teams` of its
  matching `souls:` key, plus, with `localTeams: true`, every local team the
  deployment declares. A soul no key matches (and no `"*"`) gets its default
  only, member and package souls alike: a workspace opens a package
  explicitly.
- Each team row carries `from` (where the label is defined: `shared` or
  `local`) and `via` (why the soul may join it: an ordered subset of
  `default`, `workspace` from `souls:`, `local` for a local team under
  `localTeams: true`).
- A local `defaultTeam` that neither file declares is `E_TEAM_UNKNOWN`: a
  spawn, preview or `inspect --soul` is refused.
- Capabilities compose from the workspace defaults and the soul only; a team
  adds none.

## The verbs

Config only: they never call a provider. Run them from the deployment.

```bash
oats teams [--json]                                   # teams, ids, the default, localTeams, the workspace's souls:, problems
oats teams add <label> --team <id> [--description d]  # a local team (needs localTeams: true); the first add sets the local default
oats teams remove <label>                             # a local team nothing references
oats teams default <label>                            # the local default (needs localTeams: true)
oats soul teams <soul>|'*' [--json]                   # read only: a soul's default, its teams, and which souls: key applied
```

- `add`, `remove` and `default` rewrite `oats-local.yaml` in place (comments
  kept). Which teams a soul may join, and its default, are changed only by a
  PR to `souls:` in `oats-workspace.yaml`.
- `oats soul teams` reports `match` and `defaultMatch` (the `souls:` keys
  that gave the teams and the default) and `via` on each row.
- `E_TEAM_EXISTS`: the label is already declared (`from` says where).
- `E_TEAM_SHARED`: you tried to remove a shared team; edit
  `oats-workspace.yaml` by PR instead.
- `E_TEAM_IN_USE`: the local team is the `defaultTeam` (`usedBy`). Nothing
  cascades: change the default first.
- `oats teams remove` works even when local teams are closed: it is how you
  clear them out after committing them to the workspace file.

## Local teams closed (`local-teams-closed`)

With `teams` or `defaultTeam` in `oats-local.yaml` and no `localTeams: true`
in the workspace, spawn, preview and `inspect --soul` refuse with
`E_WORKSPACE_SCHEMA` reason `local-teams-closed`; `oats teams` and readiness
report it as a failure, and `oats doctor` checks it offline from the cached
workspace file. Two fixes:

1. Add `localTeams: true` to the workspace file (by PR), or
2. commit the teams and `defaultTeam` in the workspace file, then remove them
   from `oats-local.yaml` (`oats teams remove <label>`).

A standalone deployment (explicit `standalone:`, or a fallback when the
workspace cannot be read) has no workspace rules: its local teams and
`defaultTeam` apply.

## Joining

- **At spawn an instance joins its default team only.** Its identity lives
  there. The soul's other teams are eligible: offered, joined only on request.

  ```bash
  oats spawn <soul> --preview                                   # teams + defaultTeam
  oats spawn <soul> --purpose <slug> --provider oats.aweb join=engineering,docs
  ```

- Later, the provider's own verbs join and leave (for oats.aweb,
  `oats aweb join`; see `/aweb-team-membership`). Joining a team the soul is
  not eligible for is refused by the provider (`E_TEAM_NOT_ELIGIBLE`). A
  provider leaves a team only on a live team list, never a recorded one. A
  scheduled wake uses the teams recorded at spawn.
- The kernel never joins anything. It hands the provider `OATS_DEFAULT_TEAM`,
  `OATS_DEFAULT_TEAM_ID`, `OATS_DEFAULT_TEAM_FROM`, `OATS_TEAMS` (mapped rows)
  and `OATS_TEAMS_SOURCE` (`live` or `recorded`).

## Add a team

1. Shared: add `teams.<label>` to `oats-workspace.yaml` by PR (with `team`
   once the provider team exists; its owner creates it with `oats aweb setup`,
   which prints the id to commit). Local (only with `localTeams: true`):
   `oats aweb setup --create <label>` creates a new team and runs
   `oats teams add` for you; an existing team you already belong to is
   `oats teams add <label> --team <id>`.
2. Let souls join it: add the label to the `teams` of their `souls:` entry in
   the same PR (or set `default:`). A local team under `localTeams: true` is
   eligible for every soul of that deployment.
3. Check: `oats teams` (no problems), `oats soul teams <soul>` and
   `oats spawn <soul> --preview` (the label is in `teams` with its id and
   `via`).

## Create a team, or join a shared one (onboarding)

`oats aweb setup` (oats.aweb 1.17) is the one command that creates messaging
accounts and teams, and it records what it creates in `oats-local.yaml`. It
runs only when asked, never at spawn:

- **Nothing configured yet:** `oats aweb setup --username <u>` creates the
  account and its first team, recorded in `oats-local.yaml` as the local
  default. That needs `localTeams: true`; otherwise it is
  `local-teams-closed`: commit the team and `defaultTeam` to the workspace
  file and remove them here.
- **A new team of your own:** `oats aweb setup --create <label>` (needs
  `localTeams: true`).
- **A shared team without an id yet** (its owner): `oats aweb setup` creates it
  and prints the id; commit it to `oats-workspace.yaml` by a PR.
- **A shared team someone else created:** ask its owner for an invite, then
  `oats aweb setup --join <label> --invite <token>`.

## Gotchas

- Changing a soul's default does not move a running instance:
  `oats inspect --home` reports `default-team-changed`; respawn.
- A team never hides a soul or restricts a capability. Visibility comes from
  membership, and repo-owned capabilities are `private: true` in their
  manifest.
- Migrating from 0.29: move each `byTeam` id into `teams.<label>.team`, and
  each soul/membership `team:` into `souls:` in the workspace file.

## Upgrading from 0.36

0.38.0 refuses `souls.teams` and `souls.default` in `oats-local.yaml`
(`E_WORKSPACE_SCHEMA` reason `removed-key`; `oats doctor` reports the same).
The error names each key and prints the `souls:` snippet to commit; bare soul
names appear as `<member>/<soul>` for you to qualify. Per workspace: commit
`souls:` entries for what each deployment said (patterns never merge, so a
soul's entry lists `"*"`'s teams too), and `defaultTeam:` when the deployment
default is a shared team; for personal local teams add `localTeams: true` or
commit them; then remove the old keys from each `oats-local.yaml`. Steps:
`docs/release-notes/v0.38.0.md`.
