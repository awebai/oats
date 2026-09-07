# Provider operations and inspection contract

Implemented 2026-09-07 on the existing capability engine. The kernel
resolves providers; a GUI reads one answer and calls the commands below.
Nothing here names a provider: what a knowledge, messaging or tasks
capability offers is what its manifest declares.

## Manifest: operations

```json
"operations": {
  "harvest": { "kind": "action", "command": "harvest", "context": "home", "description": "Promote this instance's notes into its soul" },
  "inspect": { "kind": "view",   "command": "inspect", "context": "home", "description": "Show this instance's working knowledge" }
}
```

`command` names one of the manifest's `commands`. `kind` is `action`
(default) or `view`. `context` is `home` (default; runs in an instance
home) or `scope` (runs in the config scope). Optional `args` declare
`{name, flag, required, description}`; the runner passes `--arg name=value`
pairs as those flags and refuses unknown or missing required ones. A view
must answer `{ documents: [{ label, kind: "markdown"|"text", path?, text? }],
summary? }`; the kernel validates that shape and relays it. Paths are
provenance for the reader; the kernel reads nothing for a view. Validation
happens when the manifest loads (`docs/capability-manifest.schema.json`).

## oats inspect

`oats inspect [--dir <scope>] [--soul <name> [--agents-root <abs>]] [--home
<abs>] [--server <id>] --json` answers, in one envelope: `scope` (context,
workspace, team, chain, agentsRoots); `souls` (persistent, local and
packaged, each with runtime defaults, `editable {fields, instructions,
reason}`, instances, and for the selected soul its `instructions {file,
text, sha256, bytes, truncated, error}` capped at 256 KiB of bytes on a
character boundary); `layers` (effective provider per layer); `capabilities`
(installed state and `health` from the package engine, `missingRequires`,
and separately `activation {enabled, source, target, level, provenance,
settings, declaredAt}` plus `operations` with `available` and a `reason`);
`knowledge` (the effective knowledge provider's operations); `snapshot` and
`currentConfig` with `--home`; `problems`.

A `--home` answer is authoritative for that home: activation, settings,
layers and operation availability come from the home's captured bindings
with the currently acquired manifests and current trust, marked `source:
"snapshot"`; the live config is `currentConfig`, and `snapshot.drift`
lists activation, settings and integrity differences. The home selects its
own soul under its own agents root (its recorded work repository may be
another repository); `--dir`, if given, must be the recorded repository or
the workspace of that root, and `--agents-root` must be that root
(`E_HOME_MISMATCH`). Without a home, `--dir` is the config context and
same-named souls under two member roots need `--agents-root`
(`E_SOUL_AMBIGUOUS`). The ambient `PI_AGENTS_ROOT` never redirects these
commands. Integrity scanning happens only in this command.

## oats operation run

`oats operation run <layer>:<name> (--home <abs> | --soul <name> [--dir
<scope>] [--agents-root <abs>]) [--arg k=v ...] --json` resolves the
provider that fills `<layer>` for the home (captured bindings and settings)
or for the soul in the scope (config), requires the operation to be declared
(`E_OPERATION_UNKNOWN`), a provider to exist (`E_OPERATION_UNAVAILABLE`,
also for a home-context operation without `--home`), the executable surface
to be trusted (`E_CAPABILITY_BLOCKED`) and its `requires` to be on PATH
(`E_CAPABILITY_REQUIRES`), then runs the provider's own command exactly as
`oats <ns> <cmd>` would, with cwd and identity set to the selected target
(`OATS_HOME`, `OATS_INSTANCE`, `OATS_AGENT`, `OATS_SOUL`, `OATS_ROOT`,
`OATS_CONTEXT`, `OATS_WORKSPACE`, `OATS_OPERATION`, `OATS_SETTINGS`,
`OATS_CLI_BIN`, team variables) and every ambient identity of the invoking
process removed. The answer is `{ operation, capability, version, argv,
cwd, target: {home, instance}|null, result, instance?, home? }`; top-level
`instance`/`home` appear only when the provider's answer names something it
launched, never the source home.

The receipt must be exactly one JSON-v1 envelope on stdout from a process
that exits 0. Otherwise the outcome is unconfirmed: `E_OPERATION_TIMEOUT`
(240 s, below every wrapper) or `E_OPERATION_RESULT` (no valid envelope,
contaminated output, or a success envelope contradicted by the exit
status), with `error.details {unconfirmed: true, exit, envelope?, stderr?}`
carrying what was observed. A provider's own `ok: false` is relayed with
its code.

## Schedules

Kind `operation` `{operation: "<layer>:<name>", home}` runs `oats operation
run <op> --home <home>` as a command job: same admission, tracking and
reconciliation. An unconfirmed outcome keeps the slot as unknown and any
name the provider answered is kept for `oats schedule reconcile`.

## Mutations

`oats use ... --json` answers `{ capability, action: enable|disable|
layer-none|inherit, target, layer, level, file, settings, before, after
{..., effective}, remaining?, note?, missingRequires }`. `--inherit`
removes only the addressed target at this level; other bindings stay and
are listed. `use none --layer l` is a level statement and takes no soul or
type. A layer bound to another capability at a level is never overwritten
(`E_LAYER_BOUND` with the exact remedy).

`oats soul set <name> [--dir] [--agents-root] [--runtime] [--model |
--no-model] [--yolo | --no-yolo] [--backend] [--description |
--no-description] [--instructions-file <path>] --json` edits only the given
`soul.yaml` lines and replaces `AGENTS.md`; packaged souls are refused
(`E_SOUL_READONLY`). The receipt carries before/after and sha256s.

## Remote

`inspect`, `operation`, `use` and `soul` route with `--server <id>` through
the saved route; the remote must list `operations` in `remote` and
`features` and answer `operationsApi: 1` (`E_REMOTE_INCOMPATIBLE` before
anything is sent). An explicit `--dir` is the exact member context and
travels as is; `--home` is its own context; otherwise the registered
workspace is the scope. Soul instructions travel as bytes on the ssh stdin
(`--instructions-stdin` on the host), never as a local path.

## Replaceability

`test/inspect.test.mjs`, `test/operation.test.mjs` and
`test/operations-routing.test.mjs` use an owned alternative knowledge
provider (namespace `notes`, one `MEMORY.md`, operations `harvest` and
`inspect`) and never mention the official provider.
