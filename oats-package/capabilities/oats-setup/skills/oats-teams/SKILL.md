---
name: oats-teams
description: >-
  Use when declaring a team (shared in oats-workspace.yaml or local with
  `oats teams add`), choosing the deployment's default team, putting souls in
  teams (`oats soul teams`), deciding which messaging team an instance joins,
  joining or leaving a team at spawn or later, or diagnosing E_TEAM_UNKNOWN,
  E_TEAM_NOT_ELIGIBLE, E_TEAM_UNCONFIGURED, E_TEAM_IN_USE, E_TEAM_SHARED,
  E_TEAM_EXISTS, team-unmapped, team-label-collision, default-team-changed or
  team-model-3-migration (preparing for 0.37.0's team model 3).
  Also when an old config still has messaging.byTeam, defaults.byTeam or a
  soul/membership `team:` (removed in 0.30), and when someone expects a team
  to restrict or grant access (it never does). Part of the setup and config of
  an OATS workspace (oats.setup); day-to-day operation inside an instance is
  oats.core.
---

# Teams (team model v2, OATS 0.30)

The contract is `docs/workspaces.md` ("Teams") and `docs/capabilities.md`
("Teams in the provider environment") in the installed kernel. A **team** is a
messaging-provider team (for oats.aweb, an aweb team id) under a **label**
(`engineering`, `okf`). **A team organises and routes messages; it never
gates, restricts, grants trust or partitions knowledge.**

## Where teams are declared

```yaml
# oats-workspace.yaml (committed, shared: edited by a PR)
teams:
  engineering: { description: Platform and release automation, team: <team id> }
  reviewers:   { description: Review rota }        # no id yet: team-unmapped
```

```yaml
# oats-local.yaml (this deployment only: edited by the verbs below)
teams:
  mine: { team: <team id>, description: My personal team }
defaultTeam: engineering
souls:
  teams:
    "*": [engineering]               # every soul
    reviewer: [reviewers]            # a soul by bare name
    oats.okf/knowledge-harvester: [okf]   # a package soul
  default:
    reviewer: reviewers              # must be one of that soul's teams
```

- A **shared** team is the same provider team for everyone. Without `team` it
  is unmapped: `team-unmapped` (a warning; blocking when it is the default).
  Its owner creates the team (`oats aweb setup`) and commits the id.
- A **local** team always has `team`. A label in both files is
  `team-label-collision` (a warning): the shared one wins; rename the local one.
- Which souls are in which teams is **local**. Nothing committed besides the
  shared `teams:` mentions teams: soul.yaml `team`, oats-membership.yaml
  `team`, `external[].team`, `messaging.byTeam` and `defaults.byTeam` were
  removed in 0.30 and are schema errors naming the replacement.

## Resolution

- A soul's default: `souls.default[soul] ?? defaultTeam`.
- A soul's teams: its default ∪ `souls.teams["*"]` ∪ `souls.teams[soul]`.
- An undeclared label is `E_TEAM_UNKNOWN`: a spawn, preview or
  `inspect --soul` of that soul is refused.
- A `souls.default` that is not one of the soul's teams is
  `E_TEAM_NOT_ELIGIBLE`.
- Messaging active and no default at all is `E_TEAM_UNCONFIGURED`.
- Capabilities compose from the workspace defaults and the soul only; a team
  adds none.

## The verbs

Config only: they rewrite `oats-local.yaml` in place (comments kept) and never
call a provider. Run them from the deployment.

```bash
oats teams [--json]                                   # teams, ids, the default, problems
oats teams add <label> --team <id> [--description d]  # a local team; the first add sets the default
oats teams remove <label>                             # a local team nothing references
oats teams default <label>                            # a label of either file
oats soul teams <soul>|'*' [--add a,b] [--remove a,b] [--default <label> | --clear-default] [--json]
```

- `E_TEAM_EXISTS`: the label is already declared (`from` says where).
- `E_TEAM_SHARED`: you tried to remove a shared team; edit
  `oats-workspace.yaml` by PR instead.
- `E_TEAM_IN_USE`: `usedBy` lists the references (`defaultTeam`,
  `souls.teams:<soul>`, `souls.default:<soul>`). Nothing cascades: clear them
  first (`oats teams default`, `oats soul teams … --remove`).
- `'*'` takes no `--default`: the deployment's default is `oats teams default`.

## Joining

- **At spawn an instance joins its default team only.** Its identity lives
  there. The other teams are eligible: offered, joined only on request.

  ```bash
  oats spawn <soul> --preview                                   # teams + defaultTeam
  oats spawn <soul> --purpose <slug> --provider oats.aweb join=engineering,okf
  ```

- Later, the provider's own verbs join and leave (for oats.aweb, see
  `/aweb-team-membership`). A provider leaves a team only on a live team list, never a
  recorded one. A scheduled wake uses the teams recorded at spawn.
- The kernel never joins anything. It hands the provider `OATS_DEFAULT_TEAM`,
  `OATS_DEFAULT_TEAM_ID`, `OATS_DEFAULT_TEAM_FROM`, `OATS_TEAMS` (mapped rows)
  and `OATS_TEAMS_SOURCE` (`live` or `recorded`).

## Add a team

1. Shared: add `teams.<label>` to `oats-workspace.yaml` by PR (with `team`
   once the provider team exists; its owner creates it with `oats aweb setup`,
   which prints the id to commit). Local: `oats aweb setup --create <label>`
   creates a new team and runs `oats teams add` for you; an existing team you
   already belong to is `oats teams add <label> --team <id>`.
2. Put souls in it: `oats soul teams <soul> --add <label>` (or `'*'` for all).
3. Check: `oats teams` (no problems), `oats spawn <soul> --preview` (the
   label is in `teams` with its id).

## Create a team, or join a shared one (onboarding)

`oats aweb setup` (oats.aweb 1.17) is the one command that creates messaging
accounts and teams, and it records what it creates in `oats-local.yaml`. It
runs only when asked, never at spawn:

- **Nothing configured yet:** `oats aweb setup --username <u>` creates the
  account and its first team, recorded as the default.
- **A new team of your own:** `oats aweb setup --create <label>`.
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
- Migrating from 0.29: move each `byTeam` id into `teams.<label>.team`, and each
  soul/membership `team:` into `oats soul teams` on each deployment.

## Preparing for team model 3 (0.36.x → 0.37.0)

OATS 0.37.0 commits which teams a soul may join, and its default, in
`oats-workspace.yaml`, closed by default. 0.36.x accepts and validates the
new workspace keys without applying them (`defaultTeam`, `localTeams`,
`souls:` keyed `"*"`, `<member|package>/*`, `<member|package>/<soul>`, each
`{ default?, teams?: [labels] | any }`; every label a shared team of that
file). The warning `team-model-3-migration` (never blocking) has a `condition`:

- `local-soul-teams`: `oats-local.yaml` has `souls.teams` / `souls.default`;
  commit the same choices as `souls:` entries in the workspace file.
- `local-teams-closed`: `oats-local.yaml` has `teams` / `defaultTeam` and the
  workspace does not say `localTeams: true`; either add `localTeams: true`, or
  commit the teams and `defaultTeam` in the workspace file.

Remove the local keys only when the deployment moves to 0.37.0: until then
they are still what applies. Steps: `docs/release-notes/v0.36.1.md`.
