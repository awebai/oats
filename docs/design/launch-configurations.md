# Launch configurations and launch recipes

A **launch configuration** is a named way to start a harness, declared per
scope under `launch-configs:` in `oats-config.yaml` (see
docs/configuration.md): runtime, an executable, literal arguments,
environment (literals or `{fromEnv}` references), model, yolo. It is
independent of any soul; a soul may name one as its default
(`launch-config:` in soul.yaml, `oats soul set --launch-config`), and a
spawn, start or restart selects one by name.

A **launch recipe** is what a start is made of, recorded in the instance's
`instance.json` under `launch` beside the rendered `command`:

```json
{
  "version": 1,
  "runtime": "claude",
  "launchConfig": "personal", "launchConfigSource": "/scope",
  "executable": "/scope/tools/claude-wrapper.sh",
  "executableDeclared": "./tools/claude-wrapper.sh", "executableResolvedFrom": "relative to /scope",
  "args": ["--settings", "/abs/settings.json"],
  "env": { "KEY": { "fromEnv": "SRC" }, "LIT": "plain" },
  "model": "claude-opus-5", "yolo": true,
  "hooks": {
    "launch": { "claude": "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace" },
    "env": { "AWEB_DELIVERY": "session" },
    "contributions": [{ "capability": "oats.aweb", "layer": "messaging", "level": "/scope", "settings": { "delivery": "session" }, "trust": { "trusted": true, "integrity": "sha256-..." }, "launch": { "claude": "..." }, "env": ["AWEB_DELIVERY"] }]
  },
  "prompt": { "kind": "task-file", "file": "TASK.md" }
}
```

The rendered `command` is produced by one renderer from the recipe. With no
configuration it is byte-identical to what spawn rendered before recipes
existed, so an older kernel starts such a home unchanged, and the golden
matrix freezes that. Configuration `args` go after the runtime's own
options and before capability launch arguments (for claude and codex the
`--` separator keeps them from consuming the task; for pi they follow the
task, like capability arguments). Every argument and literal value is
single-quoted: spaces, quotes and metacharacters are literal.

## Environment references

`{fromEnv: SRC}` renders as `NAME="$SRC"` in the command: the persisted
command, the pending receipt and every answer carry the reference, never a
value. At start the execution host checks each source variable is set
(`E_LAUNCH_ENV_MISSING` before anything is created or stopped) and hands the
source variables to the pane only (tmux `-e`; a Herdr launch exports them in
the launched shell). Literal values are non-secret by contract but no answer
shows them: `list` and `preview` redact every environment value.

## Selection rules

- A named configuration is a unit. `--launch-config NAME` with a `--runtime`
  that disagrees with the configuration's runtime is refused
  (`E_LAUNCH_CONFIG_MISMATCH`) before anything happens; the same runtime may
  be repeated; `--model` and `--yolo` override the configuration's fields.
- Without `--launch-config`: a spawn takes the soul's `launch-config` default
  or none; an existing home keeps its recorded configuration, except that
  `--runtime` alone deliberately leaves it behind and renders the new
  runtime's defaults (no old executable or args are carried).
- Model: explicit, else the configuration's, else on an existing home the
  recorded model when the runtime is unchanged, else the runtime's native
  default; a spawn without either resolves the soul's preference for the
  runtime. A model never crosses runtimes.
- Executable: the configuration's (bare name on PATH; a path resolved against
  the declaring scope when relative) or the runtime's default (claude through
  `oats-claude-config`). It must be a regular executable file; it is never
  run to probe it. Capability runtime-package requirements are checked with
  the runtime's default binary, as at spawn.

## Capability boundary

Spawn hooks contribute `launch` arguments keyed by runtime and `env` values.
Launch arguments are runtime-specific by construction; environment is
runtime-neutral by contract. The recipe records both with per-capability
provenance (settings and trust at spawn). A later start on the same runtime
reuses them. A runtime switch reuses the environment and needs the new
runtime's launch arguments from the same capabilities: a capability that
answered arguments for the old runtime and none for the new one refuses the
switch (`E_LAUNCH_PREPARATION`) with the remedy (change that capability's
setting, or the provider declares a `launch` hook). Spawn hooks are never
re-run by a start or restart.

## `oats launch-config preview`

