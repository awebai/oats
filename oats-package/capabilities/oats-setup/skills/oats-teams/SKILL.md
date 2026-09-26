---
name: oats-teams
description: >-
  Use when adding or changing team labels, mapping a label to a messaging team
  (messaging.byTeam), deciding which messaging team an instance joins, joining
  or leaving a team at spawn or later, or diagnosing E_TEAM_UNKNOWN,
  E_TEAM_CONFLICT or the unmapped-team-label warning. Also when someone
  expects a team label to restrict or grant access (it never does). Part of
  the setup and config of an OATS workspace (oats.setup); day-to-day operation
  inside an instance is oats.core.
---

# Teams: labels and messaging teams

The contract is `docs/workspaces.md` ("Teams", "Provider payloads have three
homes") and `docs/capabilities.md` ("Several team labels") in the installed
kernel. Two different things share the word "team":

- a **team label** (`engineering`, `okf`): a workspace-declared name that
  organises souls and capabilities and can add default capabilities;
- a **messaging team**: the messaging provider's team (for oats.aweb, an aweb
  team id) that an instance's identity belongs to.

`messaging.byTeam` is the only bridge between them. **A label organises; it
never gates, restricts, grants trust or partitions knowledge.**

## Labels

```yaml
# oats-workspace.yaml
teams:
  engineering: { description: Platform and release automation }
  okf:         { description: Knowledge operations }
defaults:
  byTeam:
    engineering:
      capabilities: { acme-release-tooling: { from: github.com/acme/agents } }
```

- A soul's `team:` is a label or a list (`team: [engineering, reviewers]`); the
  first is the **primary**. Without one it takes its repo's default from
  `oats-membership.yaml`, else `unassigned`. A capability carries one label.
- A label must be declared in `teams:`. Otherwise it is `E_TEAM_UNKNOWN`, a
  discovery problem: the soul is still listed and spawnable, but its instances
  land in no messaging team for that label.
- `defaults.byTeam.<label>.capabilities` adds capabilities for each label in
  order (`off` removes). Two labels that give one capability different entries
  are `E_TEAM_CONFLICT`: make the entries agree, or name the capability in the
  soul, whose own entry wins.

## Messaging teams

```yaml
# oats-workspace.yaml
messaging:
  private: per-human                      # the base payload every soul's provider receives
  byTeam:
    engineering: { team: <messaging team id> }
    okf:         { team: <messaging team id> }
```

- **Every label is an eligible team.** The kernel hands the messaging
  provider one entry per label, in order: `{ label, team, mapped, payload }`,
  where `payload` is the base ⊕ `byTeam[label]`. A declared label without a
  `byTeam` entry is the `unmapped-team-label` warning, and its entry has
  `mapped: false`.
- **The instance's own identity lives in the personal team by default.** No
  label's `byTeam` entry is merged into the provider's settings, the
  primary's included. The identity mints into the `team` a host
  (`settings.<cap>.team`), the soul or the spawn sets, else the provider's
  default (for oats.aweb, the active team of the `.aw` root it finds).
- **Joining an eligible team is an explicit act; the kernel never joins
  anything.** At spawn:

  ```bash
  oats spawn <soul> --preview --provider oats.aweb join=engineering,okf   # check the teams and settings first
  oats spawn <soul> --purpose <slug> --provider oats.aweb join=engineering,okf
  ```

  Later, from the instance's home (oats.aweb's own commands):
  `oats aweb teams` lists eligible and joined teams, `oats aweb join --labels
  <a,b>` joins, `oats aweb leave --labels <a,b>` leaves. A provider leaves a
  team only on a live team list, never a recorded one.
- A team id is an operator fact about the messaging service. It is shared
  through the workspace file (all machines use the same team), but creating
  the team or joining the deployment's root to it is done with the messaging
  provider's own tools, by the operator (oats-onboarding, step 6).

## Add a team

1. Declare the label in `teams:`, and map it under `messaging.byTeam` if
   instances should be able to join a messaging team for it. Add
   `defaults.byTeam.<label>` only if souls with it need extra capabilities.
2. Give souls the label (`team:` in their `soul.yaml`, or the repo default in
   `oats-membership.yaml`).
3. Change each file by PR to the repo that owns it (oats-workspace-config).
   After the merge: `oats sync`, `oats souls` (the label appears, with no
   `E_TEAM_UNKNOWN`), and `oats spawn <soul> --preview` (the `teams` entry is
   `mapped: true` with the team id).

## Gotchas

- Expecting a label to hide a soul or restrict a capability: it does
  neither. Visibility comes from membership, and repo-owned capabilities are
  `private: true` in their manifest.
- A `byTeam` label that is not declared in `teams:` is `E_WORKSPACE_SCHEMA`,
  not a warning.
- A scheduled wake's session start uses the teams recorded at spawn, so it
  joins or leaves nothing; the next operator `oats session start` is live.
