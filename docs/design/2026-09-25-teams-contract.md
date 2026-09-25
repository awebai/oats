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
   - **Amended (K, co-lead ruling on the 1.14.0 review):** the messaging
     provider's merged settings are `base ⊕ soul ⊕ host ⊕ spawn`, and **no
     `byTeam[<label>]` is merged into them**, the primary's included. Each
     label's `base ⊕ byTeam[label]` lives only in its `teams` entry (below).
     So `settings.team` / `OATS_TEAM_ID` mean "the personal team, if the
     host, soul or spawn set one"; empty means the provider's own default
     (for oats.aweb, the root's active team). Reason: the instance is
     personal-by-default (the human's model), and the primary label is just
     the first eligible team. Merging its payload made the provider mint the
     primary identity into the mapped team, and it couldn't tell a host-set
     personal team from the workspace's mapped one.
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
   - It's delivered beside the settings, in the environment (`OATS_TEAMS` JSON),
     never inside the provider's own settings object, so it can't collide
     with a provider key or its manifest's settings validation.
   - `teams` is present when the soul has a label; a soul with no label gets
     `[]`, meaning "personal only".
4. **Environment.**
   - `OATS_TEAM_LABEL` / `OATS_TEAM_ID` stay the primary's.
   - New: `OATS_TEAM_LABELS` (all labels, comma-joined, in order) and
     `OATS_TEAMS` (the JSON above).
   - New: `OATS_TEAMS_SOURCE`, which is `live` or `recorded` (decision 6). It's empty
     when `OATS_TEAMS` is empty (unknown).
   - **The environment is the only channel.** No stdin wire gains keys: the
     binding check's request stays exactly the released wire, because released
     providers (oats.aweb 1.13.1) key it strictly and refuse unknown keys with
     `invalid-binding`. A provider check reads the teams from the same env
     variables its hooks get. (Correction after #179, co-lead finding.)
   - Workspace identity is unchanged: `OATS_WORKSPACE_KEY` / `OATS_WORKSPACE_NAME`.
   - The person's identity stays the provider's (its messaging root from host
     settings); the kernel passes the deployment, as today.
5. **Discovery.**
   - A label the workspace doesn't map is a discovery **warning**
     (`unmapped-team-label`), not an error, so the provider can fall back to
     the personal team and say so.
   - There's one warning per unmapped label, naming its souls
     (`{ code, label, souls, paths, message }`), not one per soul and label.
     A workspace with no `messaging.byTeam` must not print a line per soul.
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
   - That lets the provider offer a team the workspace added as eligible,
     and leave one it removed, without a respawn.
   - The recorded spawn-time `teams` stays in `instance.json.teams` as
     evidence: beside `providers`, never inside that capability-keyed map.
   - **Live or recorded.** When the workspace can't be read now (the host is
     offline, or the soul is no longer listed), the kernel falls back to the
     recorded set and says so: `OATS_TEAMS_SOURCE=recorded`, or
     `teamsSource: "recorded"` in inspect.
     - **A provider leaves a joined team only on a `live` answer.** On
       `recorded` or unknown it keeps every membership and may warn
       (`teams-unverified`).
     - Reason: a team mapped after spawn and joined live is absent from the
       record, and an offline host must never cost an instance a membership.
   - **Cost.** Live teams are computed only where they're consumed:
     - session start/restart;
     - the messaging module's own home-context commands and operations;
     - `inspect` / `readiness --home`.

     The live read covers the workspace host and the soul's repo, not a full
     workspace discovery. Every other in-home capability command uses the
     record and costs what it did before.
   - **0.26.0 limitation:** a scheduled wake's start uses the spawn-time teams.
     The scheduler is synchronous; only operator starts are live.
   - **Retire** works from the provider's own recorded membership list,
     never from the live eligible set. A mapping removed after the spawn
     still has its membership revoked at retire.
7. **Explicit join, spawn choice, Desktop.**
   - The join/leave/list verbs are the provider's (oats.aweb 1.14.0), run
     inside a home or with `--home <abs>`, all idempotent, all with `--json`:
     - `oats aweb teams` answers
       `{ personal: {team}, primary, eligible: [{label, team, joined}], joined: [{label, team, since, identityHome, receive}], unmapped: [label], at }`, where `receive` is `native` or `poll`;
     - `oats aweb join <label>[,<label>]` and
       `oats aweb leave <label>[,<label>]` answer the same document. The
       personal team can't be left (`E_TEAM_PERSONAL`).
     - The same verbs are declared as home-context operations
       `messaging:teams|join|leave`, so the Desktop uses `oats operation run`
       and needs no new kernel surface.
       All three are `kind: action` (the default): a `view` must answer
       `{documents:[…]}` (markdown/text for reading), and the teams document
       is structured JSON. `messaging:teams` is read-only by its own
       contract, which its description says. Join and leave declare one
       required arg, `labels` (flag `--labels`, comma-separated).
     - Identity model: one local identity per joined team, under the home as
       `.aweb-identity-<label>`. The personal-team identity is the primary one,
       wired to the harness. There are no global identities by default.
     - **Sending and receiving as a joined team (oats.aweb 1.14.0):**
       - Sending is complete: `aw --identity-home <identityHome> mail|chat …`,
         the one form the aweb inject teaches.
       - Receiving is by POLL: the channel plugin, the pi extension and a wake
         registration each listen on one identity home. The inject says to
         check a joined team's inbox at task boundaries, and readiness and
         `receive: poll` say so.
       - Native receive for joined teams needs one of two aweb primitives:
         wake/channel on several identity homes per instance home, or global
         instance identities with address release (one identity, many teams,
         one channel). This is a named gap against the "seamless" bar,
         tracked as an aweb ask.
   - Each is idempotent, and refuses a label the instance isn't eligible for
     (`E_TEAM_NOT_ELIGIBLE`, naming the eligible labels).
   - **Declared setting keys (added after #179):** the spawn preview's
     `modules[]` rows and `inspect`'s `capabilities[]` rows carry
     `declares: [<setting key>…]` (names only; feature `settings-declared`).
     That's how a Desktop sees that the messaging manifest declares
     `settings.join` without reading manifests.
   - `inspect --soul` on a soul whose labels conflict (`E_TEAM_CONFLICT`)
     refuses. The error details name the capability and both labels; no
     `teams` is answered, because the soul can't be spawned until the
     workspace resolves it.
   - At spawn, the kernel carries the operator's choice to the provider as a
     spawn provider setting (`--provider <messaging> join=<label>[,<label>]`).
     That needs no new kernel flag, and the spawn preview shows it.
   - The launch hook re-checks joined memberships against the live eligible
     set: it leaves what's no longer eligible (only when
     `OATS_TEAMS_SOURCE=live`, decision 6) and never joins on its own.
   - **The kernel puts `teams` (eligible, the OATS_TEAMS entries) in the
     spawn preview and in `inspect --home`**, so a Desktop can offer the
     choice before anything is minted. The Desktop reads that, plus joined memberships from the provider's inspect or
     operation, and drives the same verbs.
   - Later kernel item: `oats sync` reports the souls whose labels or
     mappings changed since the previous lock.

## Compatibility

- A single-label soul sees byte-identical **composition** (modules, skills,
  injects). Its messaging **payload** changes: the mapped label's `byTeam`
  entry is no longer merged into the provider's settings; it's only in
  `OATS_TEAMS` (amendment K). With 0.26.0 + oats.aweb 1.13.1, the primary
  identity therefore mints into the personal (root-active) team, as the
  human's model wants.
- oats.aweb 1.13.1 ignores `OATS_TEAMS` and keeps working, because no stdin
  wire changes (its binding decoder refuses unknown request keys).
- oats.aweb 1.14.0 reads them.
- The schema change goes into 0.26.0, the release that already breaks the
  file formats.

## Tests

- Several labels compose in order; a conflict → `E_TEAM_CONFLICT`. A
  capability the soul names itself is exempt, since the soul's entry wins over
  every label.
- A mapped primary's `byTeam` payload is absent from the provider's merged
  settings and present in `OATS_TEAMS[0].payload` (amendment K).
- `OATS_TEAMS` shape: mapped and unmapped labels, and no label → `[]`.
- Home-context `teams` follows a new workspace commit (a mapping added and
  removed) while the home's modules stay frozen.
- Discovery warns once per unmapped label.
- A home whose workspace can't be read gets the record with
  `OATS_TEAMS_SOURCE=recorded`; a non-messaging in-home command runs no live
  team read.
- `teams` entries carry `team`; identical cross-label entries don't conflict.
