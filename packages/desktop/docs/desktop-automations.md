# Desktop Schedules and Triggers (feature `automations`)

The Schedules and Triggers pages read and act through the installed CLI's
workspace automations contract (kernel 0.29.0: feature `automations`,
`automationsApi: 1`; `docs/desktop-cli-api.md` § "Workspace triggers and
schedules"). The Desktop never reads automation files, evaluates cron or
placement, or re-derives where something runs: `runsHere`, `reason`,
`enabledHere` and `nextDue` are the kernel's.

## Boundary

`POST /api/automations?ws=<id>` with `{ kind, action, key? }` (body ≤ 4 KiB,
exactly one `ws`, the server-wide loopback Origin guard):

| kind | actions | key |
|---|---|---|
| `trigger` | `list` | none |
| `trigger` | `status` | optional |
| `trigger` | `enable`, `disable`, `test` | required |
| `schedule` | `list` | none |
| `schedule` | `enable`, `disable`, `test`, `run`, `reconcile` | required |

`key` is the row's qualified id (`local/<id>`, `<member>/<id>`) or a bare local
id, never option-shaped. The server runs `oats <kind> <action> [key] --dir
<workspace scope> --json` (argv only, the accepted CLI binary; 30 s, 60 s for
`trigger test`) for a **local** workspace only.

The answer resolves; it never rejects:

`{ automationsViewApi: 1, status: "ok" | "unavailable", kind, action, result, reason }`

- `result` is the kernel's result verbatim; the renderer's `automation-rows`
  adapter projects it.
- A kernel refusal keeps its own code and bounded message
  (`E_AUTOMATION_NOT_HERE`, `E_AUTOMATION_WORKSPACE`, …).
- The Desktop's codes: `E_AUTOMATIONS_UNAVAILABLE` (no feature or API),
  `E_WORKSPACE_UNKNOWN`, `E_UNSUPPORTED_REMOTE`, `E_BAD_ARGS`, `E_CLI_PROTOCOL`
  (a document of the wrong shape).

The app proxy classifies `/api/automations` as its own route, pins the verified
workspace unless the server advertises the one asked, keeps duplicate `ws` for
the backend's refusal, and allows 90 s.

## Opening a definition

A row's file opens read-only in a tab from `origin.localPath` (this
deployment's own file, or the member's clone here) through the contained
`/api/file`; without one, the kernel's `origin.url` opens externally; else the
action is disabled with its reason.

## The local form

Local schedules are still created and edited by the form, through
`POST /api/schedules` (`add`, `update`, `remove`, `reconcile`, `host-*`). The
draft (`renderer/schedule-read-data.mjs`, `scheduleDraft`) is the stored local job exactly, or
nothing ("edit it with the CLI") when the form cannot keep a field.

## Tests

`test/automations-server.test.mjs` (captured argv, verbatim results, refusals,
gates, keys, the adapter over the real shapes), `automations-view.test.mjs`,
`schedule-draft.test.mjs`, `normalized-api-guards.test.mjs`; fixtures
`test/fixtures/automations/kernel/` (kernel captures, `provenance.json`).
