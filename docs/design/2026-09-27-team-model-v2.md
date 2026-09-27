# Team model v2: the workspace defines teams and the default; souls declare which they may join

Status: **PROPOSED 2026-09-27, revised after the human's answers** (the lead drafts; the messaging co-lead shapes it; the human confirms (a)–(c)). It supersedes the teams contract's model: the workspace/soul team labels, amendment K's default rule, "primary", and "joining is explicit". Kept from `2026-09-25-teams-contract.md`: live reconciliation and the provider's multi-identity receive.

## The human's direction (2026-09-27, verbatim)

> "El workspace define los equipos que hay, y a que equipo se instancian los souls por default. Y luego en el soul.yaml defines a que equipos se puede unir ese soul, y un default si quieres override el default de el workspace."
>
> "we do not need aweb primitives for this, we already have teams. we need to be able to add and remove souls to teams."
>
> "only pepe and i are using this for now, just clean up and do the right thing. no backwards comp required. setup may require creating accounts and teams, we need to support onboarding."

## Why: today's model has four overlapping ideas

1. The workspace's `teams:` labels + `messaging.byTeam.<label>` map labels to provider teams. They're committed and shared, which the human's answers rule out (below).
2. **The default team is not the workspace's.** After amendment K it's the provider setting `team`, else the provider's own default. For oats.aweb that's the messaging root's active team: host state, invisible in config.
3. **"Primary"** (the first of a soul's `team:` labels) sets `OATS_TEAM_LABEL` and ordering but isn't the default team.
4. **`oats-membership.yaml` `team`** is a repository-level default label layered under the soul's.

On top of that, a soul can override the default only by writing a provider team *id* in its messaging slot, not a workspace label. And adding or removing a soul's teams means hand-editing YAML.

## The human's answers (2026-09-27, verbatim)

> "q1: every team. q2: the instances also leave. but be very careful: belonging of a soul to a team is a local thing, stored in the local conf for the oats workspace. it is not shared among the workspaces using the soul. if pepe and i both have workspaces using a given soul my set of teams will be generally different than his. some of the teams may be the same. our particular conf will be my souls will belong to an antares-oats team, as well as to the oats team to which pepe's souls will also belong, and he will have his own personal oats team. for me antares-team will the the default, he will have another name. but we will both be working in the same repos with the same souls."

**What this changes:** team membership is **LOCAL: per person's OATS deployment, over shared repos and souls.** Two people using the same souls from the same repositories have different sets of teams. Some teams are shared (both map the label to the same provider team), and each has their own default. So **nothing about teams lives in a committed, shared file**: not `soul.yaml`, not `oats-workspace.yaml`. Q3 (package souls) dissolves: every soul, member or package, is treated the same.

## The model

### Where it lives: `oats-local.yaml` (the deployment's per-machine file, never committed)
```yaml
teams:
  antares-oats: { team: antares-oats:juan.aweb.ai }   # label → the provider team id (messaging)
  oats:         { team: oats:oats.aweb.ai }           # a team shared with others = the same id
defaultTeam: antares-oats                             # required once any team is declared
souls:
  disabled: [...]                                     # (existing)
  teams:                                              # which teams each soul belongs to HERE
    "*": [oats]                                       # every soul (optional)
    oats-expert: [oats]                               # per soul (member or package: `<pkg>/<soul>`)
```
- **`teams:`** declares this deployment's teams: a label → its provider payload (`{team: <provider id>}` for oats.aweb). **This is the ONLY place a provider team id is written.** The label is local vocabulary: another person's deployment may call the same shared team something else, or use the same label for a different team.
- **`defaultTeam:`** is the team every instance of this deployment lives in: its primary identity, which it can't leave (`E_TEAM_DEFAULT`). It must be a declared label (`E_TEAM_UNKNOWN`). **Every soul is in the default implicitly.**
- **`souls.teams:`** the extra teams each soul belongs to in this deployment. `"*"` applies to every soul; a soul's own entry adds to it. Unknown label → `E_TEAM_UNKNOWN`. A per-soul default override is omitted (YAGNI; the human didn't ask for it; add `souls.defaultTeam.<soul>` later if needed).
- **Messaging active + no `teams`/`defaultTeam`** → readiness `needs-configuration` ("no teams configured: run `oats aweb setup`"), and spawn is refused (`E_TEAM_UNCONFIGURED`). There's no guessed team and no root-active fallback.

