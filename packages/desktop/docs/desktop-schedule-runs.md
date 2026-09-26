# Desktop schedules and triggers

The Schedules and Triggers pages (§2.3a of
`docs/design/2026-09-26-okf-knowledge-operations.md`) show the workspace's
schedules and triggers, which are declared in Git, and this computer's own. The
pages group them by where each one runs.

## Reading and acting: `POST /api/automations?ws=ID`

- Everything the pages show comes from the kernel's `oats trigger|schedule list --json`
  rows, verbatim. The contract is in `docs/desktop-cli-api.md`, under "Workspace
  triggers and schedules".
- `server/automations.mjs` admits one local workspace, gated on the `automations`
  feature and `automationsApi: 1`.
- The renderer's `automation-rows.mjs` adapter projects the rows and never
  re-derives where one runs.
- Verbs, by the row's qualified id (`key`):
  - trigger: `status`, `enable`, `disable` and `test`;
  - schedule: `enable`, `disable`, `test`, `run` and `reconcile`.

## The local editor: `POST /api/schedules?ws=ID`

- This route keeps only what a schedule local to this computer needs:
  - `add` and `update`: the form, drafted by `scheduleDraft` from the stored
    definition;
  - `remove`;
  - `reconcile`;
  - `host-install`, `host-uninstall` and `host-status`.
- Reads and enable/disable/run refuse here (`E_BAD_ARGS`), because they are
  automations verbs.
- A definition carrying an execution policy the editor cannot preserve is not
  drafted. It is edited with the CLI.

## Removed (§3b)

The History API 3 read boundary is gone. That covered `/api/workspace-schedules`,
the `list|show` alias on `/api/schedules`, its CLI runner, IPC proxy and contract,
and the observation view.

Its closed row check cannot read kernel 0.29 rows, which add `name`, `origin` and
`host`. The kernel's own list and `schedule test` replace it.
