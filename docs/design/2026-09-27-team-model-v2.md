# Team model v2: the workspace defines teams and the default; souls declare which they may join

Status: **PROPOSED 2026-09-27** (the lead drafts; the messaging co-lead shapes it; the human confirms the open questions). It supersedes teams-contract §3 amendment K's default-team rule and the "primary" label. The rest of `2026-09-25-teams-contract.md` stands: explicit join, only eligible labels, live reconciliation, and the provider's join/leave verbs.

## The human's direction (2026-09-27, verbatim)

> "El workspace define los equipos que hay, y a que equipo se instancian los souls por default. Y luego en el soul.yaml defines a que equipos se puede unir ese soul, y un default si quieres override el default de el workspace."
>
> "we do not need aweb primitives for this, we already have teams. we need to be able to add and remove souls to teams."
>
> "only pepe and i are using this for now, just clean up and do the right thing. no backwards comp required. setup may require creating accounts and teams, we need to support onboarding."

## Why: today's model has four overlapping ideas

1. The workspace's `teams:` labels + `messaging.byTeam.<label>` map labels to provider teams. This part is right.
2. **The default team is not the workspace's.** After amendment K it's the provider setting `team`, else the provider's own default. For oats.aweb that's the messaging root's active team: host state, invisible in config.
3. **"Primary"** (the first of a soul's `team:` labels) sets `OATS_TEAM_LABEL` and ordering but isn't the default team.
4. **`oats-membership.yaml` `team`** is a repository-level default label layered under the soul's.

On top of that, a soul can override the default only by writing a provider team *id* in its messaging slot, not a workspace label. And adding or removing a soul's teams means hand-editing YAML.

## The model

### The workspace (`oats-workspace.yaml`)
```yaml
teams:
  dev:      { description: … }
  platform: { description: … }
defaultTeam: dev                 # NEW: required when `teams` is non-empty; a declared label
messaging:
  oats.aweb: { from: package }
  byTeam:
    dev:      { team: <provider team id> }
    platform: { team: <provider team id> }
```
- **`teams:`** declares the teams that exist (labels), as today.
- **`defaultTeam:`** is the team a soul's instances go to by default. It's a label, never a provider id.
- **`messaging.byTeam.<label>`** maps each label to its provider team, as today. It's the ONLY place a provider team id is written.
- **Validation:** `defaultTeam` must be a declared label (`E_TEAM_UNKNOWN`). Once messaging is active, the default team's label must be mapped (`E_TEAM_UNMAPPED`, a refusal, not a warning: an instance must have somewhere to live).

### The soul (`soul.yaml`)
```yaml
teams: [dev, platform]           # RENAMED from `team`: the teams this soul MAY join
defaultTeam: platform            # NEW, optional: overrides the workspace's; must be in `teams`
```
- **`teams:`** is the eligible labels. Each must be declared by the workspace (`E_TEAM_UNKNOWN`), as today. The list is unordered: **"primary" goes away.**
- **`defaultTeam:`** is optional. It must be one of the soul's `teams`, else `E_TEAM_NOT_ELIGIBLE`. When omitted, the workspace's `defaultTeam` applies, and the soul is eligible for it implicitly.
- **Removed:**
  - a soul's messaging-slot provider team id override;
  - `oats-membership.yaml` `team` (two layers only: the workspace, then the soul);
  - the old `team:` key.

  No aliases (the human: no backwards compatibility).

### Resolution (the kernel)
- `effectiveDefault = soul.defaultTeam ?? workspace.defaultTeam`.
- The provider receives the default team's mapped payload as its default. It gets **no root-active-team fallback.**
- Plus the eligible set, `{label → payload}` for every label in `soul.teams ∪ {effectiveDefault}` that the workspace maps.
- **The env names** (renamed, no aliases):
  - `OATS_DEFAULT_TEAM` (the label) and `OATS_DEFAULT_TEAM_ID` (its mapped provider id);
  - `OATS_TEAMS` (the JSON of the eligible set).
  - `OATS_TEAM_LABEL`, `OATS_TEAM_LABELS` and `OATS_TEAM_ID` go.
- **A standalone deployment** (no workspace) sets `teams` / `defaultTeam` / `messaging.byTeam` in its local config, with the same rules.

### At spawn, and live
- An instance is **always in its effective default team** (it can't leave it: `E_TEAM_DEFAULT`).
- It joins other eligible teams explicitly: the spawn choice `join=…`, or the provider's join/leave on a live instance. This is unchanged from the teams contract.
- **When a soul loses a label**, or the workspace unmaps it, a joined instance leaves it on the next live read. This is unchanged: teams contract §7 decision 6.
- **When the effective default changes** (the workspace or soul `defaultTeam` edited), running instances keep their team until respawn. Readiness warns (`default-team-changed`) and names the new default.

### Verbs: add and remove a soul's teams, set its default
The CLI edits `soul.yaml` for a soul the deployment can edit (a member soul in a clone on this computer, or a local soul):
```
oats soul teams <soul>                                  # eligible, default (and where it comes from)
oats soul teams <soul> --add <label>[,<label>] | --remove <label>[,<label>]
oats soul teams <soul> --default <label> | --clear-default
```
- Each edit validates against the workspace (known label; the default ∈ teams) and writes the file.
- **For a member soul it edits the clone's working tree and says so:** the change travels by commit/PR, as every config change does (oats.setup). It never pushes.
- **Package souls are read-only:** their teams are the package's. A workspace adds a package soul to a team through the workspace instead, `teams.<label>.souls: [<pkg>/<soul>]`, which extends that soul's eligible set. Proposed; see Open question 3.
- The Desktop gets the same controls on a soul's page (add/remove/default), and the spawn dialog shows the default + eligible teams.

### Onboarding (setup creates accounts and teams)
- **`oats aweb setup`** (the provider's setup verb, a setup-time human act):
  - creates the account (`aw init --new-account --username …`) when none exists;
  - creates every declared team that the workspace doesn't map yet;
  - writes the resulting ids into `messaging.byTeam` **as a proposed diff** for the human to commit (oats.setup: config changes by PR).
  - It never runs at spawn, mint, retire or wake.
- Which aw primitive creates an additional team non-interactively, and with what authority, is the messaging lane's (with aweb). If aweb needs a change, onboarding degrades to: setup prints the exact steps and the ids to fill in.
- The oats.setup skills (`oats-teams`, `oats-onboarding`, `oats-workspace-config`) teach the model and the verbs.

## Open questions (for the human)
1. **At spawn:** is an instance in ONLY its default team (others joined explicitly), as proposed? Or does it join every team its soul lists?
2. **When a soul's team is removed:** do running instances leave on the next live read (proposed, as today), or only when told to?
3. **Package souls:** is a workspace-side `teams.<label>.souls: [...]` the right way to add a package soul to a team? The alternative is that package souls have only their package's teams.

## Sequencing (proposed)
1. **Now, small (the messaging lane):** an oats.aweb release with the setup `--new-account` fix + the dead `helperInjection` key.
2. **This design:** the co-lead shapes it → the human answers 1–3 → **Decided**.
3. **Kernel 0.30.0 (breaking):**
   - the schemas;
   - resolution + env;
   - the `oats soul teams` verb;
   - readiness;
   - the oats.setup skills;
   - docs.
4. **oats.aweb 1.17:** the default from the kernel (no root-active fallback); `oats aweb setup` onboarding.
5. **Desktop:**
   - the server passes the new fields (the engineer);
   - the soul-page team controls + the spawn dialog (the ux-designer).
6. **The KB + migration** of the two existing deployments (one-shot, by the humans with the setup-admin soul).

**Owners (proposed):**
- the kernel: a cli-dev;
- oats.aweb + onboarding: the messaging co-lead's developer;
- the Desktop: the engineer + the ux-designer;
- this doc, the review and the release: the lead.
