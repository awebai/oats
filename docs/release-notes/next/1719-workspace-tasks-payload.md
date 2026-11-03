## Upgrade

- **A workspace sets `tasks:` only once every deployment that reads it runs a
  kernel listing `workspace-tasks-payload`** (`oats version --json`
  features). An older kernel refuses the whole file, so every resolve, spawn
  and start on that deployment stops. A file without `tasks:` resolves exactly
  as before.
- **A capability's `committedOnly` setting is enforced only by kernels with
  `settings-committed-only`.** An older kernel ignores the flag and still merges
  the key from oats-local.yaml and `--provider`. A provider that relies on it
  sets its kernel range to this release or later.

## Added

- **A workspace `tasks:` payload** (feature `workspace-tasks-payload`). The
  workspace file may carry a top-level `tasks:`, an opaque payload for whichever
  capability fills the tasks slot, merged at the same layer as `messaging:`:
  the manifest's defaults, then the workspace's `messaging:` or `tasks:`, the
  soul's slot payload, oats-local.yaml `settings.<cap>`, then `--provider`. Its
  leaves' origin is `{kind: "workspace", at: "oats-workspace.yaml#/tasks"}`. A
  `hostOnly` key or `byTeam` in it is refused, as in `messaging:`. There is no
  workspace `knowledge:` payload
  ([Provider payloads have three homes](../workspaces.md#provider-payloads-have-three-homes),
  [awebai/oats#1719](https://github.com/awebai/oats/issues/1719)).
- **`committedOnly` settings** (feature `settings-committed-only`), the mirror
  of `hostOnly`. A manifest's `settings.<key>.committedOnly: true` makes the
  resolver refuse that key in oats-local.yaml `settings.<cap>` and in
  `--provider <cap>` with `E_WORKSPACE_SCHEMA`, reason `committed-only-key`. The
  key's presence is refused, even with the committed value. The refusal names
  the key, where it was set, where it may be set (`details.allowed`) and the
  fix. For a messaging or tasks capability, that is oats-workspace.yaml under
  `messaging:` or `tasks:`, or a soul's slot payload. A key marked both
  `hostOnly` and `committedOnly` is a manifest fault, `details.why`
  `settings-flag-conflict`
  ([Commands and hooks](../capabilities.md#commands-and-hooks)).
- **An unknown top-level key in oats-workspace.yaml says the workspace may be
  newer than the kernel.** Beside "unknown property", the problem adds "if this
  is not a typo, the workspace uses a feature newer than this kernel (OATS
  <version>): upgrade OATS", with reason `unknown-root-key`. Nested unknown keys
  are unchanged.