### Removed (no backwards compatibility)
- `oats-workspace.yaml` `teams:` and `messaging.byTeam`;
- `soul.yaml` `team:`;
- `oats-membership.yaml` `team`;
- "primary";
- the provider's `team` setting at EVERY layer: the soul slot, the host `settings.oats.aweb.team`, and a spawn `team=`.

Committed files say nothing about teams.

### Resolution (the kernel)
- `teamsOf(soul) = {defaultTeam} ∪ souls.teams["*"] ∪ souls.teams[soul]`, each resolved through `teams.<label>` to its provider payload.
- **The env names** (renamed, no aliases):
  - `OATS_DEFAULT_TEAM` (the label) + `OATS_DEFAULT_TEAM_ID` (its id);
  - `OATS_TEAMS` = the JSON `[{label, payload}]` of every team the soul belongs to here.
  - `OATS_TEAM_LABEL(S)` / `OATS_TEAM_ID` go.
- The spawn preview, `inspect --soul` and `oats souls` report a soul's teams + the default, with `from: local`.

### At spawn, and live (the human's Q1 + Q2)
- **At spawn an instance joins EVERY team its soul belongs to** in this deployment (the human's Q1; this reverses the teams contract's "joining is explicit" default). The default team is its primary identity; each other team gets its own identity (as today's joined teams).
- **The root's role (the provider contract):** setup makes the deployment's messaging root a member of every declared team. The provider mints each of an instance's identities from the root's membership in THAT team (`aw team invite --team-id <id>`), never from the root's active team.
- **Live:** when a soul leaves a team in `oats-local.yaml` (or a team is removed), its running instances leave it on the next live read (the human's Q2; the teams contract's live reconciliation, now for membership changes too). When a soul gains a team, its running instances join it on the next live read (symmetry; to confirm with the human, see open question b).
- **Changing `defaultTeam`** doesn't move running instances (their primary identity is fixed): readiness warns `default-team-changed` until respawn.
- The provider's join/leave verbs stay for an ad-hoc membership of ONE instance. Whether they survive now that membership is soul-level is open question c.

### Verbs (edit `oats-local.yaml`; never a clone, never a PR)
```
oats teams                                   # this deployment's teams, ids, the default
oats teams add <label> --team <provider id>  # declare (setup does this for created teams)
oats teams remove <label> | oats teams default <label>
oats soul teams <soul>                       # the teams a soul belongs to here (and why: default / * / its own)
oats soul teams <soul> --add <label>[,…] | --remove <label>[,…]
oats soul teams '*' --add <label>            # every soul
```
The Desktop gets the same controls (Setup: this deployment's teams + the default; a soul page: its teams here), labelled "on this computer".
### Onboarding (setup creates accounts and teams)
- **`oats aweb setup`** (the provider's setup verb, a setup-time human act):
  - creates the account (`aw init --new-account --username …`) when none exists;
  - creates every declared team that the workspace doesn't map yet;
  - writes each resulting id into THIS deployment's `oats-local.yaml` `teams:` (and `defaultTeam` for the first), directly: it's local config, with no commit and no PR.
  - It never runs at spawn, mint, retire or wake.
- **What aweb allows today** (the messaging lane, from aweb's lead, 2026-09-27):
  - **The first account and its default team:** fully automatable (`aw init --new-account --username …`).
  - **An additional team on a BYOD domain:** automatable headlessly with the namespace controller key:
    1. `aw id team create --name <t> --namespace <domain>`;
    2. the team key signs `aw id team invite`;
    3. the root runs `accept-invite --local`.

    `aw id team register` hosts it on aweb.ai. No human login is needed.
  - **An additional team on a hosted account (`<u>.aweb.ai`):** NO CLI path. Only a logged-in human creates it, in the dashboard. aweb's lead proposes a generic `aw team create <name>` under the logged-in account.
- **Update (2026-09-27, the human's decision via aweb's lead): the hosted gap closes headlessly** (aweb `aweb-abkh`, pending a Cloud + CLI release).
  - A member of an org-owned hosted team creates a sibling team in the same account with `aw id team create --name <t>`, which returns the new `team_id` + a **single-use invite token**. The caller doesn't auto-join.
  - The home that should hold the new team's member runs `aw --identity-home <root> id team accept-invite <token> --name <alias> --local`.
  - No TTY, no `aw auth`; bounded by the account plan's team limit.
- **So setup is designed FULLY HEADLESS:**
  1. The account + the workspace's default team: `aw init --new-account --username …`.
  2. Every further declared team, by kind (the same outcome, different handles):
     - **Hosted** (`aweb-abkh`): `aw id team create --name <t>` → the team id + a single-use invite TOKEN → `aw --identity-home <root> id team accept-invite <token> --name <alias> --local`.
     - **BYOD:** `aw id team create --name <t> --namespace <domain>` (the namespace controller key) → the team id + a team KEY → the team key signs `aw id team invite` → `accept-invite --local` → `aw id team register` to host it on aweb.ai.
  3. Setup writes each new id into `oats-local.yaml` `teams.<label>` (and sets `defaultTeam` to the first).
- **Joining a team someone else created** (a shared team like `oats`): its owner sends an invite. `oats teams add <label> --team <id> --invite <token>` records the label + id, and the root accepts the invite into its membership. Setup never creates a team that's already declared with an id.
- **A label is NOT passed raw as the team name** (aweb's rule, hosted + BYOD: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, 1–128; the id is `<team>:<namespace>`, unique per namespace, 409 on a collision).
  - Setup NORMALIZES the label to that pattern (lowercase; `_`/`.` → `-`; trim hyphens) and passes it as `--name`.
  - **On a 409:** if the existing team is one this deployment's root already belongs to (a re-run of setup), reuse it. Otherwise choose a suffixed name (`<name>-2`, …), and never adopt a team the root isn't a member of.
  - `oats-local.yaml` `teams.<label>.team` holds the real id, so **the mapping, not the name, is the truth.**
  - Confirmed: `aw init --new-account` makes the user's `default` team org-owned, so a fresh root can create further hosted teams under `aweb-abkh` with nothing extra.
- **The only gate is the aw/Cloud version floor** that ships `aweb-abkh`. Below it, a hosted extra team is refused with the remedy "upgrade aw" (the provider's readiness names the floor), not a guided dashboard step. The model doesn't change.
- Setup needs no human login at all on this path.
- Setup never runs at spawn/mint/retire/wake, and OATS holds no human login (the provider consumes the resulting root).
- The oats.setup skills (`oats-teams`, `oats-onboarding`, `oats-workspace-config`) teach the model and the verbs.

## Open questions (for the human; the co-lead is asking)
- **(a) The file:** the existing `oats-local.yaml` (the deployment's per-machine, uncommitted file), as proposed, or a separate local file?
- **(b) Purely local?** Nothing about teams in any committed file (no "suggested" team in a soul or the workspace), as proposed. And does a soul GAINING a team make its running instances join it live (symmetric with Q2), as proposed?
- **(c) The default** = the team an instance's primary identity lives in, which it can't leave. With every team joined at spawn, do we still need a per-instance ad-hoc join/leave (the provider verbs), or is membership only soul-level (the proposal: keep them for one-off use; drop them if the human says so)?

## Sequencing (proposed)
1. **Now, small (the messaging lane):** an oats.aweb release with the setup `--new-account` fix + the dead `helperInjection` key.
2. **This design:** the co-lead shapes it → the human answers 1–3 → **Decided**.
3. **Kernel 0.30.0 (breaking):**
   - the schemas (the team keys out of the committed files; `teams`/`defaultTeam`/`souls.teams` in oats-local.yaml);
   - resolution + env;
   - the `oats teams` + `oats soul teams` verbs;
   - readiness;
   - the oats.setup skills;
   - docs.
4. **oats.aweb 1.17:** the default from the kernel (no root-active fallback); `oats aweb setup` onboarding.
5. **Desktop:**
   - the server passes the new fields (the engineer);
   - Setup's local teams + default, the soul page's local teams, the spawn dialog showing every team the soul joins (the ux-designer).
6. **The KB + migration** of the two existing deployments (one-shot, by the humans with the setup-admin soul).

**Owners (proposed):**
- the kernel: a cli-dev;
- oats.aweb + onboarding: the messaging co-lead's developer;
- the Desktop: the engineer + the ux-designer;
- this doc, the review and the release: the lead.
