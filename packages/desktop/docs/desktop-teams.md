# Desktop teams (team model v2, OATS 0.30)

The Desktop edits this computer's team memberships through the kernel verbs `oats teams` and
`oats soul teams` (feature `team-model-2`). The kernel is the only writer of `oats-local.yaml`;
the Desktop server never writes that file (or `oats-workspace.yaml`) itself.

## Routes

Both are `POST` with exactly one `?ws=<advertised workspace ID>` and a JSON body of at most 4 KiB.
They sit behind the server-wide Host and Origin guards (loopback only; a foreign, `null` or
malformed `Origin` is 403 before any process), so a cross-origin page cannot rewrite the file.
The renderer reaches them through the generic guarded proxy (sender-frame guard, `ws` pinned to
the connected server's workspaces, 20 s deadline; the verbs run with a 15 s timeout).

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

`GET /api/team-members?ws=<local workspace ID>` answers who is in each team, wherever it runs.

- **Held observations only.** It runs no command and adds no ssh. It reads this workspace's roster and
  every remote group's panel, as the remote roster loop's one `oats server roster` read left them.
  The server-wide Host guard applies, and the proxy pins `ws` to an advertised workspace.
- **A remote workspace** is refused with `409 unsupported-remote-operation`: the Teams board is shown
  only for a local workspace. A missing or repeated `ws` is `E_BAD_ARGS`; an unknown one is
  `E_WORKSPACE_UNKNOWN`.

```json
{"members":[{"workspace":"<ws id to navigate to>","server":null,"serverLabel":null,"instance":"…","agent":"…",
  "agentsRoot":"…","home":"…","team":"<identity.team>","running":true,"addressable":true,"missingRemotely":false,
  "reason":null,"createdAt":"…"}],
 "servers":[{"server":"<id>","label":"…","group":"<group id>","reached":true,"error":null,"registered":true,"souls":["dev"]}],
 "notReached":[{"server":"<id>","label":"…"}]}
```

- **`members`**: every row whose `identity.team` is a non-empty string: this workspace's rows, then
  each remote group's rows. `workspace` is where to go for the row (`remote:<group id>` for a remote
  one); `running` is `null` when unknown; `reason` is the roster's own reason the row can't be opened
  (`rowReason`), or `null`. The same instance seen from two machines is two members.
- **`servers`**: one entry per remote group. `reached` is the group's last roster read; `registered`
  marks the group the server's registration targets (where `spawn --server` goes); `souls` are the
  souls its roster lists.
- **`notReached`**: every group whose last read failed and that holds no rows, last-known or current.
  Before the first roster answer there are no groups, so nothing is named.

**On the board** (`renderer/computer-teams.mjs`, read on mount and at each roster poll):
- A team card with a provider id lists its members, grouped by machine: "This computer" first, then
  servers by label in code-point order (the server id breaks ties); within a group by instance name,
  then home. An unmapped team shows no list.
- A member shows its state dot and, in words, `running`, `stopped`, `unknown` or `gone` (missing from
  its server).
- **Open terminal** is enabled for a running, addressable member; otherwise it is disabled with the
  roster's reason as its title and description. **Show in roster** is always enabled.
- Both go to the member's workspace, wait for the row by server and home (`handOff` in
  `views/spawn.mjs`, shared with the remote spawn), then open it or select and focus it
  (`ctx.showInRoster`).
- A group from a failed read keeps its last-known members, heads itself "<label> · not reached" and
  carries the error as its title; its members read `unknown`.
- `notReached` is said under the page head: "Not reached: <label>, …. Their members aren't shown until
  they answer." That status line follows every answer, even while the cards wait under the redraw
  barrier (an open form, a pending confirmation, or focus inside the page).
- The card's summary is "N members" or "N members · M on other machines", and nothing for none.

**Where to run** (the spawn dialog): "This computer", then each registered server (`/api/servers`).
It takes its disabled states from this route's `servers`, using the registered group of each server:
"(not registered)" when there is none, "(not reached)", or "(no <soul> soul there)". With a server
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
