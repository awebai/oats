# Teams contract: several team labels per soul, per-team messaging, live reconciliation

Status: AGREED 2026-09-25 by both co-leads (provider verbs confirmed in e205c93a). First drafted by the lead (kernel lane), with the messaging
co-lead's provider plan. It serves the human priority of 2026-09-25, recorded
in `2026-09-24-phase-d-plan.md` under "Teams, re-stated as THE priority".
This document is the kernel half; the provider half (oats.aweb) is the
messaging lane's. Co-lead review (9a18a381): agreed, with three additions,
folded in below.

## The model (human, 2026-09-25)

- **Default: the personal team only.** Every instance is in its person's
  personal team for THIS workspace. A soul's `team` labels do NOT put it
  in those teams by default.
- **Joining is explicit.** A wider team is joined by an explicit action:
  - at spawn, a spawn choice;
  - or at any point of the instance's life, one simple command, run by the
    human, by another agent, or by the instance itself when told to.
- **Only what the soul and workspace allow.** The teams an instance MAY join
  are exactly its soul's labels that the workspace maps. Nothing else is
  offered or accepted.
- **Leaving** is the same kind of command. When the workspace removes a
  mapping or the soul drops a label, the joined membership for it is left.
- **The Desktop has controls for it:** at spawn (which eligible teams to
  join) and on a live instance (join/leave, and the joined vs eligible
  teams).
- **Personal teams are per WORKSPACE.** One personal team spanning several
  workspaces is wrong. Until aweb ships the per-workspace get-or-create, the
  person's single default team is an explicitly temporary stand-in.

## Problem

- A v2 soul names ONE team label (`soul.yaml` `team`, else the repository's
  default from `oats-membership.yaml`).
- The resolver merges `workspace.messaging ⊕ byTeam[<that label>]` into one
  messaging payload, and applies `defaults.byTeam[<that label>].capabilities`
  to the soul's composition.
- An instance can therefore be placed in one team only, and only at spawn.
- The human's bar: a person's agents are in their personal team by default,
  AND in every wider team their soul belongs to, at spawn and during the
  instance's life, and those teams are exactly the ones the workspace defines.

## Decision

1. **Several labels.**
   - `soul.yaml` `team` accepts a label or a non-empty list of distinct
     labels: `team: dev` or `team: [dev, reviewers]`.
   - `oats-membership.yaml`'s repository default takes the same shape.
   - The FIRST label is the **primary**. A single string is a one-element
     list, so existing souls don't change.
2. **Composition (`defaults.byTeam[*].capabilities`).**
   - Applied for every label, in soul order, after `defaults.capabilities`
     and before the soul's own `capabilities`. The soul's own entries still
     win.
   - Two labels that give the same capability different entries is
     `E_TEAM_CONFLICT`, naming both labels. There's no silent
     last-writer-wins. Identical entries from two labels are not a
     conflict.
