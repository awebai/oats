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

## Fixtures

`test/fixtures/team-model-v2/` holds **real captures** from the K1 kernel (oats
`feat/030-team-model`, commit in `provenance.json`). `capture-teams-v2.mjs` ran them on a scratch
Northwind build, using the Desktop's exact argv:
- the verbs and their real refusals;
- every other v2 document the Desktop reads (souls, workspace status, capabilities, inspect,
  preview, status, readiness).

`import-capture.mjs` imports them, with provenance and hashes.
