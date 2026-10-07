# Desktop teams (team model v2, OATS 0.30; team model 3, OATS 0.38)

The Desktop reads and edits a deployment's teams through the kernel verbs `oats teams` and
`oats soul teams`, on a CLI with feature `team-model-2` (OATS 0.30–0.37) or `team-model-3` (OATS
0.38; `teamModelOf` in `renderer/team-rows.mjs`). The kernel is the only writer of
`oats-local.yaml`; the Desktop server never writes that file (or `oats-workspace.yaml`) itself.

**Team model 3** ([design](../../../docs/design/2026-10-02-team-model-3.md), the shapes in
[desktop-cli-api.md](../../../docs/desktop-cli-api.md#oats-teams)) commits which teams a soul may
join, and its default, in the workspace's `souls:`. So:

- `oats soul teams` is read only. Under `team-model-3` the soul-teams route admits `show` only:
  an edit is refused with `E_BAD_ARGS` before any process runs, and the removed `--add`,
  `--remove`, `--default` and `--clear-default` are never sent.
- Local teams are a deployment's only where the workspace says `localTeams: true` (or in the
  standalone view, `localTeams: null`). Where they are closed the kernel refuses `oats teams add`
  and `default` before writing, so the Teams page offers neither; it keeps Remove for a local team
  still in `oats-local.yaml`, which the kernel accepts there (proven against the real CLI in
  `test/desktop-team-model-3-kernel.test.mjs` at the repository root).
- What the Desktop says about changing teams is the kernel's own wording: `souls: in
  oats-workspace.yaml (a PR to the workspace file)`, the local-teams-closed message and fix, the
  unmapped fix.

## The Teams board

`renderer/computer-teams.mjs`. Two sections of cards, shared teams then local ones, each with the
default team's card first (otherwise the document's order), then the workspace's `souls:` as committed.
A card reads, top to bottom: the label and its default pill, the description, any problem that blocks
spawning, the team's audience, the address (the provider team id, the quietest line; "no provider id
yet" in the warn colour), the team's warnings, why Remove is off, then its members. The right column
holds the member count and the actions; under a 640px container they move below the main column.

**The audience** (team model 3) is two labelled rows, each shown only when it has entries:

- **Default for**: whose default the team is, e.g. "all souls of **lfx-ai-engineering**",
  "**writer** (acme-agents)", or, for the document's `defaultTeam`, "every soul without its own
  default" (with "(this deployment's choice)" when it is the deployment's).
- **May join**: who else may join it without it being their default, e.g. "souls of
  **lfx-agents** · **ai-reviewer** (lfx-ai-engineering)", or "every soul (local team)" for a local
  team where local teams are allowed.

A card with neither says "No soul may join it yet". Repo and soul names are bold, each titled with
the `souls:` key it comes from.

`teamAudience(document, label)` computes both from the committed `souls:` map alone, with the
kernel's resolution (`lib/teams.mjs`): a soul's teams come from its most specific key outright, its
default from the most specific key that sets one, and `any` is every shared team. So an entry a
broader key already implies is never repeated (`lfx-ai-engineering/ai-reviewer` defaulting to the
same team as `lfx-ai-engineering/*`). A pattern lists as `except` the more specific keys under it that
fall outside, as in "all souls of p except x". Where `"*"` sets a default, no soul falls back to the
`defaultTeam`, and its row says so quietly. Before team model 3 the function answers null, and the
card keeps the team model 2 "Address … Who may join …" line from `whoMayJoin`.
This is a second reading of the kernel's resolution in the renderer. `test/desktop-team-audience-kernel.test.mjs`
(at the repository root) pins it to the kernel: for each fixture it resolves every concrete soul with
`soulTeams` and checks each team's audience against it. A change to resolution in `lib/teams.mjs` must
keep that test green, or change `teamAudience` with it.

A card lists its members (below) under a "Members · N" head. Within a deployment group the rows
share their columns (a subgrid), so the state words line up.

The souls section's right column reads "default lfx-ai-team · may also join lfx-all", or "may join
any shared team".

## Routes

Both are `POST` with exactly one `?ws=<view id or deployment id>` and a JSON body of at most 4 KiB.
The teams configuration is one deployment's: a view id is read as the view's primary deployment
(its first local one, else its first; see
[workspace views](desktop-deployment-model.md#workspace-views-and-deployments)), and in a view of
two or more deployments the configuration says which under its heading ("On This Mac ·
~/Agents/oats"). A remote primary is `unsupported-remote-operation`: teams are edited on the
computer that runs the deployment.
They sit behind the server-wide Host and Origin guards (loopback only; a foreign, `null` or
malformed `Origin` is 403 before any process), so a cross-origin page cannot rewrite the file.
The renderer reaches them through the generic guarded proxy (sender-frame guard, `ws` pinned to
the connected server's view and deployment ids, 20 s deadline; the verbs run with a 15 s timeout).

`POST /api/workspace-teams`: `{action}` is one of:

| action | fields | kernel argv |
| --- | --- | --- |
| `list` | none | `oats teams --dir W --json` |
| `add` | `label`, `team`, optional `description` | `oats teams add <label> --team=<id> [--description=<text>] --dir W --json` |
| `remove` | `label` | `oats teams remove <label> --dir W --json` |
| `default` | `label` | `oats teams default <label> --dir W --json` |

`POST /api/workspace-soul-teams`: `{action, soul}` plus:

| action | fields | kernel argv |
| --- | --- | --- |
| `show` | none | `oats soul teams <soul> --dir W --json` |
| `add` / `remove` | `labels` (1–64) | `… --add=<a,b>` / `… --remove=<a,b>` |
| `default` | `label` | `… --default=<label>` |
| `clear-default` | none | `… --clear-default` |

Under `team-model-3` only `show` runs; every other action is `E_BAD_ARGS`.

## Arguments

- **Argv only.** No shell is involved.
- **Positionals are grammar-bound:**
  - a label follows the workspace label grammar;
  - a soul is a bare name, `<package>/<soul>`, or `*`, where `*` takes no default.
- **No value can become a flag.** Every option value travels as one `--flag=value` token, which the kernel reads as `--flag value`.
- **A team id** is the aweb `<name>:<namespace>` shape.
- **A description** is bounded printable text, never `-`-led.
- **The request's keys are closed** for each action.
- **Anything else is `E_BAD_ARGS`,** refused before any process runs.

## Results

The shape is the lead's (0.30 D2 review):

- **Success:** `{status: "ok", teams}` (`/api/workspace-teams`) or `{status: "ok", soulTeams}` (`/api/workspace-soul-teams`). The value is the decoded kernel result:
  - `teams` is `teamsData`, with `teamsApi`, `deployment`, `defaultTeam`, `teams`, `souls`, `problems`, and `changed` on a mutation. Its `deployment` must be this workspace's, or the answer is `E_DEPLOYMENT_SCOPE`. With `teamsApi: 1` the `defaultTeam` is a label and `souls` is `{teams, default}` by soul key; with `teamsApi: 2` it adds `localTeams` (`true`, `false`, or `null` standalone), the `defaultTeam` is a `DefaultTeam` (`from`: `deployment` or `workspace`), and `souls` is the workspace's `souls:` as committed (`{<pattern>: {default?, teams?: [labels] | "any"}}`). A problem keeps its own keys: a `souls:` `key` (`team-soul-unknown`), the local-teams-closed `condition`, `path` and `keys`.
  - `soulTeams` is `soulTeamsData`, with `soulTeamsApi`, `soul`, `key`, `defaultTeam`, `teams` (+ `via`) and `changed`; `soulTeamsApi: 1` adds `local` and `all` (`via`: `default`, `*`, `soul`), and `soulTeamsApi: 2` adds `match` and `defaultMatch`, the `souls:` keys its teams and default came from (`via`: `default`, `workspace`, `local`).
- **Refusal:** `{status: "refused", reason: {code, message, details?}}`.
  - **The kernel's code and message** pass through verbatim, and a message is always present.
  - **The team refusals** carry their bounded details: `E_TEAM_IN_USE` (`label`, `usedBy`: `defaultTeam`, `souls.teams:<key>`, `souls.default:<key>`), `E_TEAM_SHARED` (`label`, `at`), `E_TEAM_EXISTS`, `E_TEAM_UNKNOWN` and `E_TEAM_NOT_ELIGIBLE` (0.37 and earlier). A local-teams-closed `E_WORKSPACE_SCHEMA` keeps `reason`, `path` and `keys`.
  - **The Desktop's own codes** come with a plain message: `E_TEAMS_UNAVAILABLE` (neither team model, e.g. on 0.29: a clear refusal, no kernel call), `unsupported-remote-operation`, `E_WORKSPACE_UNKNOWN`, `E_BUSY` (one mutation per deployment at a time; reads are not blocked), and `E_CLI_PROTOCOL`.
- **Actions** come from a closed allow-list: each builds its own argv, and the action string is never passed through.

## Team members

`GET /api/team-members?ws=<view id>` answers who is in each team across the view's deployments
(`server/team-members.mjs`). A deployment id is read as the view that holds it.

- **The view's deployments only.** Its local deployments' rosters and its remote groups' panels;
  never another workspace's groups. Any view is answered, a view with no local deployment
  included.
- **Held observations only.** It runs no command and adds no ssh: remote groups are read as the
  remote roster loop's one `oats server roster` read left them. The server-wide Host guard applies,
  and the proxy pins `ws` to an advertised view or deployment id.
- A missing or repeated `ws` is `E_BAD_ARGS`; one that names no view is `E_WORKSPACE_UNKNOWN`.

```json
{"members":[{"workspace":"<deployment id>","deployment":{"id":"<deployment id>","machine":"This Mac","path":"…"},
  "server":null,"serverLabel":null,"instance":"…","agent":"…",
  "agentsRoot":"…","home":"…","team":"<identity.team>","running":true,"addressable":true,"missingRemotely":false,
  "reason":null,"reasonLabel":null,"createdAt":"…"}],
 "servers":[{"server":"<id>","label":"…","group":"<group id>","deployment":"remote:<group id>","reached":true,"error":null,"registered":true}],
 "notReached":[{"server":"<id>","label":"…","deployment":"remote:<group id>"}]}
```

- **`members`**: every row whose `identity.team` is a non-empty string: the view's local deployments'
  rows, then each remote group's rows. `workspace` is the member's deployment id, which every action
  on the member is addressed to; `deployment` names it with its machine. `running` is `null` when
  unknown; `reason` and `reasonLabel` are the roster's own reason the row can't be opened and its
  short label (`rowReason`), or `null`. The same instance seen from two machines is two members.
- **`servers`**: one entry per remote group of the view. `reached` is the group's last roster read;
  `registered` marks the group the server's registration targets (where `spawn --server` goes).
- **`notReached`**: every group of the view whose last read failed and that holds no rows,
  last-known or current. Before the first roster answer there are no groups, so nothing is named.

**On the board** (`renderer/computer-teams.mjs`, read on mount and at each roster poll):
- A team card with a provider id lists its members, grouped by deployment and labelled by machine
  (`deploymentLabel`): this Mac's deployments first, then the others; within a group by instance
  name, then home. An unmapped team shows no list.
- Deployment headings are sentence-case meta text with a count ("This Mac · ~/Agents/oats · 3",
  "altair · ~/Agents/tsm · not reached"), each a `role="group"` labelled by its heading.
- A member row is its state dot, its name (the roster's font), its soul mark and its state in words.
  The **name** is a text button that shows the member's roster row ("Show <instance> in the roster").
  A quiet **Terminal** button ("Open <instance> terminal on <machine>") is there only when the member
  is running and addressable. Otherwise the state word says why, as the roster's short label ("gone
  from X", "not reachable on X", "X not reached") or `stopped`/`unknown`, with the full reason as its
  title and description. The list holds no disabled buttons.
- Both go to the member's deployment (its id answers the view that holds it), wait for the row by
  server and home (`handOff` in `views/spawn.mjs`, shared with the remote spawn), then open it or
  select and focus it (`ctx.showInRoster`).
- A remote deployment whose last read failed keeps its last-known members, heads itself "<label> ·
  not reached" and carries the error as its title; its members read `unknown`.
- `notReached` is said under the page head: "Not reached: <label>, …. Their members aren't shown until
  they answer." That status line follows every answer, even while the cards wait under the redraw
  barrier (an open form, a pending confirmation, or focus inside the page).
- The card's summary is "N members" or "N members · M on other machines", and nothing for none.

**Where to run** (the spawn dialog, at the form's top level just above Relationship), in a view with
one deployment: "This computer", then each registered server (`/api/servers`). With a CLI that has
`servers-per-workspace` and `server-connect` it lists only the machines of the window's workspace and
ends with **Add a machine to this workspace…** ([desktop-machines.md](desktop-machines.md)). In a view
with two or more deployments the **Deployment** field replaces it (`renderer/spawn-deployment-field.mjs`;
see [the deployment model](desktop-deployment-model.md)).
It takes its disabled states from this route's `servers`, read for every view that holds a remote
deployment (a server's registered group may belong to another view than the one on screen), using the
registered group of each server: "(not registered)" when the server has groups but none is the
registration's, or "(not reached)". A server with no group in the view (before its first answer, or
running another workspace) stays enabled: nothing is guessed.
A server is never disabled for its souls: the roster lists only the souls spawned there before, not
those its workspace offers. The host's kernel refuses a soul it doesn't offer, and the dialog says
that refusal in its own words ("Couldn’t spawn on <server>: <message>"). With a server
chosen, the relation picker lists that group's rows (`/api/panel?ws=remote:<group>`): relations never
cross machines.

## Fixtures

`test/fixtures/team-model-v2/` holds **real captures** from the K1 kernel (oats
`feat/030-team-model`, commit in `provenance.json`). `capture-teams-v2.mjs` ran them on a scratch
Northwind build, using the Desktop's exact argv:
- the verbs and their real refusals;
- every other v2 document the Desktop reads (souls, workspace status, capabilities, inspect,
  preview, status, readiness).

`import-capture.mjs` imports them, with provenance and hashes.

`test/fixtures/team-model-3/` holds **real captures** from this repository's 0.38 kernel
(`capture-teams-3.mjs`, the commit in `provenance.json`), on a scratch Northwind built outside any
git tree, with the Desktop's argv: local teams closed (the default, then with local teams present)
and allowed, the verbs and their refusals, the removed soul-teams flags, and the souls, readiness
and preview team rows.

**Awaiting oats.aweb 1.17:** the messaging provider's teams document (`operation run
messaging:teams`). Until its capture exists, `team-model-v2-tolerance.test.mjs` reads the real
oats.aweb 1.16 capture (`workspace-v2/teams/teams-initial.json`), edited to K1's documented v2
shape. `provenance.json` records this under `awaiting`.
