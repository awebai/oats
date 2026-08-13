---
type: Decision
title: Package-runtime boundary is the structured CLI API (maintainer-ruled minimal surface)
description: Official packages reach the kernel only through existing oats CLI commands — capability-defined agents via oats spawn with --purpose naming, effective settings via OATS_SETTINGS on command dispatch, execution via the OATS_CLI_BIN absolute path — versioned by compatibility floor plus a pinned consumer fixture; one-for-one public wrappers (agent show/upsert, --instance/--ephemeral, config get, a probe field) were maintainer-rejected.
tags: [packages, runtime-api, cli, trust]
timestamp: 2026-07-26
---

# Package-runtime boundary = structured CLI, minimal surface

Official packages must not import `lib/core.mjs`, even through `oats root` and
a dynamic import. The transport is the `oats` CLI with the Desktop-API-v1 JSON
envelope discipline — but the **maintainer's transport ruling rejected the
one-for-one surface** an earlier draft of this decision recorded. The ruled
surface (contract: `docs/design/package-runtime-api.md` §1):

- **Capability-defined agents** own lookup/registration/ephemerality: a
  package capability declares service agents in its manifest `agents:`;
  `oats spawn <agent>` resolves them with automatic `kind: "capability"`
  semantics. There is NO public `oats agent show`/`upsert` and NO generic
  `--ephemeral` flag.
- **Existing spawn flags + `--purpose` deterministic naming**
  (`<agent>-<purpose>`); no raw `--instance` name authority.
- **Settings via dispatch**: `oats <namespace> <command>` passes the active
  capability's effective settings as `OATS_SETTINGS` (same contract as
  lifecycle hooks). There is NO public `oats config get`.
- **Execution via `OATS_CLI_BIN`**: dispatch provides the canonical absolute
  CLI path; consumers execFile it — never resolve `oats` from PATH (untrusted
  in worktrees) and never via shell.
- **Versioning**: compatibility floor (`>=0.19.0`) + a pinned consumer
  fixture. The Desktop `oats version --json` probe payload is NOT extended
  (no `packageRuntimeApi` field).

The rejected module-export option keeps the dynamic-import coupling, creates
a second public JavaScript API surface in permanent lockstep, and weakens
semver testability.

# Implementation notes

- Dispatch env additions live in `bin/oats.mjs` `capabilityCommand()`:
  `OATS_SETTINGS` (instance snapshot or resolved context) + `OATS_CLI_BIN`.
- The consumer fixture in `test/packages.test.mjs` drives the ruled pattern:
  capability-defined harvester through `oats spawn --json`, settings through
  dispatch, dropped surfaces asserted absent (`E_UNKNOWN_COMMAND`) and
  retired flags rejected (`E_BAD_ARGS`).
- History: the earlier one-for-one surface shipped briefly in 526dc31 and was
  reversed in 3f39f2b after the ruling; retired flags are actively rejected
  so stale consumers fail loudly rather than succeed with changed semantics.
