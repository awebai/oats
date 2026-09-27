# Team model v2: the workspace defines teams and the default; souls declare which they may join

Status: **Option B DECIDED by the human (Juan) 2026-09-27; awaiting the original designer's (Pepe's) confirmation** (the lead drafts; the messaging co-lead shapes it; the human confirms (a)–(c)). It supersedes the teams contract's model: the workspace/soul team labels, amendment K's default rule, "primary", and "joining is explicit". Kept from `2026-09-25-teams-contract.md`: live reconciliation and the provider's multi-identity receive.

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

## Two shapes for the original designer (Pepe) to choose from

**The human (Juan) decided B, with Q1 revised** (verbatim): *"i agree with b, but we should keep the shared teams opt-in per instance. when a new instance is spawned only the default team is joined by default, but the shared and other local teams should be offered as opt-in (for example as checkboxes in the ui). does that fit better with pepe's intent?"* That restores the 2026-09-25 contract's "default only; joining is explicit; the Desktop has controls at spawn". So:
- **`souls.teams` = the teams a soul's instances MAY join here** (eligible), shared or local; it's not "join at spawn".
- **At spawn:** an instance joins its default team only. Every other eligible team is OFFERED: the spawn's `join=<labels>` choice, and checkboxes in the Desktop spawn dialog.
- **Live:**
  - a team GAINED by the soul is offered, never auto-joined (the human's (b) settled);
  - a team LOST (removed from the soul's list, or the team removed) makes the instances joined to it leave on the next live read (Q2);
  - the per-instance join/leave verbs are the way to opt in or out later.


The human (Juan): *"i do not want to go against Pepe's design intent. what exactly do we propose? what's the final shape?"* Membership is LOCAL in both shapes (the human's non-negotiable). They differ on where a SHARED team is declared.

**Option A: everything local** (the model section below as written):
- `oats-local.yaml` declares every team (shared and personal) with its id, the default, and all membership.
- Committed files say nothing about teams.
- One place, one rule. It gives up the shared committed vocabulary: each person hand-copies a shared team's id.

**Option B: shared facts committed, personal choices local** (the co-lead's variant; **both co-leads recommend B**):
- **Committed `oats-workspace.yaml` `teams:`:** only the SHARED teams, with their provider ids, e.g. `teams: { oats: { team: oats:oats.aweb.ai } }`.
  - It's one fact, written once, the same for everyone, edited by PR like any committed workspace config.
  - It REPLACES `messaging.byTeam` (the id moves into the team's own entry).
  - It keeps the shared vocabulary and "the workspace owns team policy".
  - A team id is an address, not a secret.
- **Local `oats-local.yaml`:** personal teams (`teams: { antares-oats: {team: …} }`), `defaultTeam`, and ALL membership (`souls.teams`, `souls.default`).
- **Rules:**
  - a label defined in both files is a READINESS problem (`team-label-collision`, naming both definitions and the fix: rename the local label), not a spawn refusal. A teammate's PR adding a shared team must never break another person's deployment on sync; until it's fixed, the COMMITTED definition wins;
  - the default and every membership may name a label from either file;
  - an unknown label → `E_TEAM_UNKNOWN`.
- **Joining a shared team:** the id is in the committed file. Setup makes the local root a member through the owner's invite (`oats teams join <label> --invite <token>`).
- **`oats teams add`** writes LOCAL teams only.
- **In both shapes:**
  - `defaults.byTeam` capability composition is DROPPED (composition must not vary per person);
  - soul.yaml / oats-membership.yaml `team` go;
  - "primary" goes;
  - the provider `team` setting goes at every layer.
- **Cost of B:** two places a team can be declared + one merge rule.

The model section below describes A. Under B, only "Where it lives" changes, as above.

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
  default:                                            # optional per-soul override of defaultTeam
    oats-expert: oats                                 # must be one of that soul's teams here
```
- **`teams:`** declares this deployment's teams: a label → its provider payload (`{team: <provider id>}` for oats.aweb). **This is the ONLY place a provider team id is written.** The label is local vocabulary: another person's deployment may call the same shared team something else, or use the same label for a different team.
- **`defaultTeam:`** is the team every instance of this deployment lives in: its primary identity, which it can't leave (`E_TEAM_DEFAULT`). It must be a declared label (`E_TEAM_UNKNOWN`). **Every soul is in the default implicitly.**
- **`souls.teams:`** the extra teams each soul's instances MAY join in this deployment (eligible; offered at spawn, never auto-joined). `"*"` applies to every soul; a soul's own entry adds to it. Unknown label → `E_TEAM_UNKNOWN`.
- **`souls.default:`** `{<soul>: <label>}`, a per-soul override of `defaultTeam` (the human asked for it: *"y un default si quieres override el default de el workspace"*). Local too; it must be one of that soul's teams here (`E_TEAM_NOT_ELIGIBLE`). That soul's instances live in it (their primary identity) and are also in the deployment default only if the soul lists it.
- **Messaging active + no `teams`/`defaultTeam`** → readiness `needs-configuration` ("no teams configured: run `oats aweb setup`"), and spawn is refused (`E_TEAM_UNCONFIGURED`). There's no guessed team and no root-active fallback.

### Removed (no backwards compatibility)
- `oats-workspace.yaml` `teams:`, `messaging.byTeam` and `defaults.byTeam` (proposed; see the Pepe questions);
- `soul.yaml` `team:`;
- `oats-membership.yaml` `team`;
- "primary";
- the provider's `team` setting at EVERY layer: the soul slot, the host `settings.oats.aweb.team`, and a spawn `team=`.

Committed files say nothing about teams.

### Resolution (the kernel)
- `defaultOf(soul) = souls.default[soul] ?? defaultTeam`.
- `teamsOf(soul) = {defaultOf(soul)} ∪ souls.teams["*"] ∪ souls.teams[soul]` (the deployment default is included only when `defaultOf(soul)` is it, or the soul lists it), each resolved through `teams.<label>` to its provider payload.
- **The env names** (renamed, no aliases):
  - `OATS_DEFAULT_TEAM` (the label) + `OATS_DEFAULT_TEAM_ID` (its id);
  - `OATS_TEAMS` = the JSON `[{label, payload}]` of every team the soul belongs to here.
  - `OATS_TEAM_LABEL(S)` / `OATS_TEAM_ID` go.
- The spawn preview, `inspect --soul` and `oats souls` report a soul's teams + the default, with `from: local`.

### At spawn, and live (the human's Q1 + Q2)
- **At spawn an instance joins its DEFAULT team only** (its primary identity). The soul's other eligible teams (`souls.teams`, shared or local) are offered: `join=<labels>` at spawn, checkboxes in the Desktop. Each joined team gets its own identity (as today). This is the human's final Q1, restoring "joining is explicit".
- **The root's role (the provider contract):** setup makes the deployment's messaging root a member of every declared team. The provider mints each of an instance's identities from the root's membership in THAT team (`aw team invite --team-id <id>`), never from the root's active team.
- **Live:** when a soul loses an eligible team in `oats-local.yaml` (or a team is removed), its running instances joined to it leave on the next live read (the human's Q2). A team GAINED is offered, never auto-joined (the human's (b)). An instance joins or leaves any eligible team with the per-instance verbs (c).
- **Changing `defaultTeam`** doesn't move running instances (their primary identity is fixed): readiness warns `default-team-changed` until respawn.
- The provider's join/leave verbs stay (the human's (c)) for an ad-hoc membership of ONE instance.

### Verbs (edit `oats-local.yaml`; never a clone, never a PR)
```
oats teams                                   # this deployment's teams, ids, the default
oats teams add <label> --team <provider id>  # declare (setup does this for created teams)
oats teams remove <label> | oats teams default <label>
oats soul teams <soul>                       # the teams a soul belongs to here (and why: default / * / its own)
oats soul teams <soul> --add <label>[,…] | --remove <label>[,…]
oats soul teams <soul> --default <label> | --clear-default
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

## The human's answers to (a)–(d), and what remains

- **(a) The file:** `oats-local.yaml` ("we do not need another file"). ✔
- **(c) Per-instance join/leave:** kept ("we keep the commands per instance"). They're an ad-hoc membership of ONE instance on top of its soul's teams. The next live read doesn't undo an ad-hoc join; it undoes only memberships that come from the soul. ✔
- **(d) The per-soul default:** kept (`souls.default`). ✔
- **(b) Purely local:** superseded by Option B (below); a gained team is offered, not auto-joined. The co-lead explained to the human the current state (the machinery exists, and the only usage is one label `global`, no `byTeam` mapping, one soul `team: global`, so every instance lands in the root's active team) and recommended purely local + gaining a team joins live. The human's answer is pending.

**For the original designer (Pepe), what purely local gives up from the 2026-09-25 teams contract:**
1. **The shared, committed label vocabulary.** Labels become each deployment's own: a typo is caught against your own `teams:`, and two people may name the same shared team differently. That's harmless, since the id is the truth.
2. **`defaults.byTeam.<label>.capabilities`** (capabilities composed by team label). With local membership, a soul's composition would vary per person and per machine. **Proposed: DROP it** (unused today). Capabilities stay composed from the committed workspace + soul only, so composition remains reproducible across people.
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

**Before the 0.30 tag (the lead's execution conditions, agreed by the co-lead):**
- the Desktop PR merges before or with the pins, fixtures recaptured from the REAL provider;
- a LIVE two-deployment rehearsal: one host, a shared `oats` team + two personal defaults, then spawn / opt-in join / leave / soul-loses-team (**the co-lead owns it**);
- second-person onboarding: joining a shared team by its owner's invite is one clear step, and below the `aweb-abkh` floor setup says exactly what's missing (**the co-lead owns it**);
- a leave caused by a live read shows in status, readiness and the instance's events (never silent);
- the oats.setup skills (oats-teams, oats-onboarding, oats-workspace-config) rewritten in the same release.

**Owners (proposed):**
- the kernel: a cli-dev;
- oats.aweb + onboarding: the messaging co-lead's developer;
- the Desktop: the engineer + the ux-designer;
- this doc, the review and the release: the lead.