3. **Messaging payload.**
   - The merged view stays exactly as today, for the **primary** label only:
     `base ⊕ byTeam[primary]`.
   - New and kernel-owned: `teams`, an ordered list of
     `{ label, mapped: boolean, payload }`.
     - `payload` is `base ⊕ byTeam[label]` when the workspace maps the label.
     - It's `base` alone, with `mapped: false`, when the label isn't mapped.
   - Each entry also carries the resolved team id as `team` (null when the
     label isn't mapped), so a provider never digs it out of `payload`.
     "Personal" is the provider's to resolve; the kernel says nothing about
     it.
   - These are the **eligible** teams. Joining them is explicit (see "The
     model"), not automatic.
   - It's delivered beside the settings (hook stdin / `OATS_TEAMS` JSON),
     never inside the provider's own settings object, so it can't collide
     with a provider key or its manifest's settings validation.
   - `teams` is present when the soul has a label; a soul with no label gets
     `[]`, meaning "personal only".
4. **Environment.**
   - `OATS_TEAM_LABEL` / `OATS_TEAM_ID` stay the primary's.
   - New: `OATS_TEAM_LABELS` (all labels, comma-joined, in order) and
     `OATS_TEAMS` (the JSON above).
   - Workspace identity is unchanged: `OATS_WORKSPACE_KEY` / `OATS_WORKSPACE_NAME`.
   - The person's identity stays the provider's (its messaging root from host
     settings); the kernel passes the deployment, as today.
5. **Discovery.**
   - A label the workspace doesn't map is a discovery **warning**
     (`unmapped-team-label`), not an error, so the provider can fall back to
     the personal team and say so.
   - A label that isn't in the workspace's `teams:` list at all stays the
     error it is today.
6. **Live resolution for a home.**
   - A home's teams are **live messaging state, not frozen composition**. The
     modules and skills an instance got at spawn don't change under it; which
     teams it belongs to follows the workspace.
   - For home-context provider operations and the launch hook, the kernel
     computes `teams` from the soul's labels at the soul commit the
     deployment currently resolves (the lock), and the workspace's current
     `messaging`.
   - That lets `messaging:reconcile-teams` join a team the workspace added,
     and leave one it removed, without a respawn.
   - The recorded spawn-time `teams` stays in `instance.json.providers` as
     evidence.
   - **Retire** works from the provider's own recorded membership list,
     never from the live eligible set. A mapping removed after the spawn
     still has its membership revoked at retire.
7. **Explicit join, spawn choice, Desktop.**
   - The join/leave/list verbs are the provider's (oats.aweb 1.14.0), run
     inside a home or with `--home <abs>`, all idempotent, all with `--json`:
     - `oats aweb teams` answers
       `{ personal: {team}, primary, eligible: [{label, team, joined}], joined: [{label, team, since}], unmapped: [label], at }`;
     - `oats aweb join <label>[,<label>]` and
       `oats aweb leave <label>[,<label>]` answer the same document. The
       personal team can't be left (`E_TEAM_PERSONAL`).
     - The same verbs are declared as home-context operations
       `messaging:teams|join|leave`, so the Desktop uses `oats operation run`
       and needs no new kernel surface.
     - Identity model: one local identity per joined team, under the home as
       `.aweb-identity-<label>`. The personal-team identity is the primary one,
       wired to the harness. There are no global identities by default.
   - Each is idempotent, and refuses a label the instance isn't eligible for
     (`E_TEAM_NOT_ELIGIBLE`, naming the eligible labels).
   - At spawn, the kernel carries the operator's choice to the provider as a
     spawn provider setting (`--provider <messaging> join=<label>[,<label>]`).
     That needs no new kernel flag, and the spawn preview shows it.
   - The launch hook re-checks joined memberships against the live eligible
     set: it leaves what's no longer eligible and never joins on its own.
   - **The kernel puts `teams` (eligible, the OATS_TEAMS entries) in the
     spawn preview and in `inspect --home`**, so a Desktop can offer the
     choice before anything is minted. The Desktop reads that, plus joined memberships from the provider's inspect or
     operation, and drives the same verbs.
   - Later kernel item: `oats sync` reports the souls whose labels or
     mappings changed since the previous lock.

## Compatibility

- A single-label soul sees byte-identical composition and merged payload.
- oats.aweb 1.13.1 ignores `teams` / `OATS_TEAMS` and keeps working.
- oats.aweb 1.14.0 reads them.
- The schema change goes into 0.26.0, the release that already breaks the
  file formats.

## Tests

- Several labels compose in order; a conflict → `E_TEAM_CONFLICT`.
- The primary merged payload is byte-identical to 0.25 for one label.
- `OATS_TEAMS` shape: mapped and unmapped labels, and no label → `[]`.
- Home-context `teams` follows a new workspace commit (a mapping added and
  removed) while the home's modules stay frozen.
- Discovery warns on an unmapped label.
- `teams` entries carry `team`; identical cross-label entries don't conflict.
