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

- **Success:** `{teamsViewApi: 1, status: "available", action, data, reason: null}`. `data` is the decoded document:
  - `teamsData` for `oats teams`: its `deployment` must be this workspace's, or the result is `E_DEPLOYMENT_SCOPE`;
  - `soulTeamsData` for `oats soul teams`.

  A mutation's document carries `changed`.
- **Failure:** `{teamsViewApi: 1, status: "unavailable", data: null, reason: {code, message?, details?}}`.
  - **The kernel's team refusals** pass through verbatim with their bounded details: `E_TEAM_IN_USE` (`label`, `usedBy`: `defaultTeam`, `souls.teams:<key>`, `souls.default:<key>`), `E_TEAM_SHARED` (`label`, `at`), `E_TEAM_EXISTS`, `E_TEAM_UNKNOWN` and `E_TEAM_NOT_ELIGIBLE`.
  - **The Desktop's own codes:** `E_TEAMS_UNAVAILABLE` (no `team-model-2`), `unsupported-remote-operation`, `E_WORKSPACE_UNKNOWN`, `E_BUSY` (one mutation per deployment at a time; reads are not blocked), and `E_CLI_PROTOCOL`.

## Fixtures

`test/fixtures/team-model-v2/` holds **stand-ins** copied from K1's contract examples (see its
PROVENANCE.md). Real 0.30 kernel captures replace them when the kernel lands.
