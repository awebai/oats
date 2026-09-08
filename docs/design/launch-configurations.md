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
