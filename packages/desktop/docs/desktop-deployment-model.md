# Desktop deployment model on kernel JSON (Phase F, F1)

The Desktop is built for workspace model v2. Every fact it shows about a local
deployment comes from the installed kernel's JSON; the Desktop reads no
deployment file (`oats-local.yaml`, `oats-workspace.yaml`, member souls,
manifests or locks) and keeps no fallback reader for older kernels.

## Reads

For each registered deployment directory `D`, the server
(`server/deployment-observer.mjs`) performs two fixed-argv reads with
the accepted CLI, `cwd = D`, no shell, a 30 s timeout and a 4 MiB output
bound (`deployment-read-cli.mjs`); when the probe declares `observe-max-age`
they carry `--max-age <seconds>` (see
[desktop-load-path.md](desktop-load-path.md)):

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
`ACCEPT_RANGE` is `>=0.25.8 <0.33.0`: the floor admits main's kernel before
0.26.0 was tagged, the ceiling admits 0.27 (the harness rename, gated on feature
`harness`) through 0.30 (team model v2, gated on feature `team-model-2`; the
0.29 team shapes are still read), 0.31 (Herdr removed; per-instance reads and
plans routed by `--server`/`--home`, gated on the probe's `remote` entries) and
0.32, and the `packages-no-approval` fence is the real gate.

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
on a CLI read, so readiness probes stay responsive. The spawn catalog
(`oats souls`) and the capabilities table (`oats capabilities`) are read in the
same cycle but never block the roster; when they run, what is held and when a
cycle runs is [desktop-load-path.md](desktop-load-path.md).

## Remote rows

A remote workspace is one group of the kernel's remote roster (`oats server
roster --json`, projected by `server/remote-roster.mjs`); its rows carry
`server`, `home`, and the kernel's `addressable` and `missingRemotely` facts.

- **One predicate.** `canAddressRemote(row)` in `renderer/remote-address.mjs`
  (re-exported by `server/instance-admission.mjs`): a local row, or a remote row
  with `addressable === true`. It gates every action on a row: opening the
  terminal, Start…, the actions menu, the context panel's buttons, the start
  and restart dialog and route, launch configurations, inspection, lifecycle
  plans and applies, readiness, activity, Git and diff, and the wait for a
  started or spawned instance's terminal. `savedRoute` (spawned from this
  machine) decides only when this computer's OATS predates 0.31 and reports no
  `addressable`: a row it spawned stays reachable through its saved route.
- **Why a row can't open.** `rowReason(row)` in the same module is the one
  source of a row's reason: a short label on the roster meta line (Herdr no
  longer supported, gone from `<server>`, not reachable on `<server>`,
  `<server>` not reached, state unknown), and the full sentence used as the
  row's `title`, `aria-description` and the actions menu's reason. The server
  label is the registration's label, else the server id.
- **Admission.** `admitInstance` admits a remote selector only in its own
  remote workspace (the same server id in another group is another
  workspace), for a row that passes `canAddressRemote`, when this machine's
  probe lists the operation's `remote` entry (`readiness`, `instance-events`,
  `instance-git`, `lifecycle-plans`). Otherwise it refuses and nothing is sent;
  a local selector never resolves in a remote workspace, or the reverse.
- **Addressing.** Every routed command names `--server <id> --home <abs>`, runs
  from this machine's first deployment directory as its cwd, and carries no
  `--dir` (the kernel sends the registered workspace). Nothing remote is
  addressed by a bare `--instance`. A remote terminal is keyed
  `["remote", server, home]`.
- **Deadlines.** A remote read or plan has 45 s at the CLI (ssh's 15 s connect
  timeout plus the command) and 50 s at the renderer→main proxy; an apply keeps
  its 600 s / 610 s.
- **Refusals.** A host refusal is relayed as `{code, message, detail, remote:
  true}` (`hostReason`): the kernel's code, a headline naming the server
  (`remoteHeadline`, the view's own sentence for codes outside its table), and
  the kernel's message as the detail, bounded and withheld when it looks like a
  credential. Every hop re-validates it (`remoteReason`); views show the
  headline with the code and detail behind Details. A missing `remote` entry is
  "This computer's OATS can't route this to `<server>`. Update OATS here."
- **Views.** A remote read in flight says "Reading from `<server>`…". A remote
  row's pull request stays unavailable: the forge reads this machine's clones.
- **Lifecycle.** A remote apply that times out or loses its link is an unknown
  outcome, never a failure; codes the router or the host refuse before any
  effect (`E_REMOTE_INCOMPATIBLE`, `E_AMBIGUOUS`, `E_HOME_MISMATCH`,
  `E_SNAPSHOT_UNKNOWN`) are refused. The routed retire receipt may also carry
  `server` and `target`; a local one may not. After any remote apply the
  remote roster is re-read at once.

## Unchanged, v2-agnostic

Terminal-target liveness (`server/liveness.mjs`, running out of process) still
observes the exact recorded tmux socket/session/window — it reads no deployment
file. A Herdr-recorded row (a `sessionTarget`, or `runtimeState: "unsupported"`)
is never probed: it is reported unsupported with the kernel's E_HERDR_REMOVED
`runtimeError`, or with the E_HERDR_REMOVED stem when an older kernel gave none.
`remotePanel` does the same for remote rows, including an older remote kernel's
`backend: herdr` row, and `unsupportedSession()` in
`renderer/instance-presentation.mjs` is the one rule both sides use. Such a row
cannot open, start or restart; it can retire. The terminal owner broker, tmux admission, file
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
