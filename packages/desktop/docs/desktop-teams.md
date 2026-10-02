# Desktop teams (team model v2, OATS 0.30)

The Desktop edits this computer's team memberships through the kernel verbs `oats teams` and
`oats soul teams` (feature `team-model-2`). The kernel is the only writer of `oats-local.yaml`;
the Desktop server never writes that file (or `oats-workspace.yaml`) itself.

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
  - `teams` is `teamsData`, with `teamsApi`, `deployment`, `defaultTeam`, `teams`, `souls`, `problems`, and `changed` on a mutation. Its `deployment` must be this workspace's, or the answer is `E_DEPLOYMENT_SCOPE`.
  - `soulTeams` is `soulTeamsData`, with `soulTeamsApi`, `soul`, `key`, `defaultTeam`, `teams` (+ `via`), `local`, `all`, and `changed`.
- **Refusal:** `{status: "refused", reason: {code, message, details?}}`.
  - **The kernel's code and message** pass through verbatim, and a message is always present.
  - **The team refusals** carry their bounded details: `E_TEAM_IN_USE` (`label`, `usedBy`: `defaultTeam`, `souls.teams:<key>`, `souls.default:<key>`), `E_TEAM_SHARED` (`label`, `at`), `E_TEAM_EXISTS`, `E_TEAM_UNKNOWN` and `E_TEAM_NOT_ELIGIBLE`.
  - **The Desktop's own codes** come with a plain message: `E_TEAMS_UNAVAILABLE` (no `team-model-2`, e.g. on 0.29: a clear refusal, no kernel call), `unsupported-remote-operation`, `E_WORKSPACE_UNKNOWN`, `E_BUSY` (one mutation per deployment at a time; reads are not blocked), and `E_CLI_PROTOCOL`.
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
one deployment: "This computer", then each registered server (`/api/servers`). In a view with two or
more deployments the **Deployment** field replaces it (`renderer/spawn-deployment-field.mjs`; see
[the deployment model](desktop-deployment-model.md)).
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

**Awaiting oats.aweb 1.17:** the messaging provider's teams document (`operation run
messaging:teams`). Until its capture exists, `team-model-v2-tolerance.test.mjs` reads the real
oats.aweb 1.16 capture (`workspace-v2/teams/teams-initial.json`), edited to K1's documented v2
shape. `provenance.json` records this under `awaiting`.