Read-only; nothing is locked or started. `--home ABS` describes an existing
home under a selection (`selection.source`: `frozen` when nothing was
selected, `config` when re-resolved, `frozen-command` for a home that
predates recipes, whose selection needs the restart conversion);
`--soul NAME [--dir SCOPE] [--agents-root ABS]` describes a new instance.
Answer: `{context, selected, selection:{source, launchConfig, runtime,
model, yolo}, runtime, model, modelSource, yolo, launchConfig,
launchConfigSource, executable:{path, declared, resolvedFrom}, argv,
environment:[{name, redacted|fromEnv}], command (redacted rendering),
prompt:{kind:"task-file", file:"TASK.md"}, hooks (redacted),
preflight:[{check: executable|environment|model|capabilities, ok, detail}],
ok}`. The TASK body is never included.

## Starting and restarting an existing home

`oats session start --home ABS` runs the recorded recipe as it is (a
`--model` re-renders the model in place and the recipe follows). With
`--launch-config`, `--runtime` or `--yolo` the recipe is re-resolved by the
same planner preview uses, against the home's recorded context, and every
check runs before anything is observed: the recipe's shape, the executable
(regular file, executable), the references (set on this host), the
capabilities' contributions (below), the runtime packages. A recorded
reference is re-checked on every start path, model-only starts included,
and the pane receives the source's value under the kernel alias.

`oats session restart --home ABS [same flags] [--stop-grace SECONDS]` stops
the running harness and starts again in place under the one per-home lock:

1. Every preflight above, first. A refusal leaves the harness running.
2. The stop: SIGTERM to every process under the pane's launcher (a wrapper
   that does not exec, the harness, their children), then a bounded wait
   (default 20 s) for the signalled processes to be gone and the session to
   read as a bare shell or stopped. Nothing is escalated: a harness still
   there when the wait ends is reported (`E_SESSION_STOP_FAILED`, with the
   processes still running) and nothing is launched. Elapsed time is never
   taken as exit; a turn interruption is never taken as exit.
3. The in-place start, with the pending receipt carrying the new recipe,
   runtime and yolo, exactly as a start does; `.oats-restart.json` keeps the
   stop's facts (what was signalled, when, whether exit was observed).

What the harnesses do on SIGTERM, from their installed sources and
documentation as read by the operating lead on 2026-09-07 (no live process
signalled): pi (@earendil-works/pi-coding-agent 0.84.2) registers
SIGTERM/SIGHUP handlers that end tracked children, dispose extensions and
exit; Claude Code's documentation makes Ctrl-C state-dependent (interrupt,
clear, double-press exit) and does not establish that an external SIGTERM
runs its SessionEnd hook; Codex's documentation establishes no SIGTERM
cleanup guarantee. So the contract is the request and the observation, not
a promise that a harness flushes its latest conversation: OATS preserves
the home, work, identity and notes; an old native conversation's unsaved
state is the harness's own. Wrappers should exec the harness or forward
signals. A longer `--stop-grace` can accommodate hook cleanup.

## Homes that predate recipes

A home with a recorded `command` and no `launch` is converted narrowly when
a start selects something: only the kernel's own generated shapes are
recognized (identity environment, the binary, the runtime's template
arguments, `--model`, yolo, the task prompt). Other environment is kept and
attributed to the capability whose recorded declaration (`environment`,
`environmentNamespaces` in `capabilityRuntime`) owns it, so a session-delivery
home switches runtime with its `AWEB_DELIVERY` intact; spawn hooks are never
re-run. Any other argument is unclassified: the start is refused, naming the
arguments, unless an active trusted capability declares a `launch` hook that
prepares the launch anew (then its answer replaces them). The conversion is
recorded (`launch.legacy`) by the start that uses it.

## The `launch` hook

A capability may declare `hooks.launch`. It runs on a start or restart of an
existing home (never at spawn, never spawn's identity work), side-effect-free
by contract, with `OATS_RUNTIME` set to the target runtime and
`OATS_PREVIOUS_RUNTIME` to the recorded one, and answers `{launch:{<runtime>:
args}, env:{...}}` for that runtime; its answer replaces the capability's
recorded contribution. Without it, a capability that contributed
runtime-specific arguments at spawn cannot follow a runtime change
(`E_LAUNCH_PREPARATION`), and a capability the scope no longer trusts has its
recorded arguments withheld the same way.
