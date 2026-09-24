# Desktop deployment model on kernel JSON (Phase F, F1)

The Desktop is built for workspace model v2. Every fact it shows about a local
deployment comes from the installed kernel's JSON; the Desktop reads no
deployment file (`oats-local.yaml`, `oats-workspace.yaml`, member souls,
manifests or locks) and keeps no fallback reader for older kernels.

## Reads

For each registered deployment directory `D`, the server
(`server/deployment-observer.mjs`) performs exactly two fixed-argv reads with
the accepted CLI, `cwd = D`, no shell, a 30 s timeout and a 4 MiB output
bound (`deployment-read-cli.mjs`):

- `oats status --dir D --json` — the roster. A raw `{root, agents, workspace}`
  object. Instance rows carry `modules[]` drift (or the recorded map when the
  workspace is unreachable), `soul` source, and `identity` only when a
  provider reported one.
- `oats workspace status --dir D --json` — the workspace header: a
  `schemaVersion: 1` envelope with `workspaceStatusApi: 1`: workspace name,
  key and commit, members, packages and `unsynced`/`stale`. There is no
  package approval (kernel feature `packages-no-approval`): declaring a
  package in `packages:` is the trust decision.

A nonzero exit is never success, even with plausible stdout. A kernel refusal
keeps only its bounded `code`/`message`. Ambient instance/deployment selectors
(`PI_AGENTS_ROOT`, `OATS_INSTANCE_HOME`, `OATS_DEPLOYMENT`, …) are removed from
the child environment.

## Capability gates

Reads are gated on the accepted probe (`oats version --json`), never on a
version number: `workspaceApi === 2`, `workspace-v2` and
`packages-no-approval` for the header, plus `instance-modules` and
`served-identity` for the roster. A missing feature is
shown by name in the header and roster; nothing is invoked optimistically.
`ACCEPT_RANGE` is unchanged; the release owns its widening.

## Projection and ownership

`deployment-data.mjs` validates and copies each command's own shape once for
rendering; it computes no drift and invents no identity. The roster root must
be `D/agents`, every soul directory must be inside `D`, and the header's
`workspace.local` must be `D/oats-local.yaml`. An instance row whose reported
home is not `<soul dir>/instances/<instance>`, or that repeats another row's
home, is **withheld** and counted in the header — never published, addressed
or silently dropped.

The observer reserves its bounded slots synchronously, admits on the current
deployment/CLI revision before each invocation and on completion, releases a
reservation only after both reads settle, coalesces in flight only, and copies
results per waiter. `/api/panel` serves the latest observation and never waits
on a CLI read, so readiness probes stay responsive.

## Unchanged, v2-agnostic

Terminal-target liveness (`server/liveness.mjs`, running out of process) still
observes the exact recorded tmux socket/session/window or Herdr target — it
reads no deployment file. The terminal owner broker, tmux admission, file
guard, spawn preview/apply, lifecycle, events, schedules and Git boundaries are
unchanged; they now receive their roster rows from the kernel observation.

## Retired

`server/deployment.mjs` (config/soul/manifest/lock readers, legacy local-soul
directories, digest replication), `server/model.mjs` (TASK/STATE inference,
knowledge counts), the `oats-web.mjs collect` child, and the catalog DTO
(`server/catalog.mjs`, `/api/catalog`, `renderer/official-catalog.mjs`) are
deleted. Workspace registration validates a directory holding a regular
`oats-local.yaml` (existence only); there is no team-scope sibling discovery.

## Known later-slice residuals

- The composite admission key still names the kernel's roster root
  `agentsRoot` across the preview/apply/lifecycle/events/schedule boundaries.
- The Capabilities tab's classic `list` inventory is a 0.24 surface.
- Souls not yet materialized in `D/agents` (workspace members' souls) are the
  F3 v2 spawn catalog.
